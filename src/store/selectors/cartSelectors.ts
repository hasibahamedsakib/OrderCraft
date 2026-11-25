import { createSelector } from '@reduxjs/toolkit';
import { formatShortages, shortagesFor } from '../../domain/stock';
import type { IngredientAmounts } from '../../domain/types';
import type { RootState } from '../index';

export const selectCart = (state: RootState) => state.cart;
export const selectCartItems = (state: RootState) => state.cart.items;
export const selectCartPricing = (state: RootState) => state.cart.pricing;
export const selectCartVersion = (state: RootState) => state.cart.version;
export const selectStock = (state: RootState) => state.inventory.stock;
export const selectClockOffset = (state: RootState) => state.clock.offsetMs;

export const selectActiveItems = createSelector([selectCartItems], (items) => items.filter((i) => i.status === 'active'));
export const selectExpiredItems = createSelector([selectCartItems], (items) => items.filter((i) => i.status === 'expired'));

/** ingredientId -> units free on the server right now (tracked ingredients only). */
export const selectAvailableStock = createSelector([selectStock], (stock) => {
  const available: IngredientAmounts = {};
  for (const [id, s] of Object.entries(stock)) available[id] = s.available;
  return available;
});

/**
 * "Short: …" text if a cart item's quantity were changed to `qty`, using the item's own
 * allocation as available to itself (net-difference rule). Empty string = allowed.
 */
export function selectQtyChangeShortage(state: RootState, itemId: string, qty: number): string {
  const item = state.cart.items.find((i) => i.id === itemId);
  const menu = state.menu.data?.menu;
  if (!item || !menu) return '';
  const shortages = shortagesFor({
    selection: item.selection,
    qty,
    groups: menu.groups,
    available: selectAvailableStock(state),
    ownAllocation: item.allocation,
  });
  return formatShortages(shortages, menu.ingredients);
}
