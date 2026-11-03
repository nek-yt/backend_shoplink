import type { CartItem, Login, Order, OrderItem, Product, Review, User, WishlistItem } from '../generated/prisma/client';
import { DEFAULT_PRODUCT_IMAGE, defaultAvatarUrl } from '../images/images';
import type { AdminUserResponse, CartItemResponse, WishlistItemResponse, LoginResponse, OrderResponse, ProductResponse, ReviewResponse, UserResponse } from './responses';

// Prices are stored as whole cents (BIGINT) and sent as decimal numbers.
const fromCents = (cents: bigint) => Number(cents) / 100;

export function toUser(u: User): UserResponse {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    source: u.source,
    socialUsername: u.socialUsername,
    avatarUrl: u.avatarUrl ?? defaultAvatarUrl(u),
    hasAvatar: u.avatarUrl !== null,
    telegramId: u.telegramId === null ? null : Number(u.telegramId),
    tiktokId: u.tiktokId,
    instagramId: u.instagramId,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export function toAdminUser(u: User & { _count: { orders: number } }): AdminUserResponse {
  return {
    ...toUser(u),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    loginCount: u.loginCount,
    ordersCount: u._count.orders,
  };
}

export function toLogin(l: Login & { user: { name: string } }): LoginResponse {
  return { id: l.id, userId: l.userId, userName: l.user.name, method: l.method, createdAt: l.createdAt.toISOString() };
}

export function toProduct(p: Product & { seller?: User | null }): ProductResponse {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: fromCents(p.priceCents),
    rating: p.rating,
    stock: p.stock,
    inStock: p.stock > 0,
    sizes: p.sizes as string[],
    colors: p.colors as string[],
    category: p.category,
    imageUrl: p.imageUrl ?? DEFAULT_PRODUCT_IMAGE,
    hasImage: p.imageUrl !== null,
    images: p.images as string[],
    reviewsCount: p.reviewsCount,
    reviewsRating: p.reviewsRating,
    sellerId: p.sellerId,
    seller: p.seller
      ? {
          id: p.seller.id,
          name: p.seller.name,
          socialUsername: p.seller.socialUsername,
          avatarUrl: p.seller.avatarUrl ?? defaultAvatarUrl(p.seller),
          isAdmin: p.seller.role === 'admin',
        }
      : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toReview(r: Review & { user: User }): ReviewResponse {
  return {
    id: r.id,
    productId: r.productId,
    userId: r.userId,
    userName: r.user.name,
    userAvatarUrl: r.user.avatarUrl ?? defaultAvatarUrl(r.user),
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toWishlistItem(w: WishlistItem & { product: Product }): WishlistItemResponse {
  return { id: w.id, productId: w.productId, product: toProduct(w.product), createdAt: w.createdAt.toISOString() };
}

export function toCartItem(c: CartItem & { product: Product }): CartItemResponse {
  return {
    id: c.id,
    productId: c.productId,
    product: toProduct(c.product),
    size: c.size || null,
    color: c.color || null,
    quantity: c.quantity,
    price: fromCents(c.product.priceCents),
    subtotal: fromCents(c.product.priceCents * BigInt(c.quantity)),
    available: c.quantity <= c.product.stock,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toOrder(o: Order & { items: OrderItem[] }): OrderResponse {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    userId: o.userId,
    status: o.status,
    customerName: o.customerName,
    phone: o.phone,
    address: o.address,
    comment: o.comment,
    source: o.source,
    total: fromCents(o.totalCents),
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      sellerId: i.sellerId,
      size: i.size,
      color: i.color,
      quantity: i.quantity,
      price: fromCents(i.priceCents),
      subtotal: fromCents(i.priceCents * BigInt(i.quantity)),
    })),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
