import type {
  AddItemRequest,
  AddItemResponse,
  ApiErrorBody,
  CartItemDTO,
  CartSnapshot,
  CheckoutRequest,
  CheckoutResponse,
  DevSettings,
  ErrorCode,
  IngredientStockDTO,
  MenuResponse,
  OrdersResponse,
  PriceRequest,
  PriceResponse,
  SetCouponRequest,
  UpdateItemRequest,
} from '../api/contracts';
import { normalizeSelection } from '../domain/menu';
import { createStoredOrder, type StoredOrder } from '../domain/orders';
import { priceCart, priceUnit } from '../domain/pricing';
import { addAmounts, shortagesFor, usageForItem } from '../domain/stock';
import { toZonedIso } from '../domain/time';
import type { IngredientAmounts, Selection } from '../domain/types';
import { validate } from '../domain/validate';
import { loadFixture, loadSeedOrders, type Fixture, type SeedOrder } from './fixture';
import { SERVER_STORAGE_KEY, type KeyValueStorage } from './storage';

/*
 * In-browser mock server.
 *
 * Atomicity: every request parses a fresh copy of the state from storage, works on that copy,
 * and writes it back only if the request succeeds. A request that fails half-way simply never
 * saves, so it cannot leave a partial ("phantom") reservation behind.
 *
 * Clock: the server clock is the browser clock + 90 s (+ an optional dev offset). Every time
 * the server returns is from that clock; clients must not use Date.now() for expiry.
 */

export const SERVER_CLOCK_SKEW_MS = 90_000;

interface StoredCartItem {
  id: string;
  selection: Selection;
  qty: number;
  allocation: IngredientAmounts;
  reservedAtMs: number;
  expiresAtMs: number;
  status: 'active' | 'expired';
}

interface ServerState {
  schema: 1;
  epoch: string;
  fixtureHash: string;
  version: number;
  nextOrderNumber: number;
  nextItemNumber: number;
  couponCode: string | null;
  onHand: IngredientAmounts;
  items: StoredCartItem[];
  orders: StoredOrder[];
  idempotency: Record<string, { kind: 'add' | 'checkout'; ref: string; atMs: number }>;
  dev: DevSettings;
}

export interface MockServerOptions {
  storage: KeyValueStorage;
  fixture?: Fixture;
  seedOrders?: SeedOrder[];
  /** Browser clock. */
  now?: () => number;
  random?: () => number;
  priceFailureRate?: number;
  reserveFailureRate?: number;
  storageKey?: string;
}

export interface HttpResult<T> {
  status: number;
  body: T | ApiErrorBody;
}

const ok = <T>(body: T, status = 200): HttpResult<T> => ({ status, body });

function fail(status: number, code: ErrorCode, message: string, extra: Partial<ApiErrorBody> = {}): HttpResult<never> {
  return { status, body: { code, message, ...extra } };
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function randomId(random: () => number): string {
  return Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0');
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isSelection(value: unknown): value is Selection {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((qty) => typeof qty === 'number')
  );
}

export function createMockServer(options: MockServerOptions) {
  const fixture = options.fixture ?? loadFixture();
  const seedOrders = options.seedOrders ?? loadSeedOrders();
  const browserNow = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const priceFailureRate = options.priceFailureRate ?? 0;
  const reserveFailureRate = options.reserveFailureRate ?? 0;
  const storageKey = options.storageKey ?? SERVER_STORAGE_KEY;
  const { menu, promotions } = fixture;
  const fixtureHash = hashString(JSON.stringify({ menu, promotions, stock: fixture.initialStock }));

  /* ---------- state ---------- */

  function initialState(previousOrders?: StoredOrder[]): ServerState {
    const orders =
      previousOrders ??
      seedOrders.map((seed) =>
        createStoredOrder(
          { ...seed, source: 'seed', lines: seed.lines.map((l) => ({ qty: l.qty, options: l.options })) },
          menu,
          promotions,
          fixture.currency,
        ),
      );
    const highest = Math.max(1000, ...orders.map((o) => Number(/(\d+)$/.exec(o.id)?.[1] ?? 0)));
    return {
      schema: 1,
      epoch: randomId(random),
      fixtureHash,
      version: 0,
      nextOrderNumber: highest + 1,
      nextItemNumber: 1,
      couponCode: null,
      onHand: { ...fixture.initialStock },
      items: [],
      orders,
      idempotency: {},
      dev: { clockOffsetMs: 0, failNextReserve: false },
    };
  }

  function save(state: ServerState): void {
    options.storage.setItem(storageKey, JSON.stringify(state));
  }

  /** Fresh copy from storage. First start seeds orders; a changed fixture resets stock but keeps orders. */
  function load(): ServerState {
    const raw = options.storage.getItem(storageKey);
    let state: ServerState | null = null;
    if (raw) {
      try {
        state = JSON.parse(raw) as ServerState;
      } catch {
        state = null;
      }
    }
    if (!state || state.schema !== 1) {
      state = initialState();
      save(state);
    } else if (state.fixtureHash !== fixtureHash) {
      state = { ...initialState(state.orders), dev: state.dev };
      save(state);
    }
    return state;
  }

  function serverNow(state: ServerState): number {
    return browserNow() + SERVER_CLOCK_SKEW_MS + state.dev.clockOffsetMs;
  }

  /** Expire reservations whose 5 minutes passed: release their stock, keep the item read-only. */
  function sweep(state: ServerState, now: number): void {
    for (const item of state.items) {
      if (item.status === 'active' && now >= item.expiresAtMs) {
        item.status = 'expired';
        item.allocation = {};
      }
    }
    for (const [key, entry] of Object.entries(state.idempotency)) {
      if (now - entry.atMs > IDEMPOTENCY_TTL_MS) delete state.idempotency[key];
    }
  }

  /** Load + sweep. Every handler starts here. */
  function begin(): { state: ServerState; now: number } {
    const state = load();
    const now = serverNow(state);
    sweep(state, now);
    return { state, now };
  }

  function reservedTotals(state: ServerState): IngredientAmounts {
    return state.items
      .filter((item) => item.status === 'active')
      .reduce<IngredientAmounts>((sum, item) => addAmounts(sum, item.allocation), {});
  }

  function available(state: ServerState): IngredientAmounts {
    const reserved = reservedTotals(state);
    const out: IngredientAmounts = {};
    for (const [id, onHand] of Object.entries(state.onHand)) out[id] = onHand - (reserved[id] ?? 0);
    return out;
  }

  function iso(ms: number): string {
    return toZonedIso(ms, fixture.timeZone);
  }

  function snapshot(state: ServerState, now: number): CartSnapshot {
    const reserved = reservedTotals(state);
    const stock: Record<string, IngredientStockDTO> = {};
    for (const [id, onHand] of Object.entries(state.onHand)) {
      const r = reserved[id] ?? 0;
      stock[id] = { onHand, reserved: r, available: onHand - r };
    }
    const items: CartItemDTO[] = state.items.map((item) => {
      const unitPrice = priceUnit(item.selection, menu, promotions).unitPrice;
      return {
        id: item.id,
        selection: item.selection,
        qty: item.qty,
        allocation: item.allocation,
        reservedAt: iso(item.reservedAtMs),
        expiresAt: iso(item.expiresAtMs),
        status: item.status,
        unitPrice,
        lineTotal: unitPrice * item.qty,
      };
    });
    const active = state.items.filter((item) => item.status === 'active');
    return {
      serverTime: iso(now),
      cart: { epoch: state.epoch, version: state.version, couponCode: state.couponCode, items },
      stock,
      pricing: priceCart(
        { lines: active.map((item) => ({ qty: item.qty, options: item.selection })), couponCode: state.couponCode },
        menu,
        promotions,
        now,
      ),
    };
  }

  function checkItemInput(selection: unknown, qty: unknown): HttpResult<never> | null {
    if (!isSelection(selection)) return fail(400, 'BAD_REQUEST', 'selection must be an object of option quantities.');
    if (!isPositiveInt(qty) || qty < menu.product.minQty || qty > menu.product.maxQty) {
      return fail(422, 'VALIDATION_FAILED', `Quantity must be ${menu.product.minQty}-${menu.product.maxQty}.`);
    }
    const violations = validate(selection, menu.groups, menu.rules);
    if (violations.length > 0) {
      return fail(422, 'VALIDATION_FAILED', 'The configuration breaks the menu rules.', { violations });
    }
    return null;
  }

  function conflict(state: ServerState, now: number): HttpResult<never> {
    return fail(409, 'VERSION_CONFLICT', 'The cart changed in another tab. Reload to see the latest cart.', {
      snapshot: snapshot(state, now),
    });
  }

  /* ---------- endpoints ---------- */

  function getMenu(): HttpResult<MenuResponse> {
    const { now } = begin();
    return ok({
      serverTime: iso(now),
      currency: fixture.currency,
      timeZone: fixture.timeZone,
      menu,
      promotions,
      paymentMethods: fixture.paymentMethods,
      reservationTtlMs: fixture.reservationTtlMs,
    });
  }

  function getCart(): HttpResult<CartSnapshot> {
    const { state, now } = begin();
    return ok(snapshot(state, now));
  }

  function addItem(body: Partial<AddItemRequest>): HttpResult<AddItemResponse> {
    const { state, now } = begin();
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8) {
      return fail(400, 'BAD_REQUEST', 'idempotencyKey is required.');
    }
    const previous = state.idempotency[body.idempotencyKey];
    if (previous?.kind === 'add') {
      return ok({ itemId: previous.ref, replayed: true, snapshot: snapshot(state, now) });
    }
    const invalid = checkItemInput(body.selection, body.qty);
    if (invalid) return invalid;
    const selection = normalizeSelection(body.selection as Selection);
    const qty = body.qty as number;

    const shortages = shortagesFor({ selection, qty, groups: menu.groups, available: available(state) });
    if (shortages.length > 0) {
      return fail(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this item.', { shortages, snapshot: snapshot(state, now) });
    }

    // Reserve ingredient by ingredient on the working copy. If anything fails before save(),
    // the copy is thrown away, so no stock stays held.
    const item: StoredCartItem = {
      id: `item-${state.nextItemNumber}`,
      selection,
      qty,
      allocation: {},
      reservedAtMs: now,
      expiresAtMs: now + fixture.reservationTtlMs,
      status: 'active',
    };
    state.items.push(item);
    const needed = Object.entries(usageForItem(selection, qty, menu.groups));
    const failAt = state.dev.failNextReserve || random() < reserveFailureRate ? Math.floor(needed.length / 2) : -1;
    for (const [index, [ingredientId, amount]] of needed.entries()) {
      if (index === failAt) {
        if (state.dev.failNextReserve) {
          // the one-shot switch itself must be consumed, without keeping anything else
          const fresh = load();
          fresh.dev.failNextReserve = false;
          save(fresh);
        }
        return fail(503, 'RESERVATION_FAILED', 'The kitchen could not reserve stock. Nothing was held, please retry.');
      }
      item.allocation[ingredientId] = amount;
    }

    state.nextItemNumber += 1;
    state.version += 1;
    state.idempotency[body.idempotencyKey] = { kind: 'add', ref: item.id, atMs: now };
    save(state);
    return ok({ itemId: item.id, replayed: false, snapshot: snapshot(state, now) }, 201);
  }

  /** Edit = one atomic swap of the item's old allocation for the new one (net difference). */
  function updateItem(itemId: string, body: Partial<UpdateItemRequest>): HttpResult<CartSnapshot> {
    const { state, now } = begin();
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return fail(404, 'NOT_FOUND', 'This item is no longer in the cart.', { snapshot: snapshot(state, now) });
    if (body.baseVersion !== state.version) return conflict(state, now);
    if (item.status === 'expired') {
      return fail(409, 'RESERVATION_EXPIRED', 'The reservation for this item expired and its stock was released.', {
        snapshot: snapshot(state, now),
      });
    }
    const invalid = checkItemInput(body.selection, body.qty);
    if (invalid) return invalid;
    const selection = normalizeSelection(body.selection as Selection);
    const qty = body.qty as number;

    const shortages = shortagesFor({
      selection,
      qty,
      groups: menu.groups,
      available: available(state),
      ownAllocation: item.allocation,
    });
    if (shortages.length > 0) {
      return fail(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this change.', { shortages, snapshot: snapshot(state, now) });
    }

    item.selection = selection;
    item.qty = qty;
    item.allocation = usageForItem(selection, qty, menu.groups);
    item.reservedAtMs = now;
    item.expiresAtMs = now + fixture.reservationTtlMs;
    state.version += 1;
    save(state);
    return ok(snapshot(state, now));
  }

  function removeItem(itemId: string, baseVersion: number | null): HttpResult<CartSnapshot> {
    const { state, now } = begin();
    const index = state.items.findIndex((i) => i.id === itemId);
    if (index === -1) return fail(404, 'NOT_FOUND', 'This item is no longer in the cart.', { snapshot: snapshot(state, now) });
    if (baseVersion !== state.version) return conflict(state, now);
    state.items.splice(index, 1); // its allocation (if still active) stops counting as reserved
    state.version += 1;
    save(state);
    return ok(snapshot(state, now));
  }

  function setCoupon(body: Partial<SetCouponRequest>): HttpResult<CartSnapshot> {
    const { state, now } = begin();
    const code = typeof body.code === 'string' && body.code.trim() !== '' ? body.code.trim() : null;
    if (code !== state.couponCode) {
      state.couponCode = code;
      state.version += 1;
      save(state);
    }
    return ok(snapshot(state, now));
  }

  /** Pay: all active items become one order, reserved stock becomes sold, the cart empties. */
  function checkout(body: Partial<CheckoutRequest>): HttpResult<CheckoutResponse> {
    const { state, now } = begin();
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8) {
      return fail(400, 'BAD_REQUEST', 'idempotencyKey is required.');
    }
    const previous = state.idempotency[body.idempotencyKey];
    if (previous?.kind === 'checkout') {
      const order = state.orders.find((o) => o.id === previous.ref);
      if (order) return ok({ order, replayed: true, snapshot: snapshot(state, now) });
    }
    if (!fixture.paymentMethods.some((m) => m.id === body.paymentMethod)) {
      return fail(422, 'VALIDATION_FAILED', 'Choose a payment method.');
    }
    if (body.baseVersion !== state.version) return conflict(state, now);

    const active = state.items.filter((item) => item.status === 'active');
    if (active.length === 0) {
      return fail(409, 'EMPTY_CART', 'There are no active items to pay for.', { snapshot: snapshot(state, now) });
    }

    const order = createStoredOrder(
      {
        id: `ORD-${state.nextOrderNumber}`,
        createdAt: iso(now),
        source: 'checkout',
        paymentMethod: body.paymentMethod as string,
        couponCode: state.couponCode,
        lines: active.map((item) => ({ qty: item.qty, options: item.selection })),
      },
      menu,
      promotions,
      fixture.currency,
    );
    if (body.expectedPayable !== undefined && body.expectedPayable !== order.totals.payable) {
      return fail(409, 'PRICE_CHANGED', 'The price changed since you last saw it. Please review the new total.', {
        snapshot: snapshot(state, now),
      });
    }

    for (const item of active) {
      for (const [id, amount] of Object.entries(item.allocation)) {
        if (id in state.onHand) state.onHand[id] = (state.onHand[id] ?? 0) - amount; // reserved -> sold
      }
    }
    state.items = [];
    state.couponCode = null;
    state.orders.push(order);
    state.nextOrderNumber += 1;
    state.version += 1;
    state.idempotency[body.idempotencyKey] = { kind: 'checkout', ref: order.id, atMs: now };
    save(state);
    return ok({ order, replayed: false, snapshot: snapshot(state, now) }, 201);
  }

  function getOrders(): HttpResult<OrdersResponse> {
    const { state, now } = begin();
    return ok({ serverTime: iso(now), orders: state.orders });
  }

  function price(body: Partial<PriceRequest>): HttpResult<PriceResponse> {
    const { now } = begin();
    if (!Array.isArray(body.lines) || !body.lines.every((l) => isPositiveInt(l?.qty) && isSelection(l?.options))) {
      return fail(400, 'BAD_REQUEST', 'lines must be [{ qty, options }].');
    }
    if (random() < priceFailureRate) {
      return fail(503, 'PRICING_UNAVAILABLE', 'Pricing is temporarily unavailable.');
    }
    return ok({
      serverTime: iso(now),
      pricing: priceCart({ lines: body.lines, couponCode: body.couponCode ?? null }, menu, promotions, now),
    });
  }

  function getDev(): HttpResult<DevSettings & { serverTime: string }> {
    const { state, now } = begin();
    return ok({ ...state.dev, serverTime: iso(now) });
  }

  function setDev(body: Partial<DevSettings>): HttpResult<DevSettings & { serverTime: string }> {
    const { state } = begin();
    if (typeof body.clockOffsetMs === 'number' && Number.isFinite(body.clockOffsetMs)) {
      state.dev.clockOffsetMs = Math.round(body.clockOffsetMs);
    }
    if (typeof body.failNextReserve === 'boolean') state.dev.failNextReserve = body.failNextReserve;
    save(state);
    return ok({ ...state.dev, serverTime: iso(serverNow(state)) });
  }

  /** Wipe everything and start again from the fixture and seed. */
  function reset(): HttpResult<{ ok: true }> {
    save(initialState());
    return ok({ ok: true });
  }

  return {
    fixture,
    getMenu,
    getCart,
    addItem,
    updateItem,
    removeItem,
    setCoupon,
    checkout,
    getOrders,
    price,
    getDev,
    setDev,
    reset,
  };
}

export type MockServer = ReturnType<typeof createMockServer>;
