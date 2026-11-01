import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { paginate } from '../common/query';
import type { WishlistItemResponse, WishlistPageResponse } from '../common/responses';
import { toWishlistItem } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import type { User } from '../generated/prisma/client';

const withProduct = { product: true } as const;

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: User, page: number, limit: number): Promise<WishlistPageResponse> {
    const where = { userId: user.id };
    const [total, rows] = await Promise.all([
      this.prisma.wishlistItem.count({ where }),
      this.prisma.wishlistItem.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: withProduct }),
    ]);
    return { items: rows.map(toWishlistItem), ...paginate(total, page, limit) };
  }

  async get(user: User, id: number): Promise<WishlistItemResponse> {
    const item = await this.prisma.wishlistItem.findFirst({ where: { id, userId: user.id }, include: withProduct });
    if (!item) throw new ApiError(404, 'Wishlist item not found');
    return toWishlistItem(item);
  }

  /** Adding a product that is already there just returns it. */
  async add(user: User, productId: number): Promise<WishlistItemResponse> {
    if (!(await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
      throw new ApiError(404, 'Product not found');
    }
    await this.prisma.wishlistItem.createMany({ data: [{ userId: user.id, productId }], skipDuplicates: true });
    const item = await this.prisma.wishlistItem.findUniqueOrThrow({
      where: { userId_productId: { userId: user.id, productId } },
      include: withProduct,
    });
    return toWishlistItem(item);
  }

  async remove(user: User, id: number): Promise<void> {
    const { count } = await this.prisma.wishlistItem.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) throw new ApiError(404, 'Wishlist item not found');
  }

  async removeProduct(user: User, productId: number): Promise<void> {
    const { count } = await this.prisma.wishlistItem.deleteMany({ where: { productId, userId: user.id } });
    if (count === 0) throw new ApiError(404, 'Product is not in your wishlist');
  }

  async clear(user: User): Promise<void> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId: user.id } });
  }
}
