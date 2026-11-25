import { cx } from '../../components/ui';
import s from './builder.module.css';

/** "How many more can be added right now", from shared stock. null = unlimited. */
export function StockIndicator({ headroom }: { headroom: number | null }) {
  if (headroom === null) {
    return (
      <span className={cx(s.stock, s.stockUnlimited)}>
        <span className={s.stockDot} aria-hidden="true" />
        No stock limit
      </span>
    );
  }
  if (headroom === 0) {
    return (
      <span className={cx(s.stock, s.stockOut)}>
        <span className={s.stockDot} aria-hidden="true" />
        Out of stock
      </span>
    );
  }
  return (
    <span className={cx(s.stock, headroom <= 2 && s.stockLow)}>
      <span className={s.stockDot} aria-hidden="true" />
      {headroom <= 2 ? `Only ${headroom} more` : `${headroom} more available`}
    </span>
  );
}
