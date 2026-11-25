import { groupUnitsById, indexOptions, qtyOf } from './menu';
import { percentOf, roundToWholeTaka } from './money';
import { parseClock, secondsOfDay, toEpochMs, toZonedIso } from './time';
import type {
  CartDiscount,
  CartInput,
  ComboPercentOffPromotion,
  CouponPercentOffDiscount,
  FreeCheapestUnitsPromotion,
  ItemPromotion,
  Menu,
  Poisha,
  Promotions,
  Selection,
} from './types';

/*
 * Pricing order (from the brief), all in integer poisha:
 *   1. unit subtotal = base + sum(option price x option qty)
 *   2. item promotions, per unit, in array order (P2 extras deal, then P1 combo on the step-2 amount)
 *   3. line total = unit price x qty; cart subtotal = sum of lines
 *   4. one cart discount: the larger of the eligible ones; tie -> lowest priority (C1)
 *   5. VAT on the discounted subtotal; payable = discounted + VAT rounded half-up to whole BDT
 * Percentages round half-up to the poisha at each step.
 */

export interface AppliedAmount {
  id: string;
  label: string;
  amount: Poisha;
}

export interface UnitPriceBreakdown {
  base: Poisha;
  optionsTotal: Poisha;
  /** Step 1. */
  subtotal: Poisha;
  /** Step 2 discounts that applied, in order. */
  promotions: AppliedAmount[];
  /** After step 2. */
  unitPrice: Poisha;
}

export interface PricedLine {
  qty: number;
  options: Selection;
  unit: UnitPriceBreakdown;
  lineTotal: Poisha;
}

export type CouponStatus = 'applied' | 'unknown' | 'outside_hours' | 'not_best';

export interface CouponResult {
  code: string;
  status: CouponStatus;
  message: string;
}

export interface DiscountCandidate extends AppliedAmount {
  eligible: boolean;
  reason: string;
}

export interface CartPricing {
  lines: PricedLine[];
  subtotal: Poisha;
  candidates: DiscountCandidate[];
  discount: AppliedAmount | null;
  coupon: CouponResult | null;
  discountedSubtotal: Poisha;
  vatBps: number;
  vat: Poisha;
  /** discountedSubtotal + vat, before rounding to whole BDT. */
  payableExact: Poisha;
  /** Rounded half-up to whole BDT (still in poisha, always a multiple of 100). */
  payable: Poisha;
  pricedAt: string;
}

export function priceUnit(selection: Selection, menu: Menu, promotions: Promotions): UnitPriceBreakdown {
  const index = indexOptions(menu.groups);
  let optionsTotal = 0;
  for (const [optionId, qty] of Object.entries(selection)) {
    const entry = index.get(optionId);
    if (entry && qty > 0) optionsTotal += entry.option.price * qty;
  }
  const base = menu.product.basePrice;
  const subtotal = base + optionsTotal;

  let running = subtotal;
  const applied: AppliedAmount[] = [];
  for (const promo of promotions.itemPromotions) {
    const amount = itemPromotionAmount(promo, selection, menu, running);
    if (amount > 0) {
      applied.push({ id: promo.id, label: promo.label, amount });
      running -= amount;
    }
  }
  return { base, optionsTotal, subtotal, promotions: applied, unitPrice: running };
}

function itemPromotionAmount(promo: ItemPromotion, selection: Selection, menu: Menu, running: Poisha): Poisha {
  switch (promo.type) {
    case 'freeCheapestUnits':
      return freeCheapestAmount(promo, selection, menu);
    case 'comboPercentOff':
      return comboApplies(promo, selection, menu) ? percentOf(running, promo.percentBps) : 0;
  }
}

/** floor(units / every) x freeUnits cheapest unit prices in the group are free. */
function freeCheapestAmount(promo: FreeCheapestUnitsPromotion, selection: Selection, menu: Menu): Poisha {
  const group = menu.groups.find((g) => g.id === promo.groupId);
  if (!group || promo.every <= 0) return 0;
  const unitPrices: Poisha[] = [];
  for (const option of group.options) {
    for (let i = 0; i < qtyOf(selection, option.id); i++) unitPrices.push(option.price);
  }
  const freeCount = Math.floor(unitPrices.length / promo.every) * promo.freeUnits;
  return unitPrices
    .sort((a, b) => a - b)
    .slice(0, freeCount)
    .reduce((sum, price) => sum + price, 0);
}

function comboApplies(promo: ComboPercentOffPromotion, selection: Selection, menu: Menu): boolean {
  return promo.conditions.every((c) => groupUnitsById(selection, menu.groups, c.groupId) >= c.minUnits);
}

export function isCouponWithinHours(discount: CouponPercentOffDiscount, serverTime: Date | number | string): boolean {
  return secondsOfDay(serverTime, discount.timeZone) < parseClock(discount.validBefore);
}

function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

function evaluateDiscount(
  discount: CartDiscount,
  subtotal: Poisha,
  couponCode: string,
  serverTime: number,
): DiscountCandidate | null {
  if (discount.type === 'thresholdAmountOff') {
    const eligible = subtotal >= discount.minSubtotal;
    return {
      id: discount.id,
      label: discount.label,
      amount: eligible ? Math.min(discount.amountOff, subtotal) : 0,
      eligible,
      reason: eligible ? 'Subtotal reaches the threshold' : 'Subtotal is below the threshold',
    };
  }
  // coupon: only considered when the user entered this code
  if (couponCode !== normalizeCode(discount.code)) return null;
  const withinHours = isCouponWithinHours(discount, serverTime);
  return {
    id: discount.id,
    label: discount.label,
    amount: withinHours ? Math.min(percentOf(subtotal, discount.percentBps), discount.cap, subtotal) : 0,
    eligible: withinHours,
    reason: withinHours
      ? 'Coupon is valid at this time'
      : `Valid only before ${discount.validBefore} (${discount.timeZone})`,
  };
}

function priorityOf(promotions: Promotions, id: string): number {
  return promotions.cartDiscounts.find((d) => d.id === id)?.priority ?? Number.MAX_SAFE_INTEGER;
}

export function priceCart(
  cart: CartInput,
  menu: Menu,
  promotions: Promotions,
  serverTime: Date | number | string,
): CartPricing {
  const now = toEpochMs(serverTime);

  const lines: PricedLine[] = cart.lines.map((line) => {
    const unit = priceUnit(line.options, menu, promotions);
    return { qty: line.qty, options: line.options, unit, lineTotal: unit.unitPrice * line.qty };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  const code = normalizeCode(cart.couponCode);
  const candidates = promotions.cartDiscounts
    .map((d) => evaluateDiscount(d, subtotal, code, now))
    .filter((c): c is DiscountCandidate => c !== null);

  const best = candidates
    .filter((c) => c.eligible && c.amount > 0)
    .sort((a, b) => b.amount - a.amount || priorityOf(promotions, a.id) - priorityOf(promotions, b.id))[0];
  const discount: AppliedAmount | null = best ? { id: best.id, label: best.label, amount: best.amount } : null;

  const discountedSubtotal = subtotal - (discount?.amount ?? 0);
  const vat = percentOf(discountedSubtotal, promotions.vatBps);
  const payableExact = discountedSubtotal + vat;
  const tz = promotions.cartDiscounts.find((d): d is CouponPercentOffDiscount => d.type === 'couponPercentOff')?.timeZone;

  return {
    lines,
    subtotal,
    candidates,
    discount,
    coupon: code ? couponResult(cart.couponCode ?? '', promotions, candidates, discount) : null,
    discountedSubtotal,
    vatBps: promotions.vatBps,
    vat,
    payableExact,
    payable: roundToWholeTaka(payableExact),
    pricedAt: tz ? toZonedIso(now, tz) : new Date(now).toISOString(),
  };
}

function couponResult(
  rawCode: string,
  promotions: Promotions,
  candidates: DiscountCandidate[],
  applied: AppliedAmount | null,
): CouponResult {
  const code = rawCode.trim();
  const coupon = promotions.cartDiscounts.find(
    (d): d is CouponPercentOffDiscount => d.type === 'couponPercentOff' && normalizeCode(d.code) === normalizeCode(code),
  );
  if (!coupon) return { code, status: 'unknown', message: `"${code}" is not a valid coupon.` };
  const candidate = candidates.find((c) => c.id === coupon.id);
  if (!candidate?.eligible) {
    return {
      code,
      status: 'outside_hours',
      message: `${coupon.code} is only valid before ${coupon.validBefore} (${coupon.timeZone}).`,
    };
  }
  if (applied?.id === coupon.id) return { code, status: 'applied', message: `${coupon.code} applied.` };
  return {
    code,
    status: 'not_best',
    message: `${coupon.code} is valid, but ${applied?.label ?? 'another discount'} saves the same or more. Only one discount applies.`,
  };
}
