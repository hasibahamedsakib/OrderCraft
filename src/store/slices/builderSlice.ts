import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { newIdempotencyKey } from '../../api/client';
import type { CartItemDTO } from '../../api/contracts';
import type { CartPricing } from '../../domain/pricing';
import type { Selection } from '../../domain/types';
import type { SubmitError } from '../errors';
import { fetchMenu, fetchPricePreview, submitBuilder } from '../thunks';

/**
 * The configuration being built or edited. Lives in Redux (not component state) because the
 * price preview, stock headroom, validation and cart editing all read it, and it is persisted
 * so an unfinished configuration survives a refresh.
 */
export interface BuilderState {
  selection: Selection;
  qty: number;
  /** Cart item being edited, or null for a new item. */
  editingItemId: string | null;
  /** Idempotency key for the next Add to cart. Renewed only after a successful add. */
  addKey: string;
  submit: { status: 'idle' | 'pending' | 'failed'; error: SubmitError | null };
  /** Shown after a successful save, until the next change. */
  lastSaved: 'added' | 'updated' | null;
  preview: {
    status: 'idle' | 'loading' | 'succeeded' | 'failed';
    /** requestId of the newest preview request; responses from any other request are ignored. */
    requestId: string | null;
    /** previewKey() of the configuration `pricing` belongs to. */
    key: string | null;
    pricing: CartPricing | null;
    error: string | null;
  };
}

export type PersistedBuilder = Pick<BuilderState, 'selection' | 'qty' | 'editingItemId'>;

export function createBuilderState(persisted?: Partial<PersistedBuilder>): BuilderState {
  return {
    selection: persisted?.selection ?? {},
    qty: persisted?.qty ?? 1,
    editingItemId: persisted?.editingItemId ?? null,
    addKey: newIdempotencyKey(),
    submit: { status: 'idle', error: null },
    lastSaved: null,
    preview: { status: 'idle', requestId: null, key: null, pricing: null, error: null },
  };
}

function touched(state: BuilderState): void {
  state.lastSaved = null;
  if (state.submit.status === 'failed') state.submit = { status: 'idle', error: null };
}

const builderSlice = createSlice({
  name: 'builder',
  initialState: () => createBuilderState(),
  reducers: {
    optionQtySet(state, { payload }: PayloadAction<{ optionId: string; qty: number }>) {
      if (payload.qty > 0) state.selection[payload.optionId] = payload.qty;
      else delete state.selection[payload.optionId];
      touched(state);
    },
    /** Radio-style pick in a single-choice group: clear the group's other options. */
    singleOptionPicked(state, { payload }: PayloadAction<{ optionId: string; groupOptionIds: string[] }>) {
      for (const id of payload.groupOptionIds) delete state.selection[id];
      state.selection[payload.optionId] = 1;
      touched(state);
    },
    itemQtySet(state, { payload }: PayloadAction<number>) {
      state.qty = payload;
      touched(state);
    },
    editStarted(state, { payload }: PayloadAction<CartItemDTO>) {
      state.editingItemId = payload.id;
      state.selection = { ...payload.selection };
      state.qty = payload.qty;
      touched(state);
    },
    builderReset(state) {
      state.selection = {};
      state.qty = 1;
      state.editingItemId = null;
      touched(state);
    },
    previewRetried(state) {
      state.preview.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMenu.fulfilled, (state, { payload }) => {
        // A different menu may have been loaded: drop options that no longer exist.
        const known = new Set(payload.menu.groups.flatMap((g) => g.options.map((o) => o.id)));
        for (const id of Object.keys(state.selection)) if (!known.has(id)) delete state.selection[id];
        state.qty = Math.min(Math.max(state.qty, payload.menu.product.minQty), payload.menu.product.maxQty);
      })
      .addCase(submitBuilder.pending, (state) => {
        state.submit = { status: 'pending', error: null };
      })
      .addCase(submitBuilder.fulfilled, (state, { payload }) => {
        state.submit = { status: 'idle', error: null };
        state.selection = {};
        state.qty = 1;
        state.editingItemId = null;
        state.lastSaved = payload.mode;
        if (payload.mode === 'added') state.addKey = newIdempotencyKey();
      })
      .addCase(submitBuilder.rejected, (state, { payload }) => {
        // Keep the configuration: the user loses nothing they chose.
        state.submit = { status: 'failed', error: payload ?? { code: 'UNKNOWN', message: 'Could not save.' } };
      })
      .addCase(fetchPricePreview.pending, (state, { meta }) => {
        state.preview.status = 'loading';
        state.preview.requestId = meta.requestId;
        state.preview.error = null;
      })
      .addCase(fetchPricePreview.fulfilled, (state, { meta, payload }) => {
        if (meta.requestId !== state.preview.requestId) return; // stale response
        state.preview = { status: 'succeeded', requestId: meta.requestId, key: payload.key, pricing: payload.pricing, error: null };
      })
      .addCase(fetchPricePreview.rejected, (state, { meta, payload }) => {
        if (meta.requestId !== state.preview.requestId || meta.aborted) return;
        state.preview.status = 'failed';
        state.preview.error = payload?.message ?? 'Could not get a price.';
      });
  },
});

export const { optionQtySet, singleOptionPicked, itemQtySet, editStarted, builderReset, previewRetried } =
  builderSlice.actions;
export default builderSlice.reducer;
