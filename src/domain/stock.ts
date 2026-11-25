import { indexOptions } from './menu';
import type { Ingredient, IngredientAmounts, IngredientId, MenuGroup, MenuOption, Selection } from './types';

/**
 * Stock model
 * - The server tracks on-hand stock per ingredient and the allocation held by each cart item.
 * - available = onHand - sum(active allocations). Ingredients not in `available` are unlimited.
 * - When editing an item, its own allocation counts as free to itself (net-difference rule):
 *     free = available + ownAllocation
 */

export interface Shortage {
  ingredientId: IngredientId;
  missing: number;
}

/** Ingredient use of ONE unit of the product with this selection. */
export function usagePerUnit(selection: Selection, groups: MenuGroup[]): IngredientAmounts {
  const index = indexOptions(groups);
  const usage: IngredientAmounts = {};
  for (const [optionId, qty] of Object.entries(selection)) {
    const entry = index.get(optionId);
    if (!entry || qty <= 0) continue;
    for (const [ingredientId, perUnit] of Object.entries(entry.option.uses)) {
      usage[ingredientId] = (usage[ingredientId] ?? 0) + perUnit * qty;
    }
  }
  return usage;
}

/** Usage of a whole cart item: per-unit usage x item quantity. */
export function usageForItem(selection: Selection, itemQty: number, groups: MenuGroup[]): IngredientAmounts {
  return scaleAmounts(usagePerUnit(selection, groups), itemQty);
}

export function scaleAmounts(amounts: IngredientAmounts, factor: number): IngredientAmounts {
  const out: IngredientAmounts = {};
  for (const [id, amount] of Object.entries(amounts)) out[id] = amount * factor;
  return out;
}

export function addAmounts(a: IngredientAmounts, b: IngredientAmounts): IngredientAmounts {
  const out: IngredientAmounts = { ...a };
  for (const [id, amount] of Object.entries(b)) out[id] = (out[id] ?? 0) + amount;
  return out;
}

/** Stock usable by one item: what is free on the server plus what the item already holds. */
export function freeStockFor(available: IngredientAmounts, ownAllocation: IngredientAmounts = {}): IngredientAmounts {
  const out: IngredientAmounts = { ...available };
  for (const [id, held] of Object.entries(ownAllocation)) {
    if (id in out) out[id] = (out[id] ?? 0) + held;
  }
  return out;
}

/** Every ingredient where `needed` exceeds `free`, with the exact missing amount. */
export function findShortages(needed: IngredientAmounts, free: IngredientAmounts): Shortage[] {
  const shortages: Shortage[] = [];
  for (const [ingredientId, amount] of Object.entries(needed)) {
    if (!(ingredientId in free)) continue; // untracked ingredient = unlimited
    const missing = amount - (free[ingredientId] ?? 0);
    if (missing > 0) shortages.push({ ingredientId, missing });
  }
  return shortages;
}

/** Shortages for saving `selection x qty` given current server stock and the item's own hold. */
export function shortagesFor(params: {
  selection: Selection;
  qty: number;
  groups: MenuGroup[];
  available: IngredientAmounts;
  ownAllocation?: IngredientAmounts;
}): Shortage[] {
  const needed = usageForItem(params.selection, params.qty, params.groups);
  return findShortages(needed, freeStockFor(params.available, params.ownAllocation));
}

/** "Short: 2 egg, 2 cheese" in the menu's ingredient order. */
export function formatShortages(shortages: Shortage[], ingredients: Ingredient[]): string {
  if (shortages.length === 0) return '';
  const order = new Map(ingredients.map((ing, i) => [ing.id, i]));
  const nameOf = (id: IngredientId) => ingredients.find((ing) => ing.id === id)?.name ?? id;
  const sorted = [...shortages].sort(
    (a, b) => (order.get(a.ingredientId) ?? Infinity) - (order.get(b.ingredientId) ?? Infinity),
  );
  return `Short: ${sorted.map((s) => `${s.missing} ${nameOf(s.ingredientId)}`).join(', ')}`;
}

/**
 * How many more units of `option` can be added to the selection right now, given the
 * stock left after the current draft (x item qty). null = unlimited.
 */
export function headroomForOption(
  option: MenuOption,
  stockLeftAfterDraft: IngredientAmounts,
  itemQty: number,
): number | null {
  let headroom: number | null = null;
  for (const [ingredientId, perUnit] of Object.entries(option.uses)) {
    if (perUnit <= 0 || !(ingredientId in stockLeftAfterDraft)) continue;
    const left = Math.max(0, stockLeftAfterDraft[ingredientId] ?? 0);
    const units = Math.floor(left / (perUnit * itemQty));
    headroom = headroom === null ? units : Math.min(headroom, units);
  }
  return headroom;
}

/** free - draft usage, per tracked ingredient (may go negative when short). */
export function stockLeftAfter(free: IngredientAmounts, draftUsage: IngredientAmounts): IngredientAmounts {
  const out: IngredientAmounts = { ...free };
  for (const [id, used] of Object.entries(draftUsage)) {
    if (id in out) out[id] = (out[id] ?? 0) - used;
  }
  return out;
}

/** Headroom for every option of the menu at once. */
export function headroomByOption(params: {
  selection: Selection;
  qty: number;
  groups: MenuGroup[];
  free: IngredientAmounts;
}): Record<string, number | null> {
  const left = stockLeftAfter(params.free, usageForItem(params.selection, params.qty, params.groups));
  const out: Record<string, number | null> = {};
  for (const group of params.groups) {
    for (const option of group.options) out[option.id] = headroomForOption(option, left, params.qty);
  }
  return out;
}

/** Max number of product units with this selection that fit in `free` (null = unlimited). */
export function maxUnitsOf(selection: Selection, groups: MenuGroup[], free: IngredientAmounts): number | null {
  const perUnit = usagePerUnit(selection, groups);
  let max: number | null = null;
  for (const [id, amount] of Object.entries(perUnit)) {
    if (amount <= 0 || !(id in free)) continue;
    const units = Math.floor((free[id] ?? 0) / amount);
    max = max === null ? units : Math.min(max, units);
  }
  return max;
}

/** Ingredient that runs out first for `maxUnitsOf`. */
export function limitingIngredients(selection: Selection, groups: MenuGroup[], free: IngredientAmounts): IngredientId[] {
  const perUnit = usagePerUnit(selection, groups);
  const max = maxUnitsOf(selection, groups, free);
  if (max === null) return [];
  return Object.entries(perUnit)
    .filter(([id, amount]) => amount > 0 && id in free && Math.floor((free[id] ?? 0) / amount) === max)
    .map(([id]) => id);
}
