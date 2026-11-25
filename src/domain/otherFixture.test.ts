import rawMenu from '../mocks/fixture/menu.fixture.json';
import { loadFixture } from '../mocks/fixture';
import { createMockServer } from '../mocks/server';
import { memoryStorage } from '../mocks/storage';
import { estimateOffset } from '../store/slices/clockSlice';
import { formatCountdown, msUntil } from '../app/serverTime';
import { priceUnit } from './pricing';
import { formatShortages, shortagesFor } from './stock';
import { validate } from './validate';

/** A different menu: new ids, names, limits, rules and stock. No code changes allowed. */
const lunch = loadFixture({
  ...rawMenu,
  product: { id: 'bowl', name: 'Rice Bowl', basePrice: 30000, minQty: 1, maxQty: 2 },
  ingredients: [
    { id: 'rice', name: 'rice', stock: 3 },
    { id: 'chicken', name: 'chicken', stock: 2 },
    { id: 'egg', name: 'egg', stock: 1 },
  ],
  groups: [
    {
      id: 'base',
      name: 'Base',
      min: 1,
      max: 1,
      options: [{ id: 'white', name: 'White rice', price: 0, uses: { rice: 1 } }],
    },
    {
      id: 'toppings',
      name: 'Toppings',
      min: 1,
      max: 3,
      maxPerOption: 2,
      options: [
        { id: 'grilled', name: 'Grilled chicken', price: 8000, uses: { chicken: 1 } },
        { id: 'boiled', name: 'Boiled egg', price: 2000, uses: { egg: 1 } },
        { id: 'pickle', name: 'Pickle', price: 500, uses: {} },
      ],
    },
  ],
  rules: [{ id: 'X1', type: 'requires', option: 'pickle', anyOf: ['grilled'] }],
  promotions: { itemPromotions: [], cartDiscounts: [], vatBps: 750 },
});

describe('a different menu fixture works without code changes', () => {
  const { menu, promotions } = lunch;

  it('validates with the new groups and rules', () => {
    expect(validate({ white: 1, pickle: 1 }, menu.groups, menu.rules).map((v) => v.message)).toEqual([
      'Pickle requires Grilled chicken.',
    ]);
    expect(validate({ white: 1, grilled: 3 }, menu.groups, menu.rules).map((v) => v.code)).toEqual(['group_max_per_option']);
  });

  it('prices and checks stock from data only', () => {
    expect(priceUnit({ white: 1, grilled: 1, pickle: 1 }, menu, promotions).unitPrice).toBe(38_500);
    const short = shortagesFor({ selection: { white: 1, grilled: 2, boiled: 2 }, qty: 1, groups: menu.groups, available: lunch.initialStock });
    expect(formatShortages(short, menu.ingredients)).toBe('Short: 1 egg');
  });

  it('runs the mock server end to end', () => {
    const server = createMockServer({ storage: memoryStorage(), fixture: lunch, seedOrders: [], now: () => 0 });
    const added = server.addItem({ idempotencyKey: 'lunch-key-0001', selection: { white: 1, grilled: 1 }, qty: 2 });
    expect(added.status).toBe(201);
    const cart = server.getCart().body as { stock: Record<string, { available: number }>; pricing: { vat: number; payable: number } };
    expect(cart.stock.chicken?.available).toBe(0);
    expect(cart.pricing.vat).toBe(5_700); // (300 + 80) x 2 = 760.00; 7.5% = 57.00
    expect(cart.pricing.payable).toBe(81_700);
  });
});

describe('server-clock countdown (TC-15)', () => {
  it('uses the measured offset, not the browser clock', () => {
    const browserNow = Date.parse('2026-11-25T09:00:00+06:00');
    // server says 09:01:30 when the browser says 09:00:00 (round trip 100 ms)
    const offset = estimateOffset('2026-11-25T09:01:30.050+06:00', browserNow, browserNow + 100);
    expect(offset).toBe(90_000);
    const expiresAt = '2026-11-25T09:06:30+06:00'; // reserved at server 09:01:30 + 5 min
    expect(formatCountdown(msUntil(expiresAt, offset, browserNow))).toBe('5:00');
    // a countdown on the browser clock alone would wrongly show 6:30
    expect(formatCountdown(msUntil(expiresAt, 0, browserNow))).toBe('6:30');
    expect(msUntil(expiresAt, offset, browserNow + 5 * 60_000)).toBe(0);
  });
});
