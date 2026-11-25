import { Button, Skeleton } from '../../components/ui';
import { RefreshIcon } from '../../components/ui/icons';
import { formatBDT } from '../../domain/money';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectBuilderQty, selectPreview, selectSelection } from '../../store/selectors/builderSelectors';
import { previewRetried } from '../../store/slices/builderSlice';
import { previewKey } from '../../store/thunks';
import s from './builder.module.css';

/** The preview only counts if it was computed for exactly the configuration on screen. */
function useCurrentPreview() {
  const preview = useAppSelector(selectPreview);
  const selection = useAppSelector(selectSelection);
  const qty = useAppSelector(selectBuilderQty);
  const isCurrent = preview.key === previewKey(selection, qty);
  return { preview, pricing: isCurrent ? preview.pricing : null, isCurrent };
}

/** Compact total in the action bar: loading, error + retry, or the server's price. */
export function PriceSummary() {
  const dispatch = useAppDispatch();
  const { preview, pricing } = useCurrentPreview();
  const line = pricing?.lines[0];

  if (preview.status === 'failed') {
    return (
      <div className={s.barField} role="alert">
        <span className={s.barLabel}>Price unavailable</span>
        <Button size="sm" variant="secondary" icon={<RefreshIcon size={14} />} onClick={() => dispatch(previewRetried())}>
          Retry price
        </Button>
      </div>
    );
  }
  if (!line) {
    return (
      <div className={s.barField} aria-live="polite" aria-busy="true">
        <span className={s.barLabel}>Updating price…</span>
        <div className={s.priceStale}>
          <Skeleton width={120} height={22} />
          <Skeleton width={90} height={12} />
        </div>
      </div>
    );
  }
  return (
    <div className={s.barField} aria-live="polite">
      <span className={s.barLabel}>Item total</span>
      <span className={s.barTotal} data-testid="preview-total">
        {formatBDT(line.lineTotal)}
      </span>
      <span className={s.barSub}>
        {formatBDT(line.unit.unitPrice)} × {line.qty}
        {line.unit.promotions.length > 0 && ` · ${line.unit.promotions.map((p) => p.label).join(', ')} applied`}
      </span>
    </div>
  );
}

/** Full per-unit breakdown, from the server preview. */
export function PriceBreakdownDetails() {
  const { pricing } = useCurrentPreview();
  const line = pricing?.lines[0];
  if (!line) return <Skeleton height={60} />;
  return (
    <dl className={s.rows}>
      <dt>Base price</dt>
      <dd>{formatBDT(line.unit.base)}</dd>
      <dt>Options</dt>
      <dd>{formatBDT(line.unit.optionsTotal)}</dd>
      {line.unit.promotions.map((promo) => (
        <PromoRow key={promo.id} label={promo.label} amount={promo.amount} />
      ))}
      <dt>Unit price</dt>
      <dd>{formatBDT(line.unit.unitPrice)}</dd>
      <dt>Quantity</dt>
      <dd>× {line.qty}</dd>
      <dt className={s.rowStrong}>Item total</dt>
      <dd className={s.rowStrong}>{formatBDT(line.lineTotal)}</dd>
    </dl>
  );
}

function PromoRow({ label, amount }: { label: string; amount: number }) {
  return (
    <>
      <dt className={s.rowDiscount}>{label}</dt>
      <dd className={s.rowDiscount}>−{formatBDT(amount)}</dd>
    </>
  );
}
