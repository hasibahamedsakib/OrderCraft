import { memo } from 'react';
import { cx, QuantitySelector } from '../../components/ui';
import { CheckIcon } from '../../components/ui/icons';
import type { OptionState } from '../../domain/availability';
import type { SelectionMode } from '../../domain/menu';
import { formatBDT } from '../../domain/money';
import type { MenuOption } from '../../domain/types';
import { StockIndicator } from './StockIndicator';
import s from './builder.module.css';

interface MenuOptionCardProps {
  option: MenuOption;
  groupId: string;
  mode: SelectionMode;
  state: OptionState;
  /** Part of a violation right now (e.g. excluded combination). */
  flagged: boolean;
  /** Single-choice groups that allow none can be cleared by clicking again. */
  allowDeselect: boolean;
  onSetQty: (optionId: string, qty: number) => void;
  onPickSingle: (optionId: string) => void;
}

function priceLabel(price: number): string {
  return price === 0 ? 'Included' : `+${formatBDT(price)}`;
}

export const MenuOptionCard = memo(function MenuOptionCard({
  option,
  groupId,
  mode,
  state,
  flagged,
  allowDeselect,
  onSetQty,
  onPickSingle,
}: MenuOptionCardProps) {
  const selected = state.qty > 0;
  const top = (
    <div className={s.optionTop}>
      <span className={s.optionName}>{option.name}</span>
      <span className={s.optionPrice}>{priceLabel(option.price)}</span>
    </div>
  );
  // Out of stock wins; otherwise explain a group limit; otherwise show stock headroom.
  const showReason = state.headroom !== 0 && state.blockedReason !== null && mode !== 'single';
  const footerNote = showReason ? <span className={s.stock}>{state.blockedReason}</span> : <StockIndicator headroom={state.headroom} />;

  if (mode === 'stepper') {
    const disabled = !selected && !state.canIncrement;
    return (
      <div className={cx(s.option, selected && s.optionSelected, flagged && s.optionFlagged, disabled && s.optionDisabled)}>
        {top}
        <div className={s.optionBottom}>
          {footerNote}
          <QuantitySelector
            size="sm"
            label={option.name}
            value={state.qty}
            onChange={(qty) => onSetQty(option.id, qty)}
            incrementDisabled={!state.canIncrement}
          />
        </div>
      </div>
    );
  }

  const isRadio = mode === 'single';
  const disabled = isRadio ? !state.canPick : !selected && !state.canIncrement;
  return (
    <label className={cx(s.option, selected && s.optionSelected, flagged && s.optionFlagged, disabled && s.optionDisabled)}>
      <input
        className={s.optionInput}
        type={isRadio ? 'radio' : 'checkbox'}
        name={isRadio ? `group-${groupId}` : undefined}
        checked={selected}
        disabled={disabled}
        onChange={() => {
          if (isRadio) onPickSingle(option.id);
          else onSetQty(option.id, selected ? 0 : 1);
        }}
        onClick={() => {
          // a checked radio fires no change event: clicking it again clears an optional group
          if (isRadio && selected && allowDeselect) onSetQty(option.id, 0);
        }}
      />
      {top}
      <div className={s.optionBottom}>
        {footerNote}
        <span className={cx(s.check, isRadio ? s.checkRadio : s.checkBox)} aria-hidden="true">
          {selected && <CheckIcon size={12} strokeWidth={3} />}
        </span>
      </div>
    </label>
  );
});
