import { createSlice } from '@reduxjs/toolkit';
import type { StoredOrder } from '../../domain/orders';
import { checkout, fetchOrders } from '../thunks';

/**
 * Orders from the server (seed + checkouts). Kept in Redux because the assistant's tools
 * read them at question time, so a new checkout is reflected immediately (TC-18).
 */
export interface OrdersState {
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
  items: StoredOrder[];
}

const initialState: OrdersState = { status: 'idle', error: null, items: [] };

const orderSlice = createSlice({
  name: 'orders',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchOrders.pending, (state) => {
        if (state.status !== 'succeeded') state.status = 'loading';
      })
      .addCase(fetchOrders.fulfilled, (state, { payload }) => {
        state.status = 'succeeded';
        state.error = null;
        state.items = payload.orders;
      })
      .addCase(fetchOrders.rejected, (state, { payload }) => {
        if (state.status !== 'succeeded') state.status = 'failed';
        state.error = payload?.message ?? 'Could not load orders.';
      })
      .addCase(checkout.fulfilled, (state, { payload }) => {
        if (!state.items.some((o) => o.id === payload.order.id)) state.items.push(payload.order);
      });
  },
});

export default orderSlice.reducer;
