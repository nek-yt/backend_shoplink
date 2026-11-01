import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { paginate } from '../common/query';
import type { ProductPageResponse, ProductResponse } from '../common/responses';
import { toProduct } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { Prisma, type User } from '../generated/prisma/client';
import { MAX_PRODUCT_IMAGES } from '../images/images';
import { UploadsService } from '../images/uploads.service';
import type { CreateProductDto, UpdateProductDto } from './dto/product.dto';

// Plain lower() follows the database's locale and leaves Cyrillic etc. untouched under the "C" locale
// many hosts use. The ICU collation lowercases every language the same way on any server.
const ulower = (expr: Prisma.Sql) => Prisma.sql`lower(${expr} COLLATE "und-x-icu")`;
const col = (name: string) => Prisma.raw(name);

export const PRODUCT_SORTS = {
  newest: Prisma.sql`created_at DESC, id DESC`,
  price_asc: Prisma.sql`price_cents ASC, id DESC`,
  price_desc: Prisma.sql`price_cents DESC, id DESC`,
  rating_desc: Prisma.sql`rating DESC, id DESC`,
  name_asc: Prisma.sql`${ulower(col('name'))} ASC, id DESC`,
};
export type ProductSort = keyof typeof PRODUCT_SORTS;

export interface ProductFilters {
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  size?: string;
  color?: string;
  category?: string;
  inStock?: boolean;
  sellerId?: number;
  sort: ProductSort;
  page: number;
  limit: number;
}

const toCents = (price: number) => BigInt(Math.round(price * 100));

function toData(dto: UpdateProductDto): Prisma.ProductUpdateInput {
  const { price, ...rest } = dto;
  return { ...rest, ...(price !== undefined && { priceCents: toCents(price) }) };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(f: ProductFilters): Promise<ProductPageResponse> {
    const where: Prisma.Sql[] = [];
    if (f.search) {
      // strpos instead of LIKE so % and _ in the search text are matched literally.
      const term = ulower(Prisma.sql`${f.search}::text`);
      where.push(Prisma.sql`(strpos(${ulower(col('name'))}, ${term}) > 0 OR strpos(${ulower(col('description'))}, ${term}) > 0)`);
    }
    if (f.minPrice !== undefined) where.push(Prisma.sql`price_cents >= ${toCents(f.minPrice)}`);
    if (f.maxPrice !== undefined) where.push(Prisma.sql`price_cents <= ${toCents(f.maxPrice)}`);
    if (f.minRating !== undefined) where.push(Prisma.sql`rating >= ${f.minRating}`);
    for (const [column, value] of [['sizes', f.size], ['colors', f.color]] as const) {
      if (!value) continue;
      where.push(
        Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${col(column)}) AS o(value)
                           WHERE ${ulower(col('o.value'))} = ${ulower(Prisma.sql`${value}::text`)})`,
      );
    }
    if (f.category) where.push(Prisma.sql`category = ${f.category}`);
    if (f.inStock === true) where.push(Prisma.sql`stock > 0`);
    if (f.inStock === false) where.push(Prisma.sql`stock = 0`);
    if (f.sellerId !== undefined) where.push(Prisma.sql`seller_id = ${f.sellerId}`);

    const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM products ${whereSql}`;
    const page = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM products ${whereSql} ORDER BY ${PRODUCT_SORTS[f.sort]}
      LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`;

    const ids = page.map((r) => r.id);
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids } }, include: { seller: true } });
    const byId = new Map(rows.map((p) => [p.id, p]));
    const items = ids.flatMap((id) => (byId.has(id) ? [toProduct(byId.get(id)!)] : []));
    return { items, ...paginate(total, f.page, f.limit) };
  }

  async get(id: number): Promise<ProductResponse> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { seller: true } });
    if (!product) throw new ApiError(404, 'Product not found');
    return toProduct(product);
  }

  async create(user: User, dto: CreateProductDto): Promise<ProductResponse> {
    const { price, ...rest } = dto;
    return toProduct(
      await this.prisma.product.create({ data: { ...rest, priceCents: toCents(price), sellerId: user.id }, include: { seller: true } }),
    );
  }

  // Sellers may change only their own products; admins may change any.
  private async assertCanChange(user: User, id: number): Promise<{ imageUrl: string | null; images: unknown }> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { sellerId: true, imageUrl: true, images: true } });
    if (!product) throw new ApiError(404, 'Product not found');
    if (user.role !== 'admin' && product.sellerId !== user.id) throw new ApiError(403, 'You can only change your own products');
    return product;
  }

  async update(user: User, id: number, dto: UpdateProductDto): Promise<ProductResponse> {
    const data = toData(dto);
    if (Object.keys(data).length === 0) throw new ApiError(400, 'No fields to update');
    const before = await this.assertCanChange(user, id);
    const { count } = await this.prisma.product.updateMany({ where: { id }, data: data as Prisma.ProductUpdateManyMutationInput });
    if (count === 0) throw new ApiError(404, 'Product not found');
    if (dto.imageUrl !== undefined && dto.imageUrl !== before.imageUrl) await this.uploads.remove(before.imageUrl);
    return this.get(id);
  }

  async remove(user: User, id: number): Promise<void> {
    const before = await this.assertCanChange(user, id);
    const { count } = await this.prisma.product.deleteMany({ where: { id } });
    if (count === 0) throw new ApiError(404, 'Product not found');
    await this.uploads.remove(before.imageUrl);
    for (const url of before.images as string[]) await this.uploads.remove(url);
  }

  /** Saves a new picture (null = back to the default picture) and deletes the old one. */
  async setImage(user: User, id: number, file: Express.Multer.File | null): Promise<ProductResponse> {
    const before = await this.assertCanChange(user, id);
    const imageUrl = file ? await this.uploads.saveImage('products', file) : null;
    const { count } = await this.prisma.product.updateMany({ where: { id }, data: { imageUrl } });
    if (count === 0) {
      await this.uploads.remove(imageUrl);
      throw new ApiError(404, 'Product not found');
    }
    await this.uploads.remove(before.imageUrl);
    return this.get(id);
  }

  /** Saves more pictures and adds them to the end of the product's extra pictures. */
  async addImages(user: User, id: number, files: Express.Multer.File[]): Promise<ProductResponse> {
    await this.assertCanChange(user, id);
    const urls: string[] = [];
    try {
      for (const file of files) urls.push(await this.uploads.saveImage('products', file));
      // One statement, so two uploads at the same moment can't go over the limit together.
      const added = await this.prisma.$executeRaw`
        UPDATE products SET images = images || ${JSON.stringify(urls)}::jsonb, updated_at = now()
        WHERE id = ${id} AND jsonb_array_length(images) + ${urls.length} <= ${MAX_PRODUCT_IMAGES}`;
      if (added === 0) {
        await this.get(id); // 404 if it was deleted meanwhile
        throw new ApiError(400, `A product can have at most ${MAX_PRODUCT_IMAGES} extra pictures`);
      }
    } catch (err) {
      for (const url of urls) await this.uploads.remove(url);
      throw err;
    }
    return this.get(id);
  }

  /** Removes one extra picture (by its file name, the last part of its URL) and deletes the file. */
  async removeImage(user: User, id: number, name: string): Promise<ProductResponse> {
    const before = await this.assertCanChange(user, id);
    const url = (before.images as string[]).find((u) => u.split('/').pop() === name);
    if (!url) throw new ApiError(404, 'Picture not found');
    // jsonb - text removes that string from the array.
    await this.prisma.$executeRaw`UPDATE products SET images = images - ${url}::text, updated_at = now() WHERE id = ${id}`;
    await this.uploads.remove(url);
    return this.get(id);
  }
}
