import { createSlice } from '@reduxjs/toolkit';
import type { MenuResponse } from '../../api/contracts';
import { fetchMenu } from '../thunks';

/** Read-only catalogue from the server: groups, rules, ingredients, promotions. */
export interface MenuState {
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  data: MenuResponse | null;
  error: string | null;
}

const initialState: MenuState = { status: 'idle', data: null, error: null };

const menuSlice = createSlice({
  name: 'menu',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMenu.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchMenu.fulfilled, (state, { payload }) => {
        state.status = 'succeeded';
        state.data = payload;
      })
      .addCase(fetchMenu.rejected, (state, { payload }) => {
        state.status = 'failed';
        state.error = payload?.message ?? 'Could not load the menu.';
      });
  },
});

export default menuSlice.reducer;
