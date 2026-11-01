import { Injectable } from '@nestjs/common';
import { ApiError, validationFailed } from '../common/api-error';
import { MAX_ORDER_ITEMS } from '../common/constants';
import type { CartItemResponse, CartResponse, OrderResponse } from '../common/responses';
import { toCartItem } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import type { Product, User } from '../generated/prisma/client';
import { OrdersService, resolveOption } from '../orders/orders.service';
import type { AddToCartDto, CheckoutDto } from './cart.dto';

const withProduct = { product: true } as const;

function assertInStock(product: Product, quantity: number) {
  if (quantity > product.stock) {
    throw new ApiError(409, 'Not enough stock', [`"${product.name}": requested ${quantity}, only ${product.stock} left`]);
  }
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  // Pieces of this product in the user's other cart lines (other sizes/colors share the same stock).
  private async inOtherLines(userId: number, productId: number, exceptId?: number): Promise<number> {
    const { _sum } = await this.prisma.cartItem.aggregate({
      where: { userId, productId, ...(exceptId !== undefined && { id: { not: exceptId } }) },
      _sum: { quantity: true },
    });
    return _sum.quantity ?? 0;
  }

  async get(user: User): Promise<CartResponse> {
    const rows = await this.prisma.cartItem.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' }, include: withProduct });
    const items = rows.map(toCartItem);
    const totalCents = rows.reduce((sum, r) => sum + r.product.priceCents * BigInt(r.quantity), 0n);
    return { items, totalQuantity: items.reduce((n, i) => n + i.quantity, 0), total: Number(totalCents) / 100 };
  }

  async getItem(user: User, id: number): Promise<CartItemResponse> {
    const item = await this.prisma.cartItem.findFirst({ where: { id, userId: user.id }, include: withProduct });
    if (!item) throw new ApiError(404, 'Cart item not found');
    return toCartItem(item);
  }

  /** Adds to the line with the same product, size and color, or starts a new line. */
  async add(user: User, dto: AddToCartDto): Promise<CartItemResponse> {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new ApiError(404, 'Product not found');
    const size = resolveOption(product.sizes as string[], dto.size, 'size', product.name);
    const color = resolveOption(product.colors as string[], dto.color, 'color', product.name);
    const errors = [size, color].flatMap((r) => ('error' in r ? [r.error!] : []));
    if (errors.length) throw validationFailed(...errors);

    const key = { userId: user.id, productId: product.id, size: size.value ?? '', color: color.value ?? '' };
    const existing = await this.prisma.cartItem.findUnique({ where: { userId_productId_size_color: key } });
    if (!existing && (await this.prisma.cartItem.count({ where: { userId: user.id } })) >= MAX_ORDER_ITEMS) {
      throw new ApiError(409, `Your cart can hold at most ${MAX_ORDER_ITEMS} different items`);
    }
    const quantity = (existing?.quantity ?? 0) + dto.quantity;
    if (quantity > 1000) throw validationFailed('quantity can be at most 1000');
    assertInStock(product, quantity + (await this.inOtherLines(user.id, product.id, existing?.id)));

    const item = await this.prisma.cartItem.upsert({
      where: { userId_productId_size_color: key },
      create: { ...key, quantity },
      update: { quantity },
      include: withProduct,
    });
    return toCartItem(item);
  }

  async setQuantity(user: User, id: number, quantity: number): Promise<CartItemResponse> {
    const item = await this.prisma.cartItem.findFirst({ where: { id, userId: user.id }, include: withProduct });
    if (!item) throw new ApiError(404, 'Cart item not found');
    assertInStock(item.product, quantity + (await this.inOtherLines(user.id, item.productId, id)));
    return toCartItem(await this.prisma.cartItem.update({ where: { id }, data: { quantity }, include: withProduct }));
  }

  async remove(user: User, id: number): Promise<void> {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id, userId: user.id } });
    if (count === 0) throw new ApiError(404, 'Cart item not found');
  }

  async clear(user: User): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId: user.id } });
  }

  /** Places an order with everything in the cart, then empties the cart. */
  async checkout(user: User, dto: CheckoutDto): Promise<OrderResponse> {
    const lines = await this.prisma.cartItem.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } });
    if (lines.length === 0) throw new ApiError(400, 'Your cart is empty');
    const order = await this.orders.place(user, {
      ...dto,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, size: l.size || undefined, color: l.color || undefined })),
    });
    // Only the lines that were ordered, in case something was added meanwhile.
    await this.prisma.cartItem.deleteMany({ where: { id: { in: lines.map((l) => l.id) }, userId: user.id } });
    return order;
  }
}
