import type { Selection } from '../domain/types';

/** Configurations named in Section 9 of the brief. Test data only. */
export const A: Selection = { toast: 1, scrambled: 2, sausage: 1, ketchup: 1 };
export const B: Selection = {
  croissant: 1,
  omelette: 2,
  fried: 2,
  sausage: 1,
  bacon: 1,
  hashbrown: 1,
  mushroom: 1,
  hollandaise: 1,
};
export const C: Selection = {
  paratha: 1,
  fried: 2,
  tofu: 1,
  cheese: 2,
  beans: 1,
  mushroom: 1,
  chili: 1,
};

/** Dhaka is UTC+6 with no DST. */
export const dhaka = (hhmmss: string, date = '2026-11-25') => `${date}T${hhmmss}+06:00`;
