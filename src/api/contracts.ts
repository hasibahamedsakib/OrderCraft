/**
 * HTTP contract between the browser app and the mock server (MSW).
 * Money is integer poisha. Times are ISO 8601 strings from the SERVER clock.
 */
import type { StoredOrder } from '../domain/orders';
import type { CartPricing } from '../domain/pricing';
import type { Shortage } from '../domain/stock';
import type { IngredientAmounts, Menu, PaymentMethod, Promotions, Selection } from '../domain/types';
import type { Violation } from '../domain/validate';

export interface WithServerTime {
  serverTime: string;
}

export interface MenuResponse extends WithServerTime {
  currency: string;
  timeZone: string;
  menu: Menu;
  promotions: Promotions;
  paymentMethods: PaymentMethod[];
  reservationTtlMs: number;
}

export type ReservationStatus = 'active' | 'expired';

export interface CartItemDTO {
  id: string;
  selection: Selection;
  qty: number;
  /** Ingredients this item holds right now ({} once expired). */
  allocation: IngredientAmounts;
  reservedAt: string;
  expiresAt: string;
  status: ReservationStatus;
  unitPrice: number;
  lineTotal: number;
}

export interface IngredientStockDTO {
  onHand: number;
  reserved: number;
  available: number;
}

export interface CartSnapshot extends WithServerTime {
  cart: {
    /** Changes when the demo data is reset, so clients drop old versions. */
    epoch: string;
    version: number;
    couponCode: string | null;
    items: CartItemDTO[];
  };
  /** Only tracked ingredients appear; anything else is unlimited. */
  stock: Record<string, IngredientStockDTO>;
  /** Price of the active items with the cart's coupon at serverTime. */
  pricing: CartPricing;
}

export interface AddItemRequest {
  idempotencyKey: string;
  selection: Selection;
  qty: number;
}

export interface AddItemResponse {
  itemId: string;
  /** true when the idempotency key was already used: nothing new was reserved. */
  replayed: boolean;
  snapshot: CartSnapshot;
}

export interface UpdateItemRequest {
  selection: Selection;
  qty: number;
  baseVersion: number;
}

export interface SetCouponRequest {
  code: string | null;
  /** Cart version the client saw; a stale tab gets 409 VERSION_CONFLICT instead of overwriting. */
  baseVersion?: number;
}

export interface CheckoutRequest {
  idempotencyKey: string;
  paymentMethod: string;
  baseVersion: number;
  /** The payable the user saw. If the server's price differs, it refuses with PRICE_CHANGED. */
  expectedPayable?: number;
}

export interface CheckoutResponse {
  order: StoredOrder;
  replayed: boolean;
  snapshot: CartSnapshot;
}

export interface OrdersResponse extends WithServerTime {
  orders: StoredOrder[];
}

export interface PriceRequest {
  lines: { qty: number; options: Selection }[];
  couponCode?: string | null;
}

export interface PriceResponse extends WithServerTime {
  pricing: CartPricing;
}

export interface DevSettings {
  /** Extra shift on top of the server's fixed +90 s skew. */
  clockOffsetMs: number;
  failNextReserve: boolean;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'INSUFFICIENT_STOCK'
  | 'RESERVATION_FAILED'
  | 'RESERVATION_EXPIRED'
  | 'VERSION_CONFLICT'
  | 'NOT_FOUND'
  | 'EMPTY_CART'
  | 'PRICE_CHANGED'
  | 'PRICING_UNAVAILABLE';

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  violations?: Violation[];
  shortages?: Shortage[];
  /** Fresh server state, so the client can resync without another request. */
  snapshot?: CartSnapshot;
}
