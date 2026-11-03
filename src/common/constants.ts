export const SOURCES = ['tiktok', 'instagram', 'telegram', 'other'] as const;
export const ROLES = ['customer', 'admin'] as const;
export const LOGIN_METHODS = ['register', 'password', 'telegram', 'tiktok', 'instagram'] as const;
export const ORDER_STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
/** What a product is, for browsing the shop by category. Products made before categories are 'other'. */
export const CATEGORIES = ['hoodies', 't-shirts', 'jeans', 'dresses', 'bags', 'shoes', 'jackets', 'accessories', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Why a product was reported (CHECK in migrations/20261103120000_reports). */
export const REPORT_REASONS = ['fake', 'scam', 'offensive', 'wrong_info', 'prohibited', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** open: waiting for an admin; resolved: the admin acted; dismissed: nothing wrong. */
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type Source = (typeof SOURCES)[number];
export type LoginMethod = (typeof LOGIN_METHODS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

// Ids are PostgreSQL INTEGER columns.
export const MAX_ID = 2_147_483_647;
export const MAX_PRICE = 100_000_000;
export const MAX_ORDER_ITEMS = 50;
