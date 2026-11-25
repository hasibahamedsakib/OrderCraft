import { describeLimits, groupUnits, indexOptions, qtyOf, selectionModeFor, type SelectionMode } from './menu';
import type { MenuGroup, Rule, Selection } from './types';
import { effectiveMax } from './validate';

/** What a group allows right now (after overrides), for hints and counters. */
export interface GroupState {
  groupId: string;
  mode: SelectionMode;
  units: number;
  max: number | null;
  /** Set when an overrideLimit rule replaced the base max. */
  overriddenBy: { ruleId: string; optionId: string; optionName: string } | null;
  limitText: string;
  distinct: number;
}

/** Whether the user can add one more unit of an option, and if not, why. */
export interface OptionState {
  qty: number;
  /** More units the shared stock allows right now (null = unlimited). */
  headroom: number | null;
  canIncrement: boolean;
  /** For single-choice groups: can this option be picked (replacing the current one)? */
  canPick: boolean;
  blockedReason: string | null;
}

export function groupStates(selection: Selection, groups: MenuGroup[], rules: Rule[]): Record<string, GroupState> {
  const index = indexOptions(groups);
  const out: Record<string, GroupState> = {};
  for (const group of groups) {
    const { max, rule } = effectiveMax(group, selection, rules);
    out[group.id] = {
      groupId: group.id,
      mode: selectionModeFor(group),
      units: groupUnits(selection, group),
      max,
      overriddenBy: rule
        ? { ruleId: rule.id, optionId: rule.option, optionName: index.get(rule.option)?.option.name ?? rule.option }
        : null,
      limitText: describeLimits(group, max),
      distinct: group.options.filter((o) => qtyOf(selection, o.id) > 0).length,
    };
  }
  return out;
}

export function optionStates(
  selection: Selection,
  groups: MenuGroup[],
  states: Record<string, GroupState>,
  headroom: Record<string, number | null>,
): Record<string, OptionState> {
  const out: Record<string, OptionState> = {};
  for (const group of groups) {
    const gs = states[group.id];
    if (!gs) continue;
    for (const option of group.options) {
      const qty = qtyOf(selection, option.id);
      const room = headroom[option.id] ?? null;
      const outOfStock = room === 0;
      const atGroupMax = gs.max !== null && gs.units >= gs.max;
      const atPerOption = group.maxPerOption !== undefined && qty >= group.maxPerOption;
      const atDistinct = group.maxDistinct !== undefined && qty === 0 && gs.distinct >= group.maxDistinct;

      let blockedReason: string | null = null;
      if (outOfStock) blockedReason = qty > 0 ? 'No more in stock' : 'Out of stock';
      else if (atDistinct) blockedReason = `Max ${group.maxDistinct} different`;
      else if (atGroupMax && gs.mode !== 'single') blockedReason = `${group.name} is full`;
      else if (atPerOption && gs.mode === 'stepper') blockedReason = `Max ${group.maxPerOption} each`;

      out[option.id] = {
        qty,
        headroom: room,
        canIncrement: !outOfStock && !atGroupMax && !atPerOption && !atDistinct,
        canPick: qty > 0 || !outOfStock,
        blockedReason,
      };
    }
  }
  return out;
}
