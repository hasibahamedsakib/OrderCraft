import { loadFixture } from '../mocks/fixture';
import { B, C } from '../test/configs';
import { priceUnit } from './pricing';
import {
  addAmounts,
  formatShortages,
  freeStockFor,
  headroomByOption,
  shortagesFor,
  stockLeftAfter,
  usageForItem,
} from './stock';
import type { IngredientAmounts } from './types';

const { menu, promotions, initialStock } = loadFixture();
const { groups, ingredients } = menu;

/** Simulates what the server reports after reserving B x1 + C x2. */
const allocB = usageForItem(B, 1, groups);
const allocC = usageForItem(C, 2, groups);
const availableAfterCart = stockLeftAfter(initialStock, addAmounts(allocB, allocC));

describe('stock (Part B)', () => {
  it('TC-08: B x1 + C x2 leaves egg 0, cheese 0, croissant 1', () => {
    expect(availableAfterCart).toMatchObject({ egg: 0, cheese: 0, croissant: 1 });
  });

  it('TC-08: a new item needing eggs is blocked with the reason', () => {
    const shortages = shortagesFor({ selection: { toast: 1, fried: 2, sausage: 1 }, qty: 1, groups, available: availableAfterCart });
    expect(formatShortages(shortages, ingredients)).toBe('Short: 2 egg');
  });

  it('TC-08: egg options show 0 headroom (disabled) for a new item', () => {
    const headroom = headroomByOption({ selection: {}, qty: 1, groups, free: availableAfterCart });
    expect(headroom).toMatchObject({ fried: 0, scrambled: 0, omelette: 0, cheese: 0, croissant: 1, ketchup: null });
  });

  it('TC-09: edit B to Omelette x3 + Fried x1 -> "Short: 1 egg" (B\'s own 6 eggs count)', () => {
    const edited = { ...B, omelette: 3, fried: 1 };
    const shortages = shortagesFor({ selection: edited, qty: 1, groups, available: availableAfterCart, ownAllocation: allocB });
    expect(formatShortages(shortages, ingredients)).toBe('Short: 1 egg');
  });

  it('TC-10: edit B to Omelette x1 + Fried x3 -> allowed, 643.50, egg remaining 1', () => {
    const edited = { ...B, omelette: 1, fried: 3 };
    const free = freeStockFor(availableAfterCart, allocB);
    expect(shortagesFor({ selection: edited, qty: 1, groups, available: availableAfterCart, ownAllocation: allocB })).toEqual([]);
    expect(priceUnit(edited, menu, promotions).unitPrice).toBe(64_350);
    expect(stockLeftAfter(free, usageForItem(edited, 1, groups)).egg).toBe(1);
  });

  it('TC-11: change C quantity 2 -> 3 -> "Short: 2 egg, 2 cheese"', () => {
    const shortages = shortagesFor({ selection: C, qty: 3, groups, available: availableAfterCart, ownAllocation: allocC });
    expect(formatShortages(shortages, ingredients)).toBe('Short: 2 egg, 2 cheese');
  });

  it('never counts an allocation as free for an ingredient the server does not track', () => {
    const free = freeStockFor({ egg: 1 } as IngredientAmounts, { egg: 2, ketchup: 5 });
    expect(free).toEqual({ egg: 3 });
  });

  it('headroom accounts for item quantity', () => {
    // 10 eggs, item qty 3 with Fried x2 already => 6 used, 4 left => 1 more egg-unit per product unit
    const headroom = headroomByOption({ selection: { fried: 2 }, qty: 3, groups, free: initialStock });
    expect(headroom.fried).toBe(1);
    expect(headroom.omelette).toBe(0);
  });
});
