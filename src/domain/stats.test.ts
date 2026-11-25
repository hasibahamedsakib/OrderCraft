import { loadFixture, loadSeedOrders } from '../mocks/fixture';
import { createStoredOrder, type StoredOrder } from './orders';
import {
  averageOrderValue,
  bestSellingOptions,
  couponUsage,
  orderCount,
  ordersOnDate,
  revenueByPaymentMethod,
  totalRevenue,
} from './stats';

const fixture = loadFixture();
const seedOrders: StoredOrder[] = loadSeedOrders().map((seed) =>
  createStoredOrder({ ...seed, source: 'seed' }, fixture.menu, fixture.promotions, fixture.currency),
);

describe('stats over the seed orders (Part F)', () => {
  it('prices every seed order at its own createdAt', () => {
    expect(seedOrders.map((o) => [o.id, o.totals.payable])).toEqual([
      ['ORD-1001', 33_900],
      ['ORD-1002', 71_300],
      ['ORD-1003', 127_100],
      ['ORD-1004', 57_800],
      ['ORD-1005', 86_600],
      ['ORD-1006', 122_800],
    ]);
  });

  it('counts orders and revenue', () => {
    expect(orderCount(seedOrders)).toBe(6);
    expect(totalRevenue(seedOrders)).toBe(499_500);
    expect(averageOrderValue(seedOrders)).toBe(83_250);
  });

  it('finds the best-selling option by units (line qty x option qty)', () => {
    expect(bestSellingOptions(seedOrders, fixture.menu)).toEqual([{ optionId: 'fried', name: 'Fried', units: 10 }]);
  });

  it('splits revenue by payment method', () => {
    expect(revenueByPaymentMethod(seedOrders)).toEqual([
      { paymentMethod: 'card', orders: 3, revenue: 214_500 },
      { paymentMethod: 'bkash', orders: 2, revenue: 157_900 },
      { paymentMethod: 'cash', orders: 1, revenue: 127_100 },
    ]);
  });

  it('counts orders that actually received the coupon, and explains the rest', () => {
    const usage = couponUsage(seedOrders, 'morning15');
    expect(usage.ordersWithCode).toBe(4);
    expect(usage.ordersDiscounted).toBe(3);
    expect(usage.discountedOrderIds).toEqual(['ORD-1001', 'ORD-1003', 'ORD-1005']);
    expect(usage.notApplied).toEqual([
      { orderId: 'ORD-1006', reason: 'MORNING15 is only valid before 11:00 (Asia/Dhaka).' },
    ]);
  });

  it('filters orders by shop-local date', () => {
    expect(ordersOnDate(seedOrders, '2026-11-21', fixture.timeZone)).toMatchObject({
      count: 2,
      revenue: 184_900,
      orders: [{ id: 'ORD-1003' }, { id: 'ORD-1004' }],
    });
    expect(ordersOnDate(seedOrders, '2026-11-23', fixture.timeZone).count).toBe(0);
  });

  it('reacts to changed data (the reviewers will change it)', () => {
    // ORD-1001 (Scrambled x2) now has qty 10: scrambled = 20 + 2 + 4 = 26 units
    const changed = seedOrders.map((o) => (o.id === 'ORD-1001' ? { ...o, lines: [{ ...o.lines[0]!, qty: 10 }] } : o));
    expect(bestSellingOptions(changed, fixture.menu)).toEqual([{ optionId: 'scrambled', name: 'Scrambled', units: 26 }]);
    // ties are all returned
    const tie = seedOrders.map((o) => (o.id === 'ORD-1005' ? { ...o, lines: [{ ...o.lines[0]!, qty: 5 }] } : o));
    expect(bestSellingOptions(tie, fixture.menu).map((r) => r.optionId)).toEqual(['sausage', 'scrambled']);
  });

  it('handles no orders', () => {
    expect(averageOrderValue([])).toBe(0);
    expect(bestSellingOptions([])).toEqual([]);
  });
});
