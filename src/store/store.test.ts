import { delay, http, HttpResponse } from 'msw';
import type { CartSnapshot, PriceRequest } from '../api/contracts';
import { A, B, dhaka } from '../test/configs';
import { createTestServer } from '../test/testServer';
import { makeStore } from './index';
import { selectEditingContext } from './selectors/builderSelectors';
import { builderReset, editStarted, optionQtySet, singleOptionPicked } from './slices/builderSlice';
import { checkout, fetchCart, fetchMenu, fetchPricePreview, isNewerSnapshot, previewKey, submitBuilder } from './thunks';

const server = createTestServer();
beforeAll(() => server.msw.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  server.clock.now = Date.parse(dhaka('09:00:00'));
  server.mock.reset();
});
afterEach(() => server.msw.resetHandlers());
afterAll(() => server.msw.close());

async function readyStore() {
  const store = makeStore({ storage: null });
  await store.dispatch(fetchMenu());
  await store.dispatch(fetchCart());
  return store;
}

function pick(store: ReturnType<typeof makeStore>, selection: Record<string, number>) {
  store.dispatch(builderReset());
  for (const [optionId, qty] of Object.entries(selection)) store.dispatch(optionQtySet({ optionId, qty }));
}

describe('price preview (TC-12)', () => {
  it('ignores an older response that arrives after a newer one', async () => {
    // Paratha requests are slow, everything else fast: responses come back out of order.
    server.msw.use(
      http.post('*/api/price', async ({ request }) => {
        const body = (await request.json()) as PriceRequest;
        const slow = (body.lines[0]?.options.paratha ?? 0) > 0;
        await delay(slow ? 150 : 10);
        const result = server.mock.price(body);
        return HttpResponse.json(result.body as object, { status: result.status });
      }),
    );
    const store = await readyStore();

    pick(store, { paratha: 1, scrambled: 2, sausage: 1 });
    const older = store.dispatch(fetchPricePreview());
    pick(store, A);
    const newer = store.dispatch(fetchPricePreview());
    await Promise.all([older, newer]);

    const { preview } = store.getState().builder;
    expect(preview.key).toBe(previewKey(A, 1));
    expect(preview.pricing?.lines[0]?.unit.unitPrice).toBe(38_000);
  });

  it('debounces changes and aborts superseded requests', async () => {
    let requests = 0;
    server.msw.use(
      http.post('*/api/price', async ({ request }) => {
        requests += 1;
        const body = (await request.json()) as PriceRequest;
        await delay(50);
        const result = server.mock.price(body);
        return HttpResponse.json(result.body as object, { status: result.status });
      }),
    );
    const store = await readyStore();
    await new Promise((r) => setTimeout(r, 400)); // let the menu-load preview finish
    requests = 0;

    store.dispatch(singleOptionPicked({ optionId: 'toast', groupOptionIds: ['toast', 'paratha', 'croissant'] }));
    store.dispatch(optionQtySet({ optionId: 'scrambled', qty: 1 }));
    store.dispatch(optionQtySet({ optionId: 'scrambled', qty: 2 }));
    store.dispatch(optionQtySet({ optionId: 'sausage', qty: 1 }));
    store.dispatch(optionQtySet({ optionId: 'ketchup', qty: 1 }));
    await new Promise((r) => setTimeout(r, 500));

    expect(requests).toBe(1);
    expect(store.getState().builder.preview).toMatchObject({ status: 'succeeded', key: previewKey(A, 1) });
  });

  it('keeps the configuration and allows retry when pricing fails', async () => {
    let fail = true;
    server.msw.use(
      http.post('*/api/price', async ({ request }) => {
        if (fail) return HttpResponse.json({ code: 'PRICING_UNAVAILABLE', message: 'Pricing is temporarily unavailable.' }, { status: 503 });
        const result = server.mock.price((await request.json()) as PriceRequest);
        return HttpResponse.json(result.body as object, { status: result.status });
      }),
    );
    const store = await readyStore();
    pick(store, A);
    await store.dispatch(fetchPricePreview());
    expect(store.getState().builder.preview.status).toBe('failed');
    expect(store.getState().builder.selection).toEqual(A);

    fail = false;
    await store.dispatch(fetchPricePreview());
    expect(store.getState().builder.preview.status).toBe('succeeded');
  });
});

describe('cart flows through the store', () => {
  it('TC-13: three quick Add to cart dispatches create exactly one item', async () => {
    const store = await readyStore();
    pick(store, A);
    await Promise.all([store.dispatch(submitBuilder()), store.dispatch(submitBuilder()), store.dispatch(submitBuilder())]);
    const cart = store.getState().cart;
    expect(cart.items).toHaveLength(1);
    expect(store.getState().inventory.stock.egg?.reserved).toBe(2);
    expect(store.getState().builder.selection).toEqual({});
  });

  it('TC-14: a failed reserve keeps the configuration and retry works', async () => {
    const store = await readyStore();
    server.mock.setDev({ failNextReserve: true });
    pick(store, B);
    await store.dispatch(submitBuilder());
    expect(store.getState().builder.submit.error?.code).toBe('RESERVATION_FAILED');
    expect(store.getState().builder.selection).toEqual(B);
    await store.dispatch(fetchCart());
    expect(store.getState().inventory.stock.egg?.reserved).toBe(0);

    await store.dispatch(submitBuilder());
    expect(store.getState().cart.items).toHaveLength(1);
  });

  it('TC-16: Pay clicked twice -> one order, cart empty', async () => {
    const store = await readyStore();
    pick(store, A);
    await store.dispatch(submitBuilder());
    await Promise.all([store.dispatch(checkout({ paymentMethod: 'cash' })), store.dispatch(checkout({ paymentMethod: 'cash' }))]);
    expect(store.getState().cart.items).toHaveLength(0);
    expect(store.getState().orders.items.filter((o) => o.source === 'checkout')).toHaveLength(1);
    const { orders } = server.mock.getOrders().body as { orders: unknown[] };
    expect(orders).toHaveLength(7);
    expect(store.getState().inventory.stock.egg).toEqual({ onHand: 8, reserved: 0, available: 8 });
  });

  it('D3: when the edited item expires, the draft is kept and saving re-adds it as a new item', async () => {
    const store = await readyStore();
    pick(store, A);
    await store.dispatch(submitBuilder());
    const item = store.getState().cart.items[0]!;
    store.dispatch(editStarted(item));
    store.dispatch(optionQtySet({ optionId: 'ketchup', qty: 0 }));

    server.clock.now += 5 * 60_000 + 1;
    await store.dispatch(fetchCart());
    expect(selectEditingContext(store.getState()).mode).toBe('edit-expired');
    expect(store.getState().builder.selection).toEqual({ toast: 1, scrambled: 2, sausage: 1 });

    await store.dispatch(submitBuilder());
    const items = store.getState().cart.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'active', selection: { toast: 1, scrambled: 2, sausage: 1 } });
    expect(items[0]!.id).not.toBe(item.id);
  });

  it('computes the server clock offset (server runs 90 s ahead)', async () => {
    const realNow = Date.now();
    const store = await readyStore();
    // the test server clock is pinned at 09:00 Dhaka + 90 s; offset = that - real browser time
    const expected = Date.parse(dhaka('09:01:30')) - realNow;
    expect(Math.abs(store.getState().clock.offsetMs - expected)).toBeLessThan(1000);
  });
});

describe('isNewerSnapshot', () => {
  const snap = (version: number, serverTime: string, epoch = 'e1') =>
    ({ serverTime, cart: { epoch, version, couponCode: null, items: [] } }) as unknown as CartSnapshot;

  it('drops older snapshots and accepts resets', () => {
    const current = { epoch: 'e1', version: 5, serverTime: '2026-11-25T09:00:10+06:00' };
    expect(isNewerSnapshot(current, snap(4, '2026-11-25T09:00:20+06:00'))).toBe(false);
    expect(isNewerSnapshot(current, snap(5, '2026-11-25T09:00:05+06:00'))).toBe(false);
    expect(isNewerSnapshot(current, snap(5, '2026-11-25T09:00:15+06:00'))).toBe(true);
    expect(isNewerSnapshot(current, snap(6, '2026-11-25T09:00:00+06:00'))).toBe(true);
    expect(isNewerSnapshot(current, snap(0, '2026-11-25T09:00:00+06:00', 'e2'))).toBe(true);
  });
});
