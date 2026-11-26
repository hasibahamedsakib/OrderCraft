import { useCallback } from 'react';
import { Badge, cx } from '../../components/ui';
import type { MenuGroup as MenuGroupData } from '../../domain/types';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  selectGroupStates,
  selectOneMoreShortText,
  selectOptionStates,
  selectViolationsByGroup,
} from '../../store/selectors/builderSelectors';
import { optionQtySet, singleOptionPicked } from '../../store/slices/builderSlice';
import { MenuOptionCard } from './MenuOptionCard';
import { ValidationMessage } from './ValidationMessage';
import s from './builder.module.css';

const NO_VIOLATIONS: never[] = [];

export function MenuGroup({ group }: { group: MenuGroupData }) {
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectGroupStates)[group.id];
  const optionStates = useAppSelector(selectOptionStates);
  const shortTexts = useAppSelector(selectOneMoreShortText);
  const violations = useAppSelector(selectViolationsByGroup).get(group.id) ?? NO_VIOLATIONS;
  const flaggedIds = new Set(violations.flatMap((v) => (v.code === 'excludes' || v.code === 'group_max_per_option' ? v.optionIds ?? [] : [])));

  const onSetQty = useCallback((optionId: string, qty: number) => dispatch(optionQtySet({ optionId, qty })), [dispatch]);
  const groupOptionIds = group.options.map((o) => o.id).join('|');
  const onPickSingle = useCallback(
    (optionId: string) => dispatch(singleOptionPicked({ optionId, groupOptionIds: groupOptionIds.split('|') })),
    [dispatch, groupOptionIds],
  );

  if (!state) return null;
  const headingId = `group-${group.id}-title`;
  const messagesId = `group-${group.id}-messages`;
  const satisfied = violations.length === 0 && state.units >= group.min;

  return (
    <section
      className={cx(s.group, violations.length > 0 && s.groupInvalid)}
      aria-labelledby={headingId}
      aria-describedby={violations.length > 0 ? messagesId : undefined}
    >
      <header className={s.groupHeader}>
        <h3 className={s.groupTitle} id={headingId}>
          {group.name}
        </h3>
        <span className={s.groupHint}>
          {group.min === 0 ? 'Optional · ' : ''}
          {capitalize(state.limitText)}
        </span>
        <div className={s.groupCounter}>
          {state.overriddenBy && (
            <Badge tone="info" title="A rule changed this group's limit">
              Max {state.max} with {state.overriddenBy.optionName}
            </Badge>
          )}
          <Badge tone={violations.length > 0 ? 'danger' : satisfied && state.units > 0 ? 'success' : 'neutral'}>
            {state.units}
            {state.max !== null ? ` / ${state.max}` : ''} selected
          </Badge>
        </div>
      </header>
      <div className={s.groupBody}>
        <div className={s.options} role={state.mode === 'single' ? 'radiogroup' : undefined} aria-labelledby={headingId}>
          {group.options.map((option) => {
            const optionState = optionStates[option.id];
            if (!optionState) return null;
            return (
              <MenuOptionCard
                key={option.id}
                option={option}
                groupId={group.id}
                mode={state.mode}
                state={optionState}
                shortText={optionState.headroom === 0 ? shortTexts[option.id] : undefined}
                flagged={flaggedIds.has(option.id) && optionState.qty > 0}
                allowDeselect={group.min === 0}
                onSetQty={onSetQty}
                onPickSingle={onPickSingle}
              />
            );
          })}
        </div>
        <div aria-live="polite">
          <ValidationMessage violations={violations} id={messagesId} />
        </div>
      </div>
    </section>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

