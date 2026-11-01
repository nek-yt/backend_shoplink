import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { paginate } from '../common/query';
import { PrismaService } from '../database/prisma.service';
import type { Comment, Prisma, User } from '../generated/prisma/client';
import { defaultAvatarUrl } from '../images/images';

/** A comment as the API sends it: the author's public details only (no email or phone). */
export class CommentResponse {
  id: number;
  productId: number;
  userId: number;
  userName: string;
  /** @example aziza.style */
  userUsername: string | null;
  userAvatarUrl: string;
  text: string;
  /** true once the author changed the text. */
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

export class CommentPageResponse {
  items: CommentResponse[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export const COMMENT_SORTS = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
} satisfies Record<string, Prisma.CommentOrderByWithRelationInput[]>;
export type CommentSort = keyof typeof COMMENT_SORTS;

const withUser = { user: true } as const;

function toComment(c: Comment & { user: User }): CommentResponse {
  return {
    id: c.id,
    productId: c.productId,
    userId: c.userId,
    userName: c.user.name,
    userUsername: c.user.socialUsername,
    userAvatarUrl: c.user.avatarUrl ?? defaultAvatarUrl(c.user),
    text: c.text,
    edited: c.updatedAt.getTime() - c.createdAt.getTime() > 1000,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async findProduct(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { sellerId: true } });
    if (!product) throw new ApiError(404, 'Product not found');
    return product;
  }

  private async findComment(productId: number, id: number) {
    const comment = await this.prisma.comment.findFirst({ where: { id, productId }, select: { userId: true } });
    if (!comment) throw new ApiError(404, 'Comment not found');
    return comment;
  }

  async list(productId: number, sort: CommentSort, page: number, limit: number): Promise<CommentPageResponse> {
    await this.findProduct(productId);
    const where = { productId };
    const [total, rows] = await Promise.all([
      this.prisma.comment.count({ where }),
      this.prisma.comment.findMany({ where, orderBy: COMMENT_SORTS[sort], skip: (page - 1) * limit, take: limit, include: withUser }),
    ]);
    return { items: rows.map(toComment), ...paginate(total, page, limit) };
  }

  /** Anyone logged in, as often as they like (the seller too, to answer questions). */
  async create(user: User, productId: number, text: string): Promise<CommentResponse> {
    await this.findProduct(productId);
    return toComment(await this.prisma.comment.create({ data: { productId, userId: user.id, text }, include: withUser }));
  }

  /** Only the author can change a comment. */
  async update(user: User, productId: number, id: number, text: string): Promise<CommentResponse> {
    if ((await this.findComment(productId, id)).userId !== user.id) throw new ApiError(403, 'You can only change your own comment');
    return toComment(await this.prisma.comment.update({ where: { id }, data: { text }, include: withUser }));
  }

  /** The author, the product's seller or an admin can delete a comment. */
  async remove(user: User, productId: number, id: number): Promise<void> {
    const [comment, product] = await Promise.all([this.findComment(productId, id), this.findProduct(productId)]);
    if (user.role !== 'admin' && comment.userId !== user.id && product.sellerId !== user.id)
      throw new ApiError(403, 'You can only delete your own comment');
    await this.prisma.comment.delete({ where: { id } });
  }
}
