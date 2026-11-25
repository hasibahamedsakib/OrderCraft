import { loadFixture } from '../mocks/fixture';
import { A, B, C, dhaka } from '../test/configs';
import { formatTaka, parseTaka, percentOf, roundHalfUpDiv, roundToWholeTaka } from './money';
import { priceCart, priceUnit } from './pricing';

const { menu, promotions } = loadFixture();
const unit = (selection: Record<string, number>) => priceUnit(selection, menu, promotions).unitPrice;

describe('money', () => {
  it('rounds half-up with integers only', () => {
    expect(roundHalfUpDiv(75_475_000, 10_000)).toBe(7548);
    expect(roundHalfUpDiv(75_474_999, 10_000)).toBe(7547);
    expect(percentOf(150_950, 500)).toBe(7548);
    expect(roundToWholeTaka(158_498)).toBe(158_500);
    expect(roundToWholeTaka(158_449)).toBe(158_400);
    expect(roundToWholeTaka(158_450)).toBe(158_500);
  });

  it('parses and formats BDT without floats', () => {
    expect(parseTaka('679.50')).toBe(67_950);
    expect(parseTaka('1,659.5')).toBe(165_950);
    expect(formatTaka(165_950)).toBe('1,659.50');
  });

  it('shows why floats are risky: 679.50 * 100 style math can drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(1509.5 * 0.05).not.toBe(75.475); // 75.47500000000001 in IEEE-754
  });
});

describe('priceUnit / priceCart (Part C)', () => {
  it('TC-05: unit prices of A, B and C', () => {
    expect(unit(A)).toBe(38_000);
    expect(unit(B)).toBe(67_950);
    expect(unit(C)).toBe(49_000);
  });

  it('applies P2 (cheapest extra free per 3) before P1 (10% combo on the step-2 amount)', () => {
    expect(priceUnit(C, menu, promotions)).toMatchObject({
      subtotal: 51_500,
      promotions: [{ id: 'P2', amount: 2_500 }],
      unitPrice: 49_000,
    });
    expect(priceUnit(B, menu, promotions)).toMatchObject({
      subtotal: 75_500,
      promotions: [{ id: 'P1', amount: 7_550 }],
      unitPrice: 67_950,
    });
  });

  it('TC-06: B x1 + C x2 at 10:59:59 with MORNING15 -> C2 wins, VAT 75.48, payable 1,585', () => {
    const p = priceCart(
      { lines: [{ qty: 1, options: B }, { qty: 2, options: C }], couponCode: 'MORNING15' },
      menu,
      promotions,
      dhaka('10:59:59'),
    );
    expect(p.subtotal).toBe(165_950);
    expect(p.candidates.map((c) => [c.id, c.amount])).toEqual([
      ['C1', 10_000],
      ['C2', 15_000],
    ]);
    expect(p.discount).toMatchObject({ id: 'C2', amount: 15_000 });
    expect(p.coupon?.status).toBe('applied');
    expect(p.discountedSubtotal).toBe(150_950);
    expect(p.vat).toBe(7_548);
    expect(p.payableExact).toBe(158_498);
    expect(p.payable).toBe(158_500);
  });

  it('TC-07: same cart at 11:00:00 -> coupon rejected, C1 applies, VAT 77.98, payable 1,637', () => {
    const p = priceCart(
      { lines: [{ qty: 1, options: B }, { qty: 2, options: C }], couponCode: 'MORNING15' },
      menu,
      promotions,
      dhaka('11:00:00'),
    );
    expect(p.coupon?.status).toBe('outside_hours');
    expect(p.discount).toMatchObject({ id: 'C1', amount: 10_000 });
    expect(p.vat).toBe(7_798);
    expect(p.payable).toBe(163_700);
  });

  it('caps C2 at 150 BDT and uses the coupon time zone, not the machine zone', () => {
    const p = priceCart({ lines: [{ qty: 3, options: A }], couponCode: 'morning15 ' }, menu, promotions, '2026-11-25T04:30:00Z');
    expect(p.subtotal).toBe(114_000);
    expect(p.discount).toMatchObject({ id: 'C2', amount: 15_000 }); // 171.00 capped
  });

  it('picks C1 on a tie and explains why the coupon did not apply', () => {
    // Raise C1 to 150 BDT so it ties with the capped coupon.
    const tiePromos = {
      ...promotions,
      cartDiscounts: promotions.cartDiscounts.map((d) => (d.type === 'thresholdAmountOff' ? { ...d, amountOff: 15_000 } : d)),
    };
    const p = priceCart(
      { lines: [{ qty: 1, options: B }, { qty: 2, options: C }], couponCode: 'MORNING15' },
      menu,
      tiePromos,
      dhaka('09:00:00'),
    );
    expect(p.discount?.id).toBe('C1');
    expect(p.coupon?.status).toBe('not_best');
  });

  it('reports an unknown coupon', () => {
    const p = priceCart({ lines: [{ qty: 1, options: A }], couponCode: 'FREEFOOD' }, menu, promotions, dhaka('09:00:00'));
    expect(p.coupon?.status).toBe('unknown');
    expect(p.discount).toBeNull();
  });
});

describe('time helpers', () => {
  it('formats server time in the shop zone and keeps milliseconds', async () => {
    const { toZonedIso, zonedDate } = await import('./time');
    expect(toZonedIso('2026-11-20T03:15:00Z', 'Asia/Dhaka')).toBe('2026-11-20T09:15:00+06:00');
    expect(toZonedIso(Date.parse('2026-11-20T03:15:00.250Z'), 'Asia/Dhaka')).toBe('2026-11-20T09:15:00.250+06:00');
    expect(Date.parse(toZonedIso(1_764_000_000_123, 'Asia/Dhaka'))).toBe(1_764_000_000_123);
    expect(zonedDate('2026-11-20T19:30:00Z', 'Asia/Dhaka')).toBe('2026-11-21');
  });
});
