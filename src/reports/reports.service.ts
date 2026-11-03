import { Injectable } from '@nestjs/common';
import type { ReportReason, ReportStatus } from '../common/constants';
import { ApiError } from '../common/api-error';
import { paginate } from '../common/query';
import type { ProductResponse } from '../common/responses';
import { toProduct } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import type { Product, Report, User } from '../generated/prisma/client';
import { defaultAvatarUrl } from '../images/images';

/** A report as the admins see it: the product (with its seller) and who reported it. */
export class ReportResponse {
  id: number;
  productId: number;
  product: ProductResponse;
  reporterId: number;
  reporterName: string;
  /** @example aziza.style */
  reporterUsername: string | null;
  reporterAvatarUrl: string;
  /** @example fake */
  reason: string;
  note: string;
  /** @example open */
  status: string;
  createdAt: string;
  updatedAt: string;
}

export class ReportPageResponse {
  items: ReportResponse[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** How many reports have each status, whatever the filter. */
  counts: Record<ReportStatus, number>;
}

/** What the reporter gets back: just that it was received. */
export class ReportReceivedResponse {
  id: number;
  productId: number;
  reason: string;
  status: string;
  createdAt: string;
}

const withDetails = { product: { include: { seller: true } }, reporter: true } as const;

function toReport(r: Report & { product: Product & { seller: User | null }; reporter: User }): ReportResponse {
  return {
    id: r.id,
    productId: r.productId,
    product: toProduct(r.product),
    reporterId: r.reporterId,
    reporterName: r.reporter.name,
    reporterUsername: r.reporter.socialUsername,
    reporterAvatarUrl: r.reporter.avatarUrl ?? defaultAvatarUrl(r.reporter),
    reason: r.reason,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reporting the same product again replaces the reason and opens the report again. */
  async create(user: User, productId: number, reason: ReportReason, note: string): Promise<ReportReceivedResponse> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { sellerId: true } });
    if (!product) throw new ApiError(404, 'Product not found');
    if (product.sellerId === user.id) throw new ApiError(400, "You can't report your own product");
    const r = await this.prisma.report.upsert({
      where: { productId_reporterId: { productId, reporterId: user.id } },
      create: { productId, reporterId: user.id, reason, note },
      update: { reason, note, status: 'open' },
    });
    return { id: r.id, productId: r.productId, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() };
  }

  async list(status: ReportStatus | undefined, page: number, limit: number): Promise<ReportPageResponse> {
    const where = status ? { status } : {};
    const [total, rows, grouped] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, include: withDetails }),
      this.prisma.report.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts: Record<ReportStatus, number> = { open: 0, resolved: 0, dismissed: 0 };
    for (const g of grouped) counts[g.status as ReportStatus] = g._count._all;
    return { items: rows.map(toReport), ...paginate(total, page, limit), counts };
  }

  async update(id: number, status: ReportStatus): Promise<ReportResponse> {
    const exists = await this.prisma.report.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new ApiError(404, 'Report not found');
    return toReport(await this.prisma.report.update({ where: { id }, data: { status }, include: withDetails }));
  }

  /** Closes every open report on a product at once (the admin dealt with the product). */
  async resolveProduct(productId: number, status: ReportStatus): Promise<{ updated: number }> {
    const { count } = await this.prisma.report.updateMany({ where: { productId, status: 'open' }, data: { status } });
    return { updated: count };
  }
}
