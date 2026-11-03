import { ApiProperty } from '@nestjs/swagger';
import { CATEGORIES, LOGIN_METHODS, ORDER_STATUSES, ROLES, SOURCES } from './constants';

// What the API sends back. These classes exist for the Swagger docs; the serializers build them.

export class ErrorResponse {
  /** @example Validation failed */
  message: string;
  /** Details, e.g. which fields are wrong. @example ["email must be a valid email"] */
  errors?: string[];
}

export class UserResponse {
  id: number;
  name: string;
  email: string | null;
  /** @example +998901234567 */
  phone: string | null;
  @ApiProperty({ enum: ROLES })
  role: string;
  @ApiProperty({ enum: SOURCES })
  source: string;
  /** TikTok / Instagram / Telegram username, without "@". */
  socialUsername: string | null;
  /** Profile picture. The default one (initials) when they haven't set one. @example /api/images/avatar.svg?name=Aziza%20Karimova&id=7 */
  avatarUrl: string;
  /** false when avatarUrl is the default picture. */
  hasAvatar: boolean;
  telegramId: number | null;
  /** Set when the user logged in with TikTok. */
  tiktokId: string | null;
  /** Set when the user logged in with Instagram. */
  instagramId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A user as admins see them: with login activity. */
export class AdminUserResponse extends UserResponse {
  /** null if they never logged in since login tracking was added. */
  lastLoginAt: string | null;
  /** Successful logins, registration included. */
  loginCount: number;
  ordersCount: number;
}

export class LoginResponse {
  id: number;
  userId: number;
  userName: string;
  /** How they got in. "register" is the email/phone sign-up itself. */
  @ApiProperty({ enum: LOGIN_METHODS })
  method: string;
  createdAt: string;
}

export class AdminUserDetailResponse extends AdminUserResponse {
  /** Their last 20 logins, newest first. */
  recentLogins: LoginResponse[];
}

class PeriodCounts {
  today: number;
  last7Days: number;
  last30Days: number;
}

class LoginCounts extends PeriodCounts {
  total: number;
}

class SourceCounts {
  tiktok: number;
  instagram: number;
  telegram: number;
  other: number;
}

class MethodCounts {
  register: number;
  password: number;
  telegram: number;
  tiktok: number;
  instagram: number;
}

class DayStats {
  /** @example 2026-10-28 */
  date: string;
  /** New users that day. */
  registered: number;
  /** Different users who logged in that day. */
  activeUsers: number;
  /** All successful logins that day. */
  logins: number;
}

export class UserStatsResponse {
  /** Everyone in the database, admins included. */
  totalUsers: number;
  customers: number;
  admins: number;
  /** Users by where they came from. */
  bySource: SourceCounts;
  /** New users. "today" is in STATS_TIME_ZONE; "last7Days" includes today. */
  registered: PeriodCounts;
  /** Different users who logged in (or registered). */
  activeUsers: PeriodCounts;
  /** All successful logins and registrations. */
  logins: LoginCounts;
  /** All-time logins by method. */
  loginsByMethod: MethodCounts;
  /** Users who have never logged in since login tracking was added. */
  neverLoggedIn: number;
  /** @example Asia/Tashkent */
  timeZone: string;
  /** One entry per day, oldest first (see the `days` parameter). */
  daily: DayStats[];
}

export class AuthResponse {
  /** JWT. Send it as `Authorization: Bearer <token>` (or click Authorize above). */
  token: string;
  user: UserResponse;
}

export class OAuthUrlResponse {
  /** Send the user here. They come back to your redirect URI with `?code=...&state=...`. */
  url: string;
}

/** The public part of a seller, sent with their products. */
export class ProductSellerResponse {
  id: number;
  /** @example Aziza Karimova */
  name: string;
  /** @example aziza.style */
  socialUsername: string | null;
  avatarUrl: string;
  /** true for admins: the shop shows a badge next to their name. */
  isAdmin: boolean;
}

export class ProductResponse {
  id: number;
  /** @example Oversize Hoodie */
  name: string;
  description: string;
  /** @example 249000 */
  price: number;
  /** 0 to 5. @example 4.7 */
  rating: number;
  /** How many are left. */
  stock: number;
  inStock: boolean;
  /** @example ["S", "M", "L"] */
  sizes: string[];
  /** @example ["black", "beige"] */
  colors: string[];
  @ApiProperty({ enum: CATEGORIES })
  category: string;
  /** The product picture, or the default "No image" picture. @example /api/uploads/products/3f2a….jpg */
  imageUrl: string;
  /** false when imageUrl is the default picture. */
  hasImage: boolean;
  /** More pictures, shown after imageUrl. @example ["/api/uploads/products/9c1d….jpg"] */
  images: string[];
  /** How many customer reviews it has. */
  reviewsCount: number;
  /** Average stars of those reviews, 1 to 5 (null when there are none). @example 4.5 */
  reviewsRating: number | null;
  /** The user who sells it (null if that account was deleted). */
  sellerId: number | null;
  /** Who sells it: name, @username and picture (null if that account was deleted). */
  @ApiProperty({ type: ProductSellerResponse, nullable: true })
  seller: ProductSellerResponse | null;
  createdAt: string;
  updatedAt: string;
}

export class OrderItemResponse {
  id: number;
  /** null once the product has been deleted (the order keeps its name and price). */
  productId: number | null;
  productName: string;
  /** Who sold this item. */
  sellerId: number | null;
  size: string | null;
  color: string | null;
  quantity: number;
  /** Price of one item when the order was placed. */
  price: number;
  subtotal: number;
}

export class OrderResponse {
  id: number;
  /** Unique random order number to show the customer. @example SL-7K3F9QX2 */
  orderNumber: string;
  userId: number;
  @ApiProperty({ enum: ORDER_STATUSES })
  status: string;
  customerName: string;
  phone: string;
  address: string;
  comment: string | null;
  @ApiProperty({ enum: SOURCES })
  source: string;
  total: number;
  items: OrderItemResponse[];
  createdAt: string;
  updatedAt: string;
}

class PageResponse {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export class ProductPageResponse extends PageResponse {
  items: ProductResponse[];
}

export class OrderPageResponse extends PageResponse {
  items: OrderResponse[];
}

export class AdminUserPageResponse extends PageResponse {
  items: AdminUserResponse[];
}

export class LoginPageResponse extends PageResponse {
  items: LoginResponse[];
}

export class ReviewResponse {
  id: number;
  productId: number;
  userId: number;
  /** @example Aziza Karimova */
  userName: string;
  userAvatarUrl: string;
  /** 1 to 5. @example 5 */
  rating: number;
  /** @example Great quality, fits perfectly */
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export class ReviewPageResponse extends PageResponse {
  items: ReviewResponse[];
}

export class WishlistItemResponse {
  id: number;
  productId: number;
  product: ProductResponse;
  /** When it was added. */
  createdAt: string;
}

export class WishlistPageResponse extends PageResponse {
  items: WishlistItemResponse[];
}

export class CartItemResponse {
  id: number;
  productId: number;
  product: ProductResponse;
  size: string | null;
  color: string | null;
  quantity: number;
  /** Today's price of one item. */
  price: number;
  subtotal: number;
  /** false when there is less stock left than this line asks for. */
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export class CartResponse {
  items: CartItemResponse[];
  /** Number of pieces in the cart. */
  totalQuantity: number;
  total: number;
}

export class HealthResponse {
  /** @example ok */
  status: string;
  /** @example ok */
  database: string;
}
