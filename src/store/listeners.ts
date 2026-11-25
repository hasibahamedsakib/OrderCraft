import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit';
import {
  builderReset,
  editStarted,
  itemQtySet,
  optionQtySet,
  previewRetried,
  singleOptionPicked,
} from './slices/builderSlice';
import { fetchMenu, fetchPricePreview, submitBuilder } from './thunks';
import type { AppDispatch, RootState } from './index';

export const PREVIEW_DEBOUNCE_MS = 300;

/** One listener middleware per store, so test stores never share listeners. */
export function createAppListenerMiddleware() {
  const listenerMiddleware = createListenerMiddleware();
  const startAppListening = listenerMiddleware.startListening.withTypes<RootState, AppDispatch>();

/**
 * Debounced price preview (300 ms). Each new change cancels the previous listener run;
 * if that run already sent a request, the request is aborted too. Together with the
 * requestId check in the reducer this guarantees only the latest configuration's price shows.
 */
startAppListening({
  matcher: isAnyOf(
    optionQtySet,
    singleOptionPicked,
    itemQtySet,
    editStarted,
    builderReset,
    previewRetried,
    fetchMenu.fulfilled,
    submitBuilder.fulfilled,
  ),
  effect: async (action, listenerApi) => {
    listenerApi.cancelActiveListeners();
    if (!previewRetried.match(action)) await listenerApi.delay(PREVIEW_DEBOUNCE_MS);
    if (listenerApi.getState().menu.status !== 'succeeded') return;

    const request = listenerApi.dispatch(fetchPricePreview());
    // listenerApi.signal aborts when a newer change cancels this run
    listenerApi.signal.addEventListener('abort', () => request.abort(), { once: true });
    await request;
  },
});

  return listenerMiddleware;
}
