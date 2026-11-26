import { createSelector } from '@reduxjs/toolkit';
import type { CartItemDTO } from '../../api/contracts';
import { groupStates, optionStates } from '../../domain/availability';
import {
  formatShortages,
  freeStockFor,
  headroomByOption,
  shortagesFor,
  shortagesForOneMore,
  stockLeftAfter,
  usageForItem,
} from '../../domain/stock';
import { validate, type Violation } from '../../domain/validate';
import type { RootState } from '../index';
import { selectAvailableStock, selectCartItems } from './cartSelectors';
import { selectGroups, selectIngredients, selectRules } from './menuSelectors';

export const selectSelection = (state: RootState) => state.builder.selection;
export const selectBuilderQty = (state: RootState) => state.builder.qty;
export const selectEditingItemId = (state: RootState) => state.builder.editingItemId;
export const selectSubmit = (state: RootState) => state.builder.submit;
export const selectPreview = (state: RootState) => state.builder.preview;

/**
 * What the builder is doing:
 *  new           - building a new item
 *  edit          - editing an active cart item (its own allocation counts as free)
 *  edit-expired  - the item's reservation expired: changes are kept, saving adds a new item (D3)
 *  edit-missing  - the item was removed (e.g. in another tab): saving adds a new item
 */
export type EditingContext =
  | { mode: 'new' }
  | { mode: 'edit'; item: CartItemDTO }
  | { mode: 'edit-expired'; item: CartItemDTO }
  | { mode: 'edit-missing'; itemId: string };

export const selectEditingContext = createSelector(
  [selectEditingItemId, selectCartItems],
  (itemId, items): EditingContext => {
    if (!itemId) return { mode: 'new' };
    const item = items.find((i) => i.id === itemId);
    if (!item) return { mode: 'edit-missing', itemId };
    return item.status === 'active' ? { mode: 'edit', item } : { mode: 'edit-expired', item };
  },
);

export const selectViolations = createSelector([selectSelection, selectGroups, selectRules], (selection, groups, rules) =>
  groups.length === 0 ? [] : validate(selection, groups, rules),
);

export const selectViolationsByGroup = createSelector([selectViolations], (violations) => {
  const byGroup = new Map<string, Violation[]>();
  for (const v of violations) {
    const key = v.groupId ?? '_general';
    byGroup.set(key, [...(byGroup.get(key) ?? []), v]);
  }
  return byGroup;
});

/** Stock this configuration may use: server-available + (when editing an active item) its own hold. */
export const selectBuilderFreeStock = createSelector(
  [selectAvailableStock, selectEditingContext],
  (available, context) => freeStockFor(available, context.mode === 'edit' ? context.item.allocation : {}),
);

export const selectDraftShortages = createSelector(
  [selectSelection, selectBuilderQty, selectGroups, selectAvailableStock, selectEditingContext],
  (selection, qty, groups, available, context) =>
    shortagesFor({
      selection,
      qty,
      groups,
      available,
      ownAllocation: context.mode === 'edit' ? context.item.allocation : {},
    }),
);

export const selectShortageText = createSelector([selectDraftShortages, selectIngredients], (shortages, ingredients) =>
  formatShortages(shortages, ingredients),
);

/** optionId -> how many more units can be added right now (null = unlimited). */
export const selectHeadroom = createSelector(
  [selectSelection, selectBuilderQty, selectGroups, selectBuilderFreeStock],
  (selection, qty, groups, free) => headroomByOption({ selection, qty, groups, free }),
);

/**
 * optionId -> "Short: …" for options blocked by stock while some of the needed stock is
 * still free (e.g. 1 egg left, Omelette needs 2). Options with nothing left at all are
 * simply "Out of stock" and get no entry.
 */
export const selectOneMoreShortText = createSelector(
  [selectSelection, selectBuilderQty, selectGroups, selectIngredients, selectBuilderFreeStock],
  (selection, qty, groups, ingredients, free) => {
    const left = stockLeftAfter(free, usageForItem(selection, qty, groups));
    const out: Record<string, string> = {};
    for (const group of groups) {
      for (const option of group.options) {
        const shortages = shortagesForOneMore(option, left, qty);
        if (shortages.length > 0 && shortages.some((sh) => (left[sh.ingredientId] ?? 0) > 0)) {
          out[option.id] = formatShortages(shortages, ingredients);
        }
      }
    }
    return out;
  },
);

export const selectGroupStates =createSelector([selectSelection, selectGroups, selectRules], groupStates);

/** optionId -> qty, stock headroom, and whether/why it can't take one more unit. */
export const selectOptionStates = createSelector(
  [selectSelection, selectGroups, selectGroupStates, selectHeadroom],
  optionStates,
);

export const selectCanSubmit = (state: RootState): boolean =>
  state.menu.status === 'succeeded' &&
  state.inventory.loaded &&
  state.builder.submit.status !== 'pending' &&
  selectViolations(state).length === 0 &&
  selectDraftShortages(state).length === 0;
