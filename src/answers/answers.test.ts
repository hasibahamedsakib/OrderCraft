/**
 * ANSWERS.md is generated from this file:  pnpm answers
 * Every number below is computed by the real engines; the asserts pin them.
 */
import type { ApiErrorBody } from '../api/contracts';
import { formatTaka } from '../domain/money';
import { createStoredOrder } from '../domain/orders';
import { priceCart, priceUnit, type CartPricing } from '../domain/pricing';
import { bestSellingOptions, couponUsage, optionUnitsRanking, revenueByPaymentMethod, totalRevenue } from '../domain/stats';
import { formatShortages, limitingIngredients, maxUnitsOf } from '../domain/stock';
import type { MenuGroup, Rule, Selection } from '../domain/types';
import { validate } from '../domain/validate';
import { loadFixture, loadSeedOrders } from '../mocks/fixture';
import { createMockServer } from '../mocks/server';
import { memoryStorage } from '../mocks/storage';
import { A, B, C, dhaka } from '../test/configs';

const fixture = loadFixture();
const { menu, promotions } = fixture;
const bdt = (p: number) => `${formatTaka(p)} BDT`;
const out: string[] = [];
const log = (line = '') => out.push(line);

function breakdown(p: CartPricing): string {
  return [
    `subtotal ${bdt(p.subtotal)}`,
    `discount ${p.discount ? `${p.discount.id} ${bdt(p.discount.amount)}` : 'none'}`,
    `discounted ${bdt(p.discountedSubtotal)}`,
    `VAT ${bdt(p.vat)}`,
    `exact ${bdt(p.payableExact)}`,
    `payable ${bdt(p.payable)}`,
  ].join(' | ');
}

/** Every combination of option quantities a group allows on its own (min/max/step/distinct/perOption). */
function groupCombos(group: MenuGroup, rules: Rule[]): Selection[] {
  const overrideMaxes = rules.flatMap((r) => (r.type === 'overrideLimit' && r.group === group.id ? [r.max] : []));
  const cap = Math.max(group.max ?? 6, ...overrideMaxes);
  const perOption = Math.min(group.maxPerOption ?? cap, cap);
  let combos: Selection[] = [{}];
  for (const option of group.options) {
    const next: Selection[] = [];
    for (const combo of combos) {
      for (let q = 0; q <= perOption; q++) next.push(q > 0 ? { ...combo, [option.id]: q } : combo);
    }
    combos = next;
  }
  return combos.filter((combo) => {
    const qtys = Object.values(combo);
    const total = qtys.reduce((a, b) => a + b, 0);
    return (
      total >= group.min &&
      total <= cap &&
      (!group.step || total % group.step === 0) &&
      (group.maxDistinct === undefined || qtys.length <= group.maxDistinct)
    );
  });
}

describe('ANSWERS.md', () => {
  afterAll(() => {
    console.log(`\n${out.join('\n')}\n`);
  });

  it('Q1: max number of item C from an empty cart', () => {
    const max = maxUnitsOf(C, menu.groups, fixture.initialStock);
    const limiting = limitingIngredients(C, menu.groups, fixture.initialStock);
    // confirm on the mock server: C x2 fits, a third C does not
    const server = createMockServer({ storage: memoryStorage(), now: () => Date.parse(dhaka('09:00:00')) });
    expect(server.addItem({ idempotencyKey: 'answers-q1-aaaa', selection: C, qty: 2 }).status).toBe(201);
    const third = server.addItem({ idempotencyKey: 'answers-q1-bbbb', selection: C, qty: 1 });
    const shortText = formatShortages((third.body as ApiErrorBody).shortages ?? [], menu.ingredients);

    log('Q1');
    log(`  max units of C = ${max}; limiting ingredient(s): ${limiting.join(', ')}`);
    log(`  C uses per unit: egg 2, cheese 2, ...; cheese stock 4 -> floor(4/2) = 2 (eggs would allow 5)`);
    log(`  server check: C x2 reserved; one more C -> ${third.status} "${shortText}"`);
    expect(max).toBe(2);
    expect(limiting).toEqual(['cheese']);
    expect(shortText).toBe('Short: 2 cheese');
  });

  it('Q2: cheapest valid configuration', () => {
    const perGroup = menu.groups.map((g) => groupCombos(g, menu.rules));
    let best: { selection: Selection; price: number } | null = null;
    let checked = 0;
    const walk = (i: number, acc: Selection) => {
      if (i === perGroup.length) {
        checked++;
        if (validate(acc, menu.groups, menu.rules).length > 0) return;
        const price = priceUnit(acc, menu, promotions).unitPrice;
        if (!best || price < best.price) best = { selection: acc, price };
        return;
      }
      for (const combo of perGroup[i]!) walk(i + 1, { ...acc, ...combo });
    };
    walk(0, {});
    const found = best as { selection: Selection; price: number } | null;
    log('Q2');
    log(`  searched ${checked} combinations allowed by each group; cheapest valid:`);
    log(`  ${JSON.stringify(found?.selection)} = ${bdt(found?.price ?? 0)}`);
    log('  (250 base + Toast 0 + Fried x2 60 + Tofu 50; free sauces do not change the price)');
    expect(found?.price).toBe(36_000);
  }, 60_000); // exhaustive search over ~1.4M combinations

  it('Q3: cart A x3 at 10:30 and 11:30', () => {
    const cart = { lines: [{ qty: 3, options: A }], couponCode: 'MORNING15' };
    const morning = priceCart(cart, menu, promotions, dhaka('10:30:00'));
    const late = priceCart(cart, menu, promotions, dhaka('11:30:00'));
    log('Q3 (coupon MORNING15 entered)');
    log('  A = 250 + Toast 0 + Scrambled 2x35 + Sausage 60 + Ketchup 0 = 380.00; no promo applies');
    log('  subtotal = 3 x 380.00 = 1,140.00 (below 1,200, so C1 is not eligible)');
    log(`  10:30 C2 = min(15% of 1,140.00 = 171.00, cap 150.00) = 150.00 -> 990.00; VAT 5% = 49.50; 1,039.50 -> half-up -> 1,040`);
    log(`        ${breakdown(morning)}`);
    log('  11:30 coupon outside hours, C1 not eligible -> no discount; VAT 5% of 1,140.00 = 57.00; 1,197.00 -> 1,197');
    log(`        ${breakdown(late)}`);
    expect([morning.subtotal, morning.discount?.amount, morning.vat, morning.payable]).toEqual([114_000, 15_000, 4_950, 104_000]);
    expect([late.subtotal, late.discount, late.vat, late.payable]).toEqual([114_000, null, 5_700, 119_700]);
  });

  it('Q4: after TC-10, payable at 11:30', () => {
    const bEdited = { ...B, omelette: 1, fried: 3 };
    const p = priceCart(
      { lines: [{ qty: 1, options: bEdited }, { qty: 2, options: C }], couponCode: null },
      menu,
      promotions,
      dhaka('11:30:00'),
    );
    log('Q4');
    log(`  B' (Omelette x1 + Fried x3) = 643.50, C x2 = 980.00 -> ${breakdown(p)}`);
    expect(p.payable).toBe(160_000);
  });

  const seedOrders = loadSeedOrders().map((seed) => createStoredOrder({ ...seed, source: 'seed' }, menu, promotions, fixture.currency));

  it('Q5: payable of each seed order and total revenue', () => {
    log('Q5');
    for (const o of seedOrders) {
      log(`  ${o.id} ${o.createdAt} ${o.paymentMethod.padEnd(5)} coupon=${o.couponCode ?? '-'} -> ${bdt(o.totals.payable)}  (${breakdown({ ...o.totals, lines: [], candidates: [], coupon: null, pricedAt: '' } as CartPricing)})`);
    }
    log(`  total revenue = ${bdt(totalRevenue(seedOrders))}`);
    expect(totalRevenue(seedOrders)).toBe(499_500);
  });

  it('Q6: best-selling option by units', () => {
    const ranking = optionUnitsRanking(seedOrders, menu);
    log('Q6');
    log(`  ranking: ${ranking.map((r) => `${r.name} ${r.units}`).join(', ')}`);
    log(`  best: ${bestSellingOptions(seedOrders, menu).map((b) => `${b.name} (${b.units} units)`).join(', ')}`);
    expect(bestSellingOptions(seedOrders, menu)).toEqual([{ optionId: 'fried', name: 'Fried', units: 10 }]);
  });

  it('Q7: revenue by payment method', () => {
    const rows = revenueByPaymentMethod(seedOrders);
    log('Q7');
    for (const r of rows) log(`  ${r.paymentMethod.padEnd(5)} ${r.orders} orders ${bdt(r.revenue)}`);
    expect(rows[0]?.paymentMethod).toBe('card');
  });

  it('Q8: how many seed orders actually received MORNING15', () => {
    const usage = couponUsage(seedOrders, 'MORNING15');
    log('Q8');
    log(`  entered: ${usage.ordersWithCode}, discount received: ${usage.ordersDiscounted} (${usage.discountedOrderIds.join(', ')})`);
    for (const o of seedOrders.filter((x) => x.couponCode)) {
      const c2 = priceCart({ lines: o.lines, couponCode: o.couponCode }, menu, promotions, o.createdAt).candidates;
      log(
        `  ${o.id} at ${o.createdAt.slice(11, 16)}: subtotal ${bdt(o.totals.subtotal)}; candidates ${c2
          .map((c) => `${c.id}=${c.eligible ? bdt(c.amount) : `no (${c.reason})`}`)
          .join(', ')} -> ${o.coupon?.status}`,
      );
    }
    for (const n of usage.notApplied) log(`  NOT applied: ${n.orderId} - ${n.reason}`);
    expect(usage.ordersDiscounted).toBe(3);
    expect(usage.notApplied.map((n) => n.orderId)).toEqual(['ORD-1006']);
  });
});
