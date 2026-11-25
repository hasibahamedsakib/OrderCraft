import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError, api, type Timed } from '../api/client';
import type { CartSnapshot, CheckoutResponse, MenuResponse, OrdersResponse, PriceResponse } from '../api/contracts';
import { cartSnapshotReceived, serverTimeObserved } from './actions';
import { toSubmitError, type SubmitError } from './errors';
import type { AppDispatch, RootState } from './index';
import { selectEditingContext } from './selectors/builderSelectors';

export const createAppAsyncThunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: SubmitError;
}>();

/**
 * Responses can arrive out of order (a slow poll after a fast mutation). Only accept a snapshot
 * that is newer: higher version, or same version observed at a later server time (expiry).
 * A different epoch means the demo data was reset, so always accept.
 */
export function isNewerSnapshot(
  current: { epoch: string | null; version: number; serverTime: string | null },
  incoming: CartSnapshot,
): boolean {
  if (current.epoch !== incoming.cart.epoch) return true;
  if (incoming.cart.version !== current.version) return incoming.cart.version > current.version;
  return current.serverTime === null || Date.parse(incoming.serverTime) >= Date.parse(current.serverTime);
}

type ThunkApi = { dispatch: AppDispatch; getState: () => RootState };

function observe({ dispatch }: ThunkApi, timed: { serverTime: string; sentAt: number; receivedAt: number }): void {
  dispatch(serverTimeObserved(timed));
}

function receive(thunk: ThunkApi, snapshot: CartSnapshot, timing: { sentAt: number; receivedAt: number }): void {
  observe(thunk, { serverTime: snapshot.serverTime, ...timing });
  if (isNewerSnapshot(thunk.getState().cart, snapshot)) thunk.dispatch(cartSnapshotReceived(snapshot));
}

/** Error bodies often carry a fresh snapshot (stock moved, version conflict): apply it. */
function receiveFromError(thunk: ThunkApi, error: unknown): void {
  if (error instanceof ApiError && error.body?.snapshot) {
    const now = Date.now();
    receive(thunk, error.body.snapshot, { sentAt: now, receivedAt: now });
  }
}

function timingOf<T>(timed: Timed<T>) {
  return { sentAt: timed.sentAt, receivedAt: timed.receivedAt };
}

/* ---------- menu & orders ---------- */

export const fetchMenu = createAppAsyncThunk<MenuResponse, void>('menu/fetch', async (_, thunk) => {
  try {
    const res = await api.getMenu();
    observe(thunk, { serverTime: res.data.serverTime, ...timingOf(res) });
    return res.data;
  } catch (error) {
    return thunk.rejectWithValue(toSubmitError(error));
  }
});

export const fetchOrders = createAppAsyncThunk<OrdersResponse, void>('orders/fetch', async (_, thunk) => {
  try {
    const res = await api.getOrders();
    observe(thunk, { serverTime: res.data.serverTime, ...timingOf(res) });
    return res.data;
  } catch (error) {
    return thunk.rejectWithValue(toSubmitError(error));
  }
});

/* ---------- cart ---------- */

export const fetchCart = createAppAsyncThunk<CartSnapshot, void>('cart/fetch', async (_, thunk) => {
  try {
    const res = await api.getCart();
    receive(thunk, res.data, timingOf(res));
    return res.data;
  } catch (error) {
    return thunk.rejectWithValue(toSubmitError(error));
  }
});

/**
 * Save the builder: add a new item, or swap an existing item's allocation (edit).
 * If the item being edited expired or vanished (D3), the draft is added as a new item instead,
 * and the dead expired copy is removed.
 */
export const submitBuilder = createAppAsyncThunk<{ mode: 'added' | 'updated' }, void>(
  'builder/submit',
  async (_, thunk) => {
    const state = thunk.getState();
    const { selection, qty, addKey } = state.builder;
    const context = selectEditingContext(state);
    try {
      if (context.mode === 'edit') {
        const res = await api.updateItem(context.item.id, { selection, qty, baseVersion: state.cart.version });
        receive(thunk, res.data, timingOf(res));
        return { mode: 'updated' };
      }
      const res = await api.addItem({ idempotencyKey: addKey, selection, qty });
      receive(thunk, res.data.snapshot, timingOf(res));
      if (context.mode === 'edit-expired') {
        try {
          const cleanup = await api.removeItem(context.item.id, res.data.snapshot.cart.version);
          receive(thunk, cleanup.data, timingOf(cleanup));
        } catch (error) {
          receiveFromError(thunk, error); // best effort: the expired copy holds no stock anyway
        }
      }
      return { mode: 'added' };
    } catch (error) {
      receiveFromError(thunk, error);
      return thunk.rejectWithValue(toSubmitError(error));
    }
  },
  { condition: (_, { getState }) => getState().builder.submit.status !== 'pending' },
);

/** Change only the quantity of a cart item (cart row stepper). Same atomic swap endpoint. */
export const changeItemQty = createAppAsyncThunk<void, { itemId: string; qty: number }>(
  'cart/changeItemQty',
  async ({ itemId, qty }, thunk) => {
    const state = thunk.getState();
    const item = state.cart.items.find((i) => i.id === itemId);
    if (!item) return thunk.rejectWithValue({ code: 'NOT_FOUND', message: 'This item is no longer in the cart.' });
    try {
      const res = await api.updateItem(itemId, { selection: item.selection, qty, baseVersion: state.cart.version });
      receive(thunk, res.data, timingOf(res));
    } catch (error) {
      receiveFromError(thunk, error);
      return thunk.rejectWithValue(toSubmitError(error));
    }
  },
  { condition: ({ itemId }, { getState }) => getState().cart.itemOps[itemId]?.status !== 'pending' },
);

export const removeCartItem = createAppAsyncThunk<void, { itemId: string }>(
  'cart/removeItem',
  async ({ itemId }, thunk) => {
    try {
      const res = await api.removeItem(itemId, thunk.getState().cart.version);
      receive(thunk, res.data, timingOf(res));
    } catch (error) {
      receiveFromError(thunk, error);
      return thunk.rejectWithValue(toSubmitError(error));
    }
  },
  { condition: ({ itemId }, { getState }) => getState().cart.itemOps[itemId]?.status !== 'pending' },
);

export const applyCoupon = createAppAsyncThunk<void, { code: string | null }>('cart/applyCoupon', async ({ code }, thunk) => {
  try {
    const res = await api.setCoupon(code);
    receive(thunk, res.data, timingOf(res));
  } catch (error) {
    receiveFromError(thunk, error);
    return thunk.rejectWithValue(toSubmitError(error));
  }
});

/**
 * Pay. The idempotency key lives in state and only changes after a successful checkout, so a
 * double click or a retry after a lost response can never create a second order (TC-16).
 * The payable the user saw is sent; the server refuses if its own price differs (D2).
 */
export const checkout = createAppAsyncThunk<CheckoutResponse, { paymentMethod: string }>(
  'cart/checkout',
  async ({ paymentMethod }, thunk) => {
    const { cart } = thunk.getState();
    try {
      const res = await api.checkout({
        idempotencyKey: cart.checkout.idempotencyKey,
        paymentMethod,
        baseVersion: cart.version,
        expectedPayable: cart.pricing?.payable,
      });
      receive(thunk, res.data.snapshot, timingOf(res));
      return res.data;
    } catch (error) {
      receiveFromError(thunk, error);
      return thunk.rejectWithValue(toSubmitError(error));
    }
  },
  { condition: (_, { getState }) => getState().cart.checkout.status !== 'pending' },
);

/* ---------- price preview ---------- */

/**
 * Price of the configuration being built, from the server. The reducer only accepts the
 * response whose requestId is the latest one, and the listener aborts superseded requests,
 * so an older response can never replace a newer configuration's price (TC-12).
 */
export const fetchPricePreview = createAppAsyncThunk<PriceResponse & { key: string }, void>(
  'builder/pricePreview',
  async (_, thunk) => {
    const { selection, qty } = thunk.getState().builder;
    const key = previewKey(selection, qty);
    try {
      const res = await api.price({ lines: [{ qty, options: selection }] }, thunk.signal);
      observe(thunk, { serverTime: res.data.serverTime, ...timingOf(res) });
      return { ...res.data, key };
    } catch (error) {
      return thunk.rejectWithValue(toSubmitError(error));
    }
  },
);

/** Stable identity of a configuration, used to show only the price that belongs to it. */
export function previewKey(selection: Record<string, number>, qty: number): string {
  const entries = Object.entries(selection)
    .filter(([, q]) => q > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([qty, entries]);
}
