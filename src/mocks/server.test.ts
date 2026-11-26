import type { AddItemResponse, ApiErrorBody } from '../api/contracts';
import { A, B, C, dhaka } from '../test/configs';
import { createMockServer, SERVER_CLOCK_SKEW_MS, type HttpResult } from './server';
import { memoryStorage, type KeyValueStorage } from './storage';

/** Browser clock under test control. The server adds +90 s on top. */
function setup(opts: { storage?: KeyValueStorage; browserTime?: string; random?: () => number } = {}) {
  const storage = opts.storage ?? memoryStorage();
  let browserNow = Date.parse(opts.browserTime ?? dhaka('09:00:00'));
  const server = createMockServer({ storage, now: () => browserNow, random: opts.random ?? (() => 0.5) });
  return {
    server,
    storage,
    advance: (ms: number) => void (browserNow += ms),
    browserNow: () => browserNow,
  };
}

function body<T>(result: HttpResult<T>): T {
  if (result.status >= 400) throw new Error(`Expected success, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body as T;
}

function error(result: HttpResult<unknown>): ApiErrorBody {
  if (result.status < 400) throw new Error(`Expected an error, got ${result.status}`);
  return result.body as ApiErrorBody;
}

let keyCounter = 0;
const key = () => `test-key-${++keyCounter}-xxxxxxxx`;

function add(server: ReturnType<typeof setup>['server'], selection: Record<string, number>, qty = 1, idempotencyKey = key()) {
  return server.addItem({ idempotencyKey, selection, qty });
}

describe('mock server: reservations (Part D)', () => {
  it('TC-08 end-to-end: B x1 + C x2 leaves egg 0, cheese 0, croissant 1', () => {
    const { server } = setup();
    body(add(server, B, 1));
    const snap = body(add(server, C, 2)).snapshot;
    expect(snap.stock.egg?.available).toBe(0);
    expect(snap.stock.cheese?.available).toBe(0);
    expect(snap.stock.croissant?.available).toBe(1);

    const blocked = error(add(server, { toast: 1, fried: 2, sausage: 1 }));
    expect(blocked.code).toBe('INSUFFICIENT_STOCK');
    expect(blocked.shortages).toEqual([{ ingredientId: 'egg', missing: 2 }]);
  });

  it('TC-13: the same idempotency key three times creates exactly one item and one reservation', () => {
    const { server } = setup();
    const k = key();
    const results = [add(server, A, 1, k), add(server, A, 1, k), add(server, A, 1, k)].map(body<AddItemResponse>);
    expect(results.map((r) => r.replayed)).toEqual([false, true, true]);
    const cart = body(server.getCart());
    expect(cart.cart.items).toHaveLength(1);
    expect(cart.stock.egg?.reserved).toBe(2);
  });

  it('TC-14: a reservation that fails mid-way holds no stock, and a retry with the same key works', () => {
    const { server } = setup();
    body(server.setDev({ failNextReserve: true }));
    const k = key();
    const failed = error(add(server, B, 1, k));
    expect(failed.code).toBe('RESERVATION_FAILED');

    const afterFailure = body(server.getCart());
    expect(afterFailure.cart.items).toHaveLength(0);
    expect(Object.values(afterFailure.stock).every((s) => s.reserved === 0)).toBe(true);

    const retried = body(add(server, B, 1, k));
    expect(retried.replayed).toBe(false);
    expect(retried.snapshot.stock.egg?.reserved).toBe(6);
  });

  it('TC-14: random mid-way failures never leave phantom reservations', () => {
    const storage = memoryStorage();
    const server = createMockServer({ storage, now: () => Date.parse(dhaka('09:00:00')), random: () => 0, reserveFailureRate: 1 });
    expect(error(server.addItem({ idempotencyKey: key(), selection: C, qty: 2 })).code).toBe('RESERVATION_FAILED');
    expect(body(server.getCart()).stock.cheese?.available).toBe(4);
  });

  it('TC-15: reservations expire after 5:00 of SERVER time, release stock and become read-only', () => {
    const { server, advance, browserNow } = setup();
    const { snapshot } = body(add(server, B, 1));
    const item = snapshot.cart.items[0]!;

    // Server time is 90 s ahead of the browser; expiry is 5 min after the server's reservedAt.
    expect(Date.parse(snapshot.serverTime)).toBe(browserNow() + SERVER_CLOCK_SKEW_MS);
    expect(Date.parse(item.expiresAt) - Date.parse(item.reservedAt)).toBe(5 * 60_000);

    advance(5 * 60_000 - 1);
    expect(body(server.getCart()).cart.items[0]!.status).toBe('active');

    advance(1);
    const expired = body(server.getCart());
    expect(expired.cart.items[0]).toMatchObject({ status: 'expired', allocation: {} });
    expect(expired.stock.egg?.available).toBe(10);
    expect(expired.pricing.lines).toHaveLength(0);

    const edit = error(server.updateItem(item.id, { selection: B, qty: 1, baseVersion: expired.cart.version }));
    expect(edit.code).toBe('RESERVATION_EXPIRED');
    expect(body(server.removeItem(item.id, expired.cart.version)).cart.items).toHaveLength(0);
  });

  it('TC-09/TC-10: edits swap the allocation using the net difference', () => {
    const { server } = setup();
    const b = body(add(server, B, 1));
    const snap = body(add(server, C, 2)).snapshot;
    const bId = b.itemId;

    const tooMany = error(server.updateItem(bId, { selection: { ...B, omelette: 3, fried: 1 }, qty: 1, baseVersion: snap.cart.version }));
    expect(tooMany.shortages).toEqual([{ ingredientId: 'egg', missing: 1 }]);

    const edited = body(server.updateItem(bId, { selection: { ...B, omelette: 1, fried: 3 }, qty: 1, baseVersion: snap.cart.version }));
    expect(edited.cart.items.find((i) => i.id === bId)?.unitPrice).toBe(64_350);
    expect(edited.stock.egg?.available).toBe(1);
  });

  it('TC-11: changing C from 2 to 3 is blocked with every shortage', () => {
    const { server } = setup();
    body(add(server, B, 1));
    const c = body(add(server, C, 2));
    const res = error(server.updateItem(c.itemId, { selection: C, qty: 3, baseVersion: c.snapshot.cart.version }));
    expect(res.shortages).toEqual([
      { ingredientId: 'egg', missing: 2 },
      { ingredientId: 'cheese', missing: 2 },
    ]);
  });

  it('rejects invalid configurations on the server too', () => {
    const { server } = setup();
    const res = error(add(server, { toast: 1, scrambled: 3, sausage: 1 }));
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(res.violations?.[0]?.code).toBe('group_step');
  });
});

describe('mock server: two tabs (D1 and Part G)', () => {
  it('D1: tab B takes the last eggs while tab A edits; tab A gets the shortage and keeps its data', () => {
    const storage = memoryStorage();
    const tabA = setup({ storage });
    const tabB = setup({ storage });
    const a = body(add(tabA.server, { toast: 1, fried: 2, sausage: 1 }));
    // tab B reserves 8 eggs (two items), leaving 0
    body(add(tabB.server, { toast: 1, omelette: 2, sausage: 1 }, 1));
    const last = body(add(tabB.server, { toast: 1, omelette: 2, tofu: 1 }, 1)).snapshot;
    expect(last.stock.egg?.available).toBe(0);

    // tab A saved its cart version before tab B changed it -> conflict, then retry on latest version
    const stale = error(tabA.server.updateItem(a.itemId, { selection: { toast: 1, fried: 4, sausage: 1 }, qty: 1, baseVersion: a.snapshot.cart.version }));
    expect(stale.code).toBe('VERSION_CONFLICT');
    const res = error(tabA.server.updateItem(a.itemId, { selection: { toast: 1, fried: 4, sausage: 1 }, qty: 1, baseVersion: stale.snapshot!.cart.version }));
    expect(res.code).toBe('INSUFFICIENT_STOCK');
    expect(res.shortages).toEqual([{ ingredientId: 'egg', missing: 2 }]);
    // nothing changed for A's item on the server
    expect(res.snapshot?.cart.items.find((i) => i.id === a.itemId)?.selection).toEqual({ toast: 1, fried: 2, sausage: 1 });
  });
});

describe('mock server: checkout and orders (Part E)', () => {
  it('seeds six orders priced at their own createdAt', () => {
    const { server } = setup();
    const { orders } = body(server.getOrders());
    expect(orders.map((o) => o.id)).toEqual(['ORD-1001', 'ORD-1002', 'ORD-1003', 'ORD-1004', 'ORD-1005', 'ORD-1006']);
    expect(orders.every((o) => o.source === 'seed' && o.totals.payable % 100 === 0)).toBe(true);
    expect(orders.find((o) => o.id === 'ORD-1006')?.coupon?.status).toBe('outside_hours');
  });

  it('TC-16: Pay twice with the same key -> one order, empty cart, sold stock not released again', () => {
    const { server } = setup();
    const { snapshot } = body(add(server, B, 1));
    const k = key();
    const req = { idempotencyKey: k, paymentMethod: 'card', baseVersion: snapshot.cart.version, expectedPayable: snapshot.pricing.payable };
    const first = body(server.checkout(req));
    const second = body(server.checkout(req));
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const after = body(server.getCart());
    expect(after.cart.items).toHaveLength(0);
    expect(after.stock.egg).toEqual({ onHand: 4, reserved: 0, available: 4 });
    expect(body(server.getOrders()).orders).toHaveLength(7);
  });

  it('TC-17: orders survive a "refresh" (new server instance over the same storage)', () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    const { snapshot } = body(add(first.server, A, 1));
    body(first.server.checkout({ idempotencyKey: key(), paymentMethod: 'bkash', baseVersion: snapshot.cart.version }));

    const reloaded = setup({ storage });
    const { orders } = body(reloaded.server.getOrders());
    expect(orders).toHaveLength(7);
    expect(orders[6]).toMatchObject({ id: 'ORD-1007', source: 'checkout', paymentMethod: 'bkash', moneyUnit: 'poisha' });
    expect(JSON.parse(JSON.stringify(orders))).toEqual(orders);
  });

  it('D2: the price is locked at checkout; a coupon that expires at 11:00 is refused with PRICE_CHANGED', () => {
    const { server, advance } = setup({ browserTime: dhaka('10:58:00') }); // server 10:59:30
    body(add(server, B, 1));
    const snap = body(add(server, C, 2)).snapshot;
    const withCoupon = body(server.setCoupon({ code: 'MORNING15' }));
    expect(withCoupon.pricing.payable).toBe(158_500);

    advance(60_000); // server 11:00:30
    const res = error(server.checkout({ idempotencyKey: key(), paymentMethod: 'card', baseVersion: withCoupon.cart.version, expectedPayable: 158_500 }));
    expect(res.code).toBe('PRICE_CHANGED');
    expect(res.snapshot?.pricing.payable).toBe(163_700);
    expect(res.snapshot?.pricing.coupon?.status).toBe('outside_hours');

    const paid = body(server.checkout({ idempotencyKey: key(), paymentMethod: 'card', baseVersion: withCoupon.cart.version, expectedPayable: 163_700 }));
    expect(paid.order.totals.payable).toBe(163_700);
    expect(paid.order.couponCode).toBe('MORNING15');
    expect(paid.order.coupon?.status).toBe('outside_hours');
    expect(snap.cart.items).toHaveLength(2);
  });

  it('refuses checkout of an empty cart and a stale cart version', () => {
    const { server } = setup();
    expect(error(server.checkout({ idempotencyKey: key(), paymentMethod: 'cash', baseVersion: 0 })).code).toBe('EMPTY_CART');
    const { snapshot } = body(add(server, A));
    expect(error(server.checkout({ idempotencyKey: key(), paymentMethod: 'cash', baseVersion: snapshot.cart.version - 1 })).code).toBe(
      'VERSION_CONFLICT',
    );
  });

  it('Part G: a stale tab cannot silently overwrite the coupon', () => {
    const { server } = setup();
    const { snapshot } = body(add(server, A));
    const stale = error(server.setCoupon({ code: 'MORNING15', baseVersion: snapshot.cart.version - 1 }));
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(body(server.getCart()).cart.couponCode).toBeNull();
    expect(body(server.setCoupon({ code: 'MORNING15', baseVersion: snapshot.cart.version })).cart.couponCode).toBe('MORNING15');
  });
});

describe('mock server: price endpoint', () => {
  it('prices with the server clock and can fail', () => {
    const storage = memoryStorage();
    const now = () => Date.parse(dhaka('10:58:29')); // server 10:59:59
    const server = createMockServer({ storage, now, random: () => 0.99, priceFailureRate: 0.15 });
    const res = body(server.price({ lines: [{ qty: 1, options: B }, { qty: 2, options: C }], couponCode: 'MORNING15' }));
    expect(res.pricing.payable).toBe(158_500);

    const flaky = createMockServer({ storage, now, random: () => 0.01, priceFailureRate: 0.15 });
    expect(error(flaky.price({ lines: [{ qty: 1, options: A }] })).code).toBe('PRICING_UNAVAILABLE');
  });
});

