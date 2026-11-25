import { priceCart, type AppliedAmount, type CouponResult, type UnitPriceBreakdown } from './pricing';
import type { Menu, Poisha, Promotions, Selection } from './types';

/**
 * Shape of a stored order (decision D6). Money is integer poisha, like everywhere else.
 * `couponCode` is what the customer typed; `coupon.status` says what happened to it,
 * so "entered but not applied" is recorded explicitly instead of being lost.
 */
export interface StoredOrderLine {
  qty: number;
  options: Selection;
  unit: UnitPriceBreakdown;
  unitPrice: Poisha;
  lineTotal: Poisha;
}

export interface StoredOrderTotals {
  subtotal: Poisha;
  discount: AppliedAmount | null;
  discountedSubtotal: Poisha;
  vatBps: number;
  vat: Poisha;
  payableExact: Poisha;
  payable: Poisha;
}

export interface StoredOrder {
  id: string;
  /** Server time, ISO 8601 with the shop's offset. */
  createdAt: string;
  source: 'seed' | 'checkout';
  paymentMethod: string;
  currency: string;
  moneyUnit: 'poisha';
  couponCode: string | null;
  coupon: CouponResult | null;
  lines: StoredOrderLine[];
  totals: StoredOrderTotals;
}

export interface NewOrderInput {
  id: string;
  createdAt: string;
  source: StoredOrder['source'];
  paymentMethod: string;
  couponCode: string | null;
  lines: { qty: number; options: Selection }[];
}

/** Prices an order with the shared engine at its own createdAt. */
export function createStoredOrder(input: NewOrderInput, menu: Menu, promotions: Promotions, currency: string): StoredOrder {
  const pricing = priceCart({ lines: input.lines, couponCode: input.couponCode }, menu, promotions, input.createdAt);
  return {
    id: input.id,
    createdAt: input.createdAt,
    source: input.source,
    paymentMethod: input.paymentMethod,
    currency,
    moneyUnit: 'poisha',
    couponCode: input.couponCode,
    coupon: pricing.coupon,
    lines: pricing.lines.map((line) => ({
      qty: line.qty,
      options: line.options,
      unit: line.unit,
      unitPrice: line.unit.unitPrice,
      lineTotal: line.lineTotal,
    })),
    totals: {
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      discountedSubtotal: pricing.discountedSubtotal,
      vatBps: pricing.vatBps,
      vat: pricing.vat,
      payableExact: pricing.payableExact,
      payable: pricing.payable,
    },
  };
}
