import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { paginate } from '../common/query';
import type { ReviewPageResponse, ReviewResponse } from '../common/responses';
import { toReview } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import type { Prisma, User } from '../generated/prisma/client';
import type { CreateReviewDto, UpdateReviewDto } from './reviews.dto';

const withUser = { user: true } as const;

export const REVIEW_SORTS = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  rating_desc: [{ rating: 'desc' }, { id: 'desc' }],
  rating_asc: [{ rating: 'asc' }, { id: 'desc' }],
} satisfies Record<string, Prisma.ReviewOrderByWithRelationInput[]>;
export type ReviewSort = keyof typeof REVIEW_SORTS;

type Tx = Prisma.TransactionClient;

async function findProduct(db: Tx, id: number) {
  const product = await db.product.findUnique({ where: { id }, select: { sellerId: true } });
  if (!product) throw new ApiError(404, 'Product not found');
  return product;
}

async function findReview(db: Tx, productId: number, id: number) {
  const review = await db.review.findFirst({ where: { id, productId }, select: { userId: true } });
  if (!review) throw new ApiError(404, 'Review not found');
  return review;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(productId: number, sort: ReviewSort, page: number, limit: number): Promise<ReviewPageResponse> {
    await findProduct(this.prisma, productId);
    const where = { productId };
    const [total, rows] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({ where, orderBy: REVIEW_SORTS[sort], skip: (page - 1) * limit, take: limit, include: withUser }),
    ]);
    return { items: rows.map(toReview), ...paginate(total, page, limit) };
  }

  async mine(user: User, productId: number): Promise<ReviewResponse> {
    const review = await this.prisma.review.findUnique({ where: { productId_userId: { productId, userId: user.id } }, include: withUser });
    if (!review) throw new ApiError(404, 'You have not reviewed this product');
    return toReview(review);
  }

  async create(user: User, productId: number, dto: CreateReviewDto): Promise<ReviewResponse> {
    const review = await this.changeReviews(productId, async (tx, product) => {
      if (product.sellerId === user.id) throw new ApiError(403, 'You cannot review your own product');
      const exists = await tx.review.findUnique({ where: { productId_userId: { productId, userId: user.id } }, select: { id: true } });
      if (exists) throw new ApiError(409, 'You already reviewed this product. Change your review instead');
      return tx.review.create({ data: { productId, userId: user.id, ...dto }, include: withUser });
    });
    return toReview(review);
  }

  /** Only the author can change a review. */
  async update(user: User, productId: number, id: number, dto: UpdateReviewDto): Promise<ReviewResponse> {
    if (dto.rating === undefined && dto.comment === undefined) throw new ApiError(400, 'No fields to update');
    const review = await this.changeReviews(productId, async (tx) => {
      if ((await findReview(tx, productId, id)).userId !== user.id) throw new ApiError(403, 'You can only change your own review');
      return tx.review.update({ where: { id }, data: dto, include: withUser });
    });
    return toReview(review);
  }

  /** The author or an admin can delete a review. */
  async remove(user: User, productId: number, id: number): Promise<void> {
    await this.changeReviews(productId, async (tx) => {
      const review = await findReview(tx, productId, id);
      if (user.role !== 'admin' && review.userId !== user.id) throw new ApiError(403, 'You can only delete your own review');
      await tx.review.delete({ where: { id } });
    });
  }

  /**
   * Runs a change to a product's reviews, then recounts products.reviews_count and reviews_rating.
   * The product row is locked first, so two reviews saved at the same moment can't miscount.
   */
  private changeReviews<T>(productId: number, change: (tx: Tx, product: { sellerId: number | null }) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
      const result = await change(tx, await findProduct(tx, productId));
      await tx.$executeRaw`
        UPDATE products SET
          reviews_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ${productId}),
          reviews_rating = (SELECT round(AVG(rating)::numeric, 2)::float8 FROM reviews WHERE product_id = ${productId})
        WHERE id = ${productId}`;
      return result;
    });
  }
}
