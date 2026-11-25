import { Badge, Card, cx } from '../../components/ui';
import { BoxIcon, ChevronIcon } from '../../components/ui/icons';
import { useAppSelector } from '../../store/hooks';
import { selectStock } from '../../store/selectors/cartSelectors';
import { selectIngredients } from '../../store/selectors/menuSelectors';
import s from './cart.module.css';

/** Shared ingredient stock as the server reports it (all tabs, all carts). */
export function InventoryPanel() {
  const stock = useAppSelector(selectStock);
  const ingredients = useAppSelector(selectIngredients);
  const tracked = ingredients.filter((ing) => stock[ing.id]);
  if (tracked.length === 0) return null;
  const out = tracked.filter((ing) => stock[ing.id]!.available <= 0).length;

  return (
    <Card as="aside">
      <details className={s.details}>
        <summary>
          <BoxIcon />
          Kitchen stock
          <span className={s.summaryEnd}>
            {out > 0 ? <Badge tone="danger">{out} out</Badge> : <Badge tone="success">All in stock</Badge>}
            <ChevronIcon />
          </span>
        </summary>
        <div className={s.detailsBody}>
          <div className={s.legend}>
            <span>
              <span className={s.legendDot} style={{ background: 'var(--accent)' }} />
              Available
            </span>
            <span>
              <span className={s.legendDot} style={{ background: '#93c5fd' }} />
              Reserved in carts
            </span>
          </div>
          <ul className={s.stockList}>
            {tracked.map((ing) => {
              const st = stock[ing.id]!;
              const total = Math.max(1, st.onHand);
              return (
                <li key={ing.id} className={cx(s.stockItem, st.available <= 0 && s.stockZero)}>
                  <div className={s.stockHead}>
                    <span className={s.stockName}>{ing.name}</span>
                    <span className={s.stockValue}>
                      {st.available}/{st.onHand}
                    </span>
                  </div>
                  <div
                    className={s.stockTrack}
                    role="meter"
                    aria-label={`${ing.name}: ${st.available} available of ${st.onHand}`}
                    aria-valuemin={0}
                    aria-valuemax={st.onHand}
                    aria-valuenow={st.available}
                  >
                    <span className={s.stockAvail} style={{ width: `${(st.available / total) * 100}%` }} />
                    <span className={s.stockReserved} style={{ width: `${(st.reserved / total) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </Card>
  );
}
