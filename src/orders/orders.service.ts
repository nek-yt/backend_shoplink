import { Injectable } from '@nestjs/common';
import crypto from 'crypto';
import { ApiError, validationFailed } from '../common/api-error';
import { type OrderStatus, STATUS_TRANSITIONS } from '../common/constants';
import { paginate } from '../common/query';
import type { OrderPageResponse, OrderResponse } from '../common/responses';
import { toOrder } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import type { Order, OrderItem, Product, User } from '../generated/prisma/client';
import type { CreateOrderDto } from './dto/order.dto';

const withItems = { items: { orderBy: { id: 'asc' } } } as const;

// No 0/O, 1/I/L, so the number is easy to read out over the phone.
const ORDER_NUMBER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A random order number like SL-7K3F9QX2. 31^8 ≈ 850 billion possibilities, and the column is unique. */
export function newOrderNumber(): string {
  const bytes = crypto.randomBytes(8);
  return 'SL-' + Array.from(bytes, (b) => ORDER_NUMBER_ALPHABET[b % ORDER_NUMBER_ALPHABET.length]).join('');
}

// Returns the product's own spelling of the chosen option, or an error message.
export function resolveOption(available: string[], chosen: string | undefined, label: string, productName: string) {
  if (available.length === 0) {
    return chosen === undefined ? { value: null } : { error: `"${productName}" has no ${label} options` };
  }
  if (chosen === undefined) return { error: `${label} is required for "${productName}" (available: ${available.join(', ')})` };
  const match = available.find((a) => a.toLowerCase() === chosen.toLowerCase());
  return match ? { value: match } : { error: `${label} "${chosen}" is not available for "${productName}" (available: ${available.join(', ')})` };
}

// For sellers: the order already holds only their items; its total becomes the sum of those items.
function onlyMyTotal(o: Order & { items: OrderItem[] }): OrderResponse {
  return toOrder({ ...o, totalCents: o.items.reduce((sum, i) => sum + i.priceCents * BigInt(i.quantity), 0n) });
}

export interface OrderFilters {
  status?: OrderStatus;
  userId?: number;
  page: number;
  limit: number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async load(id: number): Promise<OrderResponse> {
    return toOrder(await this.prisma.order.findUniqueOrThrow({ where: { id }, include: withItems }));
  }

  // Admins can see every order; customers only their own. Others get 404 so ids aren't leaked.
  private async findVisible(user: User, id: number): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || (user.role !== 'admin' && order.userId !== user.id)) throw new ApiError(404, 'Order not found');
    return order;
  }

  async place(user: User, dto: CreateOrderDto): Promise<OrderResponse> {
    const phone = dto.phone ?? user.phone;
    if (!phone) throw validationFailed('phone is required');

    const orderId = await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE locks these products until the transaction ends, so two customers can't both buy
      // the last item. Locking in id order keeps simultaneous orders from deadlocking each other.
      const ids = [...new Set(dto.items.map((i) => i.productId))];
      await tx.$queryRaw`SELECT id FROM products WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
      const products = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]));

      const errors: string[] = [];
      const needed = new Map<number, number>();
      const lines: { product: Product; size: string | null; color: string | null; quantity: number }[] = [];
      dto.items.forEach((item, i) => {
        const product = products.get(item.productId);
        if (!product) {
          errors.push(`items[${i}]: product ${item.productId} not found`);
          return;
        }
        const size = resolveOption(product.sizes as string[], item.size, 'size', product.name);
        const color = resolveOption(product.colors as string[], item.color, 'color', product.name);
        if ('error' in size) errors.push(`items[${i}]: ${size.error}`);
        if ('error' in color) errors.push(`items[${i}]: ${color.error}`);
        needed.set(product.id, (needed.get(product.id) ?? 0) + item.quantity);
        lines.push({ product, size: size.value ?? null, color: color.value ?? null, quantity: item.quantity });
      });
      if (errors.length) throw validationFailed(...errors);

      for (const [id, qty] of needed) {
        const product = products.get(id)!;
        if (product.stock < qty) errors.push(`"${product.name}": requested ${qty}, only ${product.stock} left`);
      }
      // Throwing inside the transaction rolls everything back.
      if (errors.length) throw new ApiError(409, 'Not enough stock', errors);

      for (const [id, qty] of needed) {
        await tx.product.update({ where: { id }, data: { stock: { decrement: qty } } });
      }

      const order = await tx.order.create({
        data: {
          orderNumber: newOrderNumber(),
          userId: user.id,
          status: 'new',
          customerName: dto.customerName ?? user.name,
          phone,
          address: dto.address,
          comment: dto.comment || null,
          source: user.source,
          totalCents: lines.reduce((sum, l) => sum + l.product.priceCents * BigInt(l.quantity), 0n),
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              productName: l.product.name,
              sellerId: l.product.sellerId,
              size: l.size,
              color: l.color,
              quantity: l.quantity,
              priceCents: l.product.priceCents,
            })),
          },
        },
      });
      return order.id;
    });
    return this.load(orderId);
  }

  /** Only the user's own orders, admins included. */
  mine(user: User, f: Omit<OrderFilters, 'userId'>): Promise<OrderPageResponse> {
    return this.page({ userId: user.id, ...(f.status && { status: f.status }) }, f);
  }

  /** Everyone's orders, for admins. */
  all(f: OrderFilters): Promise<OrderPageResponse> {
    return this.page({ ...(f.userId !== undefined && { userId: f.userId }), ...(f.status && { status: f.status }) }, f);
  }

  private async page(where: { userId?: number; status?: string }, f: { page: number; limit: number }): Promise<OrderPageResponse> {
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, orderBy: { id: 'desc' }, skip: (f.page - 1) * f.limit, take: f.limit, include: withItems }),
    ]);
    return { items: rows.map(toOrder), ...paginate(total, f.page, f.limit) };
  }

  // Orders that include the seller's products. Each order shows only the seller's own items, and
  // `total` is the sum of those items.
  async sales(seller: User, f: Omit<OrderFilters, 'userId'>): Promise<OrderPageResponse> {
    const where = { items: { some: { sellerId: seller.id } }, ...(f.status && { status: f.status }) };
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (f.page - 1) * f.limit,
        take: f.limit,
        include: { items: { where: { sellerId: seller.id }, orderBy: { id: 'asc' } } },
      }),
    ]);
    return { items: rows.map(onlyMyTotal), ...paginate(total, f.page, f.limit) };
  }

  async sale(seller: User, id: number): Promise<OrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id, items: { some: { sellerId: seller.id } } },
      include: { items: { where: { sellerId: seller.id }, orderBy: { id: 'asc' } } },
    });
    if (!order) throw new ApiError(404, 'Order not found');
    return onlyMyTotal(order);
  }

  async getByNumber(user: User, orderNumber: string): Promise<OrderResponse> {
    const order = await this.prisma.order.findUnique({ where: { orderNumber: orderNumber.toUpperCase() } });
    if (!order) throw new ApiError(404, 'Order not found');
    return this.get(user, order.id);
  }

  async get(user: User, id: number): Promise<OrderResponse> {
    const order = await this.findVisible(user, id);
    return this.load(order.id);
  }

  async cancel(user: User, id: number): Promise<OrderResponse> {
    // Only the customer cancels here, even admins can't cancel someone else's order this way (they use /status).
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== user.id) throw new ApiError(404, 'Order not found');
    if (order.status !== 'new') throw new ApiError(409, `Order can't be cancelled because it is already ${order.status}`);
    await this.changeStatus(order, 'cancelled');
    return this.load(order.id);
  }

  async setStatus(user: User, id: number, status: OrderStatus): Promise<OrderResponse> {
    const order = await this.findVisible(user, id);
    const allowed = STATUS_TRANSITIONS[order.status as OrderStatus];
    if (!allowed.includes(status)) {
      throw new ApiError(
        409,
        `Can't change status from ${order.status} to ${status}` + (allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''),
      );
    }
    await this.changeStatus(order, status);
    return this.load(order.id);
  }

  private changeStatus(order: Order, status: OrderStatus) {
    return this.prisma.$transaction(async (tx) => {
      // Only succeeds if nobody changed the status in the meantime, so a double click on "cancel"
      // can't return the stock twice.
      const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status } });
      if (count === 0) throw new ApiError(409, 'Order status was just changed by someone else, please reload it');
      if (status === 'cancelled') {
        await tx.$executeRaw`
          UPDATE products p SET stock = p.stock + i.qty, updated_at = now()
          FROM (SELECT product_id, SUM(quantity) AS qty FROM order_items
                WHERE order_id = ${order.id} AND product_id IS NOT NULL GROUP BY product_id) i
          WHERE p.id = i.product_id`;
      }
    });
  }
}
