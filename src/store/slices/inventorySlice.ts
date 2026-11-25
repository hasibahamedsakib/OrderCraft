import { createSlice } from '@reduxjs/toolkit';
import type { IngredientStockDTO } from '../../api/contracts';
import { cartSnapshotReceived } from '../actions';

/**
 * Last stock figures the server reported. Never changed optimistically: stock is shared with
 * other tabs, so only the server can say what is available.
 */
export interface InventoryState {
  loaded: boolean;
  stock: Record<string, IngredientStockDTO>;
}

const initialState: InventoryState = { loaded: false, stock: {} };

const inventorySlice = createSlice({
  name: 'inventory',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(cartSnapshotReceived, (state, { payload }) => {
      state.loaded = true;
      state.stock = payload.stock;
    });
  },
});

export default inventorySlice.reducer;
