import type { GroupId, MenuGroup, MenuOption, OptionId, Selection } from './types';

export interface IndexedOption {
  option: MenuOption;
  group: MenuGroup;
}

export function indexOptions(groups: MenuGroup[]): Map<OptionId, IndexedOption> {
  const index = new Map<OptionId, IndexedOption>();
  for (const group of groups) {
    for (const option of group.options) index.set(option.id, { option, group });
  }
  return index;
}

export function qtyOf(selection: Selection, optionId: OptionId): number {
  const qty = selection[optionId];
  return typeof qty === 'number' && qty > 0 ? qty : 0;
}

/** Total units chosen in a group (Omelette x2 = 2 units). */
export function groupUnits(selection: Selection, group: MenuGroup): number {
  return group.options.reduce((sum, option) => sum + qtyOf(selection, option.id), 0);
}

export function groupUnitsById(selection: Selection, groups: MenuGroup[], groupId: GroupId): number {
  const group = groups.find((g) => g.id === groupId);
  return group ? groupUnits(selection, group) : 0;
}

/** Drop zero quantities so equal selections compare equal. */
export function normalizeSelection(selection: Selection): Selection {
  const out: Selection = {};
  for (const [id, qty] of Object.entries(selection)) if (qty > 0) out[id] = qty;
  return out;
}

/**
 * How the UI should let the user pick within a group, derived from its limits:
 * single  - exactly one option (radio-like)
 * toggle  - each option on/off (maxPerOption 1)
 * stepper - counted quantities
 */
export type SelectionMode = 'single' | 'toggle' | 'stepper';

export function selectionModeFor(group: MenuGroup): SelectionMode {
  if (group.max === 1) return 'single';
  if (group.maxPerOption === 1) return 'toggle';
  return 'stepper';
}

/** Human summary of a selection in menu order, e.g. "Toast · Scrambled ×2 · Ketchup". */
export function describeSelection(selection: Selection, groups: MenuGroup[]): string[] {
  const parts: string[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      const qty = qtyOf(selection, option.id);
      if (qty > 0) parts.push(qty > 1 ? `${option.name} ×${qty}` : option.name);
    }
  }
  return parts;
}

/** Plain-language summary of a group's limits, used for hints and messages. */
export function describeLimits(group: MenuGroup, effectiveMax: number | null): string {
  const parts: string[] = [];
  if (effectiveMax !== null && group.min === effectiveMax) parts.push(`exactly ${group.min}`);
  else if (effectiveMax === null) parts.push(group.min > 0 ? `at least ${group.min}` : 'any amount');
  else if (group.min === 0) parts.push(`up to ${effectiveMax}`);
  else parts.push(`${group.min}-${effectiveMax}`);
  if (group.step && group.step > 1) parts[0] = `${parts[0]} in steps of ${group.step}`;
  if (group.maxDistinct !== undefined) parts.push(`max ${group.maxDistinct} different`);
  if (group.maxPerOption !== undefined) parts.push(`max ${group.maxPerOption} each`);
  return parts.join(', ');
}
