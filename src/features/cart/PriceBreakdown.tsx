import { cx } from '../../components/ui';
import { formatBDT } from '../../domain/money';
import type { CartPricing } from '../../domain/pricing';
import s from './cart.module.css';

/** Subtotal, the one discount that applied, VAT, payable - straight from the server's priceCart. */
export function PriceBreakdown({ pricing }: { pricing: CartPricing }) {
  const vatPercent = pricing.vatBps / 100;
  const rounded = pricing.payable !== pricing.payableExact;
  return (
    <dl className={s.totals} aria-label="Price breakdown">
      <dt>Subtotal</dt>
      <dd>{formatBDT(pricing.subtotal)}</dd>

      {pricing.discount ? (
        <>
          <dt className={s.discount}>Discount · {pricing.discount.label}</dt>
          <dd className={s.discount}>−{formatBDT(pricing.discount.amount)}</dd>
        </>
      ) : (
        <>
          <dt className={s.muted}>Discount</dt>
          <dd className={s.muted}>None</dd>
        </>
      )}

      <dt>VAT ({vatPercent}%)</dt>
      <dd>{formatBDT(pricing.vat)}</dd>

      <dt className={s.payableLabel}>Payable</dt>
      <dd className={cx(s.payableValue)} data-testid="cart-payable">
        {formatBDT(pricing.payable)}
      </dd>
      {rounded && <span className={s.rounding}>{formatBDT(pricing.payableExact)} rounded to whole taka</span>}
    </dl>
  );
}
