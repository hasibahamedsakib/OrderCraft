import { useState } from 'react';
import type { CartItemDTO } from '../../api/contracts';
import { Badge, Button, cx, QuantitySelector } from '../../components/ui';
import { AlertIcon, EditIcon, TrashIcon } from '../../components/ui/icons';
import { describeSelection } from '../../domain/menu';
import { formatBDT } from '../../domain/money';
import { formatShortages } from '../../domain/stock';
import { useAppDispatch, useAppSelector, useAppStore } from '../../store/hooks';
import { selectQtyChangeShortage } from '../../store/selectors/cartSelectors';
import { selectGroups, selectIngredients, selectProduct } from '../../store/selectors/menuSelectors';
import { editStarted } from '../../store/slices/builderSlice';
import { itemErrorDismissed } from '../../store/slices/cartSlice';
import { changeItemQty, removeCartItem } from '../../store/thunks';
import { ReservationTimer } from './ReservationTimer';
import s from './cart.module.css';

export function CartItem({ item, index }: { item: CartItemDTO; index: number }) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const groups = useAppSelector(selectGroups);
  const product = useAppSelector(selectProduct);
  const ingredients = useAppSelector(selectIngredients);
  const op = useAppSelector((state) => state.cart.itemOps[item.id]);
  const editing = useAppSelector((state) => state.builder.editingItemId === item.id);
  const [localShortage, setLocalShortage] = useState('');

  const expired = item.status === 'expired';
  const pending = op?.status === 'pending';
  const serverError = op?.status === 'failed' ? op.error : null;
  const parts = describeSelection(item.selection, groups);

  const changeQty = (qty: number) => {
    dispatch(itemErrorDismissed(item.id));
    // Check stock first (own allocation counts as available), so the user sees exactly what is short.
    const shortage = qty > item.qty ? selectQtyChangeShortage(store.getState(), item.id, qty) : '';
    setLocalShortage(shortage);
    if (!shortage) void dispatch(changeItemQty({ itemId: item.id, qty }));
  };

  const errorText =
    localShortage ||
    (serverError
      ? serverError.shortages?.length
        ? `${serverError.message} ${formatShortages(serverError.shortages, ingredients)}`
        : serverError.message
      : '');

  return (
    <li className={cx(s.item, editing && s.itemEditing, expired && s.itemExpired)} aria-label={`Cart item ${index + 1}`}>
      <div className={s.itemTop}>
        <div>
          <div className={s.itemTitle}>
            {product?.name ?? 'Item'} {item.qty > 1 && <span>× {item.qty}</span>}{' '}
            {editing && <Badge tone="info">Editing</Badge>}
            {expired && <Badge tone="danger">Expired</Badge>}
          </div>
          <div className={s.chips}>
            {parts.map((part) => (
              <span key={part} className={s.chip}>
                {part}
              </span>
            ))}
          </div>
        </div>
        <div className={s.itemPrice}>
          <div className={s.itemTotal}>{formatBDT(item.lineTotal)}</div>
          {item.qty > 1 && <div className={s.itemUnit}>{formatBDT(item.unitPrice)} each</div>}
        </div>
      </div>

      <ReservationTimer reservedAt={item.reservedAt} expiresAt={item.expiresAt} expired={expired} />

      <div className={s.itemControls}>
        {!expired && product && (
          <QuantitySelector
            size="sm"
            label="Quantity"
            value={item.qty}
            min={product.minQty}
            max={product.maxQty}
            onChange={changeQty}
            disabled={pending || editing}
          />
        )}
        <div className={s.itemActions}>
          {!expired && (
            <Button
              size="sm"
              variant="ghost"
              icon={<EditIcon size={14} />}
              onClick={() => dispatch(editStarted(item))}
              disabled={pending || editing}
              aria-label={`Edit cart item ${index + 1}`}
            >
              Edit
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            icon={<TrashIcon size={14} />}
            onClick={() => dispatch(removeCartItem({ itemId: item.id }))}
            loading={pending}
            aria-label={`Remove cart item ${index + 1}`}
          >
            Remove
          </Button>
        </div>
      </div>

      {errorText && (
        <div className={s.itemError} role="alert">
          <AlertIcon size={14} />
          <span>{errorText}</span>
        </div>
      )}
    </li>
  );
}
