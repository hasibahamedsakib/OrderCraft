import { roundHalfUpDiv } from './money';
import type { StoredOrder } from './orders';
import { zonedDate } from './time';
import type { Menu, Poisha } from './types';

/*
 * Pure sales statistics over stored orders. The assistant's tools call these;
 * the model never adds numbers itself. Revenue = sum of `totals.payable`
 * (what customers actually paid, VAT included).
 */

export function orderCount(orders: StoredOrder[]): number {
  return orders.length;
}

export function totalRevenue(orders: StoredOrder[]): Poisha {
  return orders.reduce((sum, order) => sum + order.totals.payable, 0);
}

export interface OptionUnits {
  optionId: string;
  name: string;
  units: number;
}

/** Units = line qty x option qty, summed over all orders. Highest first; ties sorted by name. */
export function optionUnitsRanking(orders: StoredOrder[], menu?: Menu): OptionUnits[] {
  const names = new Map<string, string>();
  for (const group of menu?.groups ?? []) for (const option of group.options) names.set(option.id, option.name);

  const units = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.lines) {
      for (const [optionId, qty] of Object.entries(line.options)) {
        if (qty > 0) units.set(optionId, (units.get(optionId) ?? 0) + line.qty * qty);
      }
    }
  }
  return [...units.entries()]
    .map(([optionId, count]) => ({ optionId, name: names.get(optionId) ?? optionId, units: count }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/** Every option tied for the most units (usually one). */
export function bestSellingOptions(orders: StoredOrder[], menu?: Menu): OptionUnits[] {
  const ranking = optionUnitsRanking(orders, menu);
  const top = ranking[0]?.units;
  return top === undefined ? [] : ranking.filter((r) => r.units === top);
}

export interface PaymentMethodRevenue {
  paymentMethod: string;
  orders: number;
  revenue: Poisha;
}

export function revenueByPaymentMethod(orders: StoredOrder[]): PaymentMethodRevenue[] {
  const byMethod = new Map<string, PaymentMethodRevenue>();
  for (const order of orders) {
    const row = byMethod.get(order.paymentMethod) ?? { paymentMethod: order.paymentMethod, orders: 0, revenue: 0 };
    row.orders += 1;
    row.revenue += order.totals.payable;
    byMethod.set(order.paymentMethod, row);
  }
  return [...byMethod.values()].sort((a, b) => b.revenue - a.revenue || a.paymentMethod.localeCompare(b.paymentMethod));
}

/** Rounded half-up to the poisha. 0 when there are no orders. */
export function averageOrderValue(orders: StoredOrder[]): Poisha {
  return orders.length === 0 ? 0 : roundHalfUpDiv(totalRevenue(orders), orders.length);
}

export interface CouponUsage {
  code: string | null;
  ordersWithCode: number;
  ordersDiscounted: number;
  discountedOrderIds: string[];
  notApplied: { orderId: string; reason: string }[];
}

/**
 * "Got the coupon" means the coupon's discount was the one applied to the order,
 * not just that a code was typed. `code` filters to one code (case-insensitive).
 */
export function couponUsage(orders: StoredOrder[], code?: string | null): CouponUsage {
  const wanted = code?.trim().toUpperCase() || null;
  const withCode = orders.filter((o) => {
    const entered = o.couponCode?.trim().toUpperCase();
    return entered && (wanted === null || entered === wanted);
  });
  const discounted = withCode.filter((o) => o.coupon?.status === 'applied');
  return {
    code: wanted,
    ordersWithCode: withCode.length,
    ordersDiscounted: discounted.length,
    discountedOrderIds: discounted.map((o) => o.id),
    notApplied: withCode
      .filter((o) => o.coupon?.status !== 'applied')
      .map((o) => ({ orderId: o.id, reason: o.coupon?.message ?? 'Coupon was not applied.' })),
  };
}

export interface OrdersOnDate {
  date: string;
  count: number;
  revenue: Poisha;
  orders: { id: string; createdAt: string; paymentMethod: string; payable: Poisha }[];
}

/** `date` is "YYYY-MM-DD" in the shop's time zone. */
export function ordersOnDate(orders: StoredOrder[], date: string, timeZone: string): OrdersOnDate {
  const matching = orders.filter((o) => zonedDate(o.createdAt, timeZone) === date);
  return {
    date,
    count: matching.length,
    revenue: totalRevenue(matching),
    orders: matching.map((o) => ({ id: o.id, createdAt: o.createdAt, paymentMethod: o.paymentMethod, payable: o.totals.payable })),
  };
}
