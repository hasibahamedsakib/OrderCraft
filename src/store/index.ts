import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { createAppListenerMiddleware } from './listeners';
import { loadBuilderDraft, saveBuilderDraft } from './persistence';
import builderReducer, { createBuilderState } from './slices/builderSlice';
import cartReducer from './slices/cartSlice';
import chatReducer from './slices/chatSlice';
import clockReducer from './slices/clockSlice';
import inventoryReducer from './slices/inventorySlice';
import menuReducer from './slices/menuSlice';
import ordersReducer from './slices/orderSlice';

/*
 * State ownership
 *  Redux, server mirrors: menu, cart, inventory, orders (never changed before the server answers)
 *  Redux, client-owned:   builder (draft configuration + preview), chat, clock offset
 *  Component state:       purely visual things (open panels, input text before submit)
 */
const rootReducer = combineReducers({
  menu: menuReducer,
  builder: builderReducer,
  cart: cartReducer,
  inventory: inventoryReducer,
  orders: ordersReducer,
  chat: chatReducer,
  clock: clockReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

interface StoreOptions {
  /** Where to persist the unfinished configuration. null disables it. */
  storage?: Storage | null;
}

export function makeStore({ storage = typeof window === 'undefined' ? null : window.localStorage }: StoreOptions = {}) {
  const draft = loadBuilderDraft(storage);
  const listenerMiddleware = createAppListenerMiddleware();
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: draft ? { builder: createBuilderState(draft) } : undefined,
    middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
  });

  let last = store.getState().builder;
  store.subscribe(() => {
    const { builder } = store.getState();
    if (builder.selection === last.selection && builder.qty === last.qty && builder.editingItemId === last.editingItemId) return;
    last = builder;
    saveBuilderDraft(storage, { selection: builder.selection, qty: builder.qty, editingItemId: builder.editingItemId });
  });
  return store;
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
