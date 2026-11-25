import { describeLimits, groupUnits, indexOptions, qtyOf } from './menu';
import type { GroupId, MenuGroup, OptionId, OverrideLimitRule, Rule, Selection } from './types';

export type ViolationCode =
  | 'unknown_option'
  | 'invalid_quantity'
  | 'group_min'
  | 'group_max'
  | 'group_step'
  | 'group_max_distinct'
  | 'group_max_per_option'
  | 'override_max'
  | 'requires'
  | 'excludes';

export interface Violation {
  code: ViolationCode;
  message: string;
  /** Group the message belongs next to in the UI. */
  groupId?: GroupId;
  ruleId?: string;
  optionIds?: OptionId[];
}

/**
 * The max that applies to a group right now. An overrideLimit rule whose option is
 * selected replaces the base max (it wins even if it is larger). If several overrides
 * are active, the strictest one wins.
 */
export function effectiveMax(
  group: MenuGroup,
  selection: Selection,
  rules: Rule[],
): { max: number | null; rule: OverrideLimitRule | null } {
  let winner: OverrideLimitRule | null = null;
  for (const rule of rules) {
    if (rule.type !== 'overrideLimit' || rule.group !== group.id) continue;
    if (qtyOf(selection, rule.option) === 0) continue;
    if (!winner || rule.max < winner.max) winner = rule;
  }
  return winner ? { max: winner.max, rule: winner } : { max: group.max, rule: null };
}

/**
 * Pure, generic validation. Returns every violation, never just the first.
 * Knows nothing about breakfasts: groups and rules are data.
 */
export function validate(config: Selection, groups: MenuGroup[], rules: Rule[]): Violation[] {
  const index = indexOptions(groups);
  const nameOf = (id: OptionId): string => index.get(id)?.option.name ?? id;
  const groupOf = (id: OptionId): GroupId | undefined => index.get(id)?.group.id;
  const selected = (id: OptionId): boolean => qtyOf(config, id) > 0;
  const violations: Violation[] = [];

  for (const [optionId, qty] of Object.entries(config)) {
    if (!Number.isInteger(qty) || qty < 0) {
      violations.push({
        code: 'invalid_quantity',
        message: `${nameOf(optionId)} has an invalid quantity (${qty}).`,
        groupId: groupOf(optionId),
        optionIds: [optionId],
      });
    } else if (qty > 0 && !index.has(optionId)) {
      violations.push({
        code: 'unknown_option',
        message: `"${optionId}" is not on the menu any more.`,
        optionIds: [optionId],
      });
    }
  }

  for (const group of groups) {
    const total = groupUnits(config, group);
    const { max, rule: override } = effectiveMax(group, config, rules);
    const limits = describeLimits(group, max);

    if (total < group.min) {
      violations.push({
        code: 'group_min',
        message: `${group.name} total must be ${limits} (currently ${total}).`,
        groupId: group.id,
      });
    }

    if (max !== null && total > max) {
      violations.push(
        override
          ? {
              code: 'override_max',
              message: `${group.name} max is ${max} when ${nameOf(override.option)} is selected (currently ${total}).`,
              groupId: group.id,
              ruleId: override.id,
              optionIds: [override.option],
            }
          : {
              code: 'group_max',
              message: `${group.name} total must be ${limits} (currently ${total}).`,
              groupId: group.id,
            },
      );
    }

    if (group.step && group.step > 1 && total % group.step !== 0) {
      violations.push({
        code: 'group_step',
        message: `${group.name} total must be ${limits} (currently ${total}).`,
        groupId: group.id,
      });
    }

    const chosen = group.options.filter((o) => selected(o.id));
    if (group.maxDistinct !== undefined && chosen.length > group.maxDistinct) {
      violations.push({
        code: 'group_max_distinct',
        message: `${group.name}: choose at most ${group.maxDistinct} different options (currently ${chosen.length}).`,
        groupId: group.id,
        optionIds: chosen.map((o) => o.id),
      });
    }

    if (group.maxPerOption !== undefined) {
      for (const option of chosen) {
        const qty = qtyOf(config, option.id);
        if (qty > group.maxPerOption) {
          violations.push({
            code: 'group_max_per_option',
            message: `${option.name}: at most ${group.maxPerOption} allowed (currently ${qty}).`,
            groupId: group.id,
            optionIds: [option.id],
          });
        }
      }
    }
  }

  for (const rule of rules) {
    if (rule.type === 'requires' && selected(rule.option) && !rule.anyOf.some(selected)) {
      violations.push({
        code: 'requires',
        message: `${nameOf(rule.option)} requires ${joinOr(rule.anyOf.map(nameOf))}.`,
        groupId: groupOf(rule.option),
        ruleId: rule.id,
        optionIds: [rule.option, ...rule.anyOf],
      });
    }
    if (rule.type === 'excludes' && selected(rule.option)) {
      const conflicts = rule.options.filter(selected);
      if (conflicts.length > 0) {
        violations.push({
          code: 'excludes',
          message: `${nameOf(rule.option)} cannot be combined with ${joinAnd(conflicts.map(nameOf))}.`,
          groupId: groupOf(rule.option),
          ruleId: rule.id,
          optionIds: [rule.option, ...conflicts],
        });
      }
    }
  }

  return violations;
}

function joinOr(names: string[]): string {
  return joinWith(names, 'or');
}

function joinAnd(names: string[]): string {
  return joinWith(names, 'and');
}

function joinWith(names: string[], word: string): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}
