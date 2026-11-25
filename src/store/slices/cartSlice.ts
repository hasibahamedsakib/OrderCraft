import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { newIdempotencyKey } from '../../api/client';
import type { CartItemDTO } from '../../api/contracts';
import type { CartPricing } from '../../domain/pricing';
import { cartSnapshotReceived } from '../actions';
import type { SubmitError } from '../errors';
import { applyCoupon, changeItemQty, checkout, fetchCart, removeCartItem } from '../thunks';

/** Mirror of the server's cart. Every change goes through the server first. */
export interface CartState {
  loadStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
  loadError: string | null;
  epoch: string | null;
  version: number;
  serverTime: string | null;
  items: CartItemDTO[];
  couponCode: string | null;
  pricing: CartPricing | null;
  /** Per-item request state (qty change, remove). */
  itemOps: Record<string, { status: 'pending' | 'failed'; error: SubmitError | null }>;
  coupon: { status: 'idle' | 'pending' | 'failed'; error: string | null };
  checkout: {
    status: 'idle' | 'pending' | 'succeeded' | 'failed';
    error: SubmitError | null;
    idempotencyKey: string;
    lastOrderId: string | null;
  };
}

const initialState = (): CartState => ({
  loadStatus: 'idle',
  loadError: null,
  epoch: null,
  version: 0,
  serverTime: null,
  items: [],
  couponCode: null,
  pricing: null,
  itemOps: {},
  coupon: { status: 'idle', error: null },
  checkout: { status: 'idle', error: null, idempotencyKey: newIdempotencyKey(), lastOrderId: null },
});

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    itemErrorDismissed(state, { payload }: PayloadAction<string>) {
      delete state.itemOps[payload];
    },
    checkoutErrorDismissed(state) {
      if (state.checkout.status === 'failed') state.checkout = { ...state.checkout, status: 'idle', error: null };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(cartSnapshotReceived, (state, { payload }) => {
        state.epoch = payload.cart.epoch;
        state.version = payload.cart.version;
        state.serverTime = payload.serverTime;
        state.items = payload.cart.items;
        state.couponCode = payload.cart.couponCode;
        state.pricing = payload.pricing;
        state.loadStatus = 'succeeded';
        state.loadError = null;
        for (const id of Object.keys(state.itemOps)) {
          if (!payload.cart.items.some((item) => item.id === id)) delete state.itemOps[id];
        }
      })
      .addCase(fetchCart.pending, (state) => {
        if (state.loadStatus !== 'succeeded') state.loadStatus = 'loading';
      })
      .addCase(fetchCart.rejected, (state, { payload }) => {
        if (state.loadStatus !== 'succeeded') {
          state.loadStatus = 'failed';
          state.loadError = payload?.message ?? 'Could not load the cart.';
        }
      })

      .addCase(changeItemQty.pending, (state, { meta }) => {
        state.itemOps[meta.arg.itemId] = { status: 'pending', error: null };
      })
      .addCase(changeItemQty.fulfilled, (state, { meta }) => {
        delete state.itemOps[meta.arg.itemId];
      })
      .addCase(changeItemQty.rejected, (state, { meta, payload }) => {
        state.itemOps[meta.arg.itemId] = { status: 'failed', error: payload ?? { code: 'UNKNOWN', message: 'Update failed.' } };
      })
      .addCase(removeCartItem.pending, (state, { meta }) => {
        state.itemOps[meta.arg.itemId] = { status: 'pending', error: null };
      })
      .addCase(removeCartItem.fulfilled, (state, { meta }) => {
        delete state.itemOps[meta.arg.itemId];
      })
      .addCase(removeCartItem.rejected, (state, { meta, payload }) => {
        state.itemOps[meta.arg.itemId] = { status: 'failed', error: payload ?? { code: 'UNKNOWN', message: 'Remove failed.' } };
      })

      .addCase(applyCoupon.pending, (state) => {
        state.coupon = { status: 'pending', error: null };
      })
      .addCase(applyCoupon.fulfilled, (state) => {
        state.coupon = { status: 'idle', error: null };
      })
      .addCase(applyCoupon.rejected, (state, { payload }) => {
        state.coupon = { status: 'failed', error: payload?.message ?? 'Could not update the coupon.' };
      })

      .addCase(checkout.pending, (state) => {
        state.checkout.status = 'pending';
        state.checkout.error = null;
      })
      .addCase(checkout.fulfilled, (state, { payload }) => {
        state.checkout = {
          status: 'succeeded',
          error: null,
          idempotencyKey: newIdempotencyKey(), // the next order needs a new key
          lastOrderId: payload.order.id,
        };
      })
      .addCase(checkout.rejected, (state, { payload }) => {
        state.checkout.status = 'failed';
        state.checkout.error = payload ?? { code: 'UNKNOWN', message: 'Payment failed.' };
      });
  },
});

export const { itemErrorDismissed, checkoutErrorDismissed } = cartSlice.actions;
export default cartSlice.reducer;
