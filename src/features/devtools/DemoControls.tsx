import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../components/ui';
import { toZonedIso, zonedDate } from '../../domain/time';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectShopTimeZone } from '../../store/selectors/menuSelectors';
import { fetchCart, fetchOrders } from '../../store/thunks';
import { estimateServerNow } from '../../app/serverTime';
import s from './devtools.module.css';

/**
 * Reviewer tools for the mock server: move the server clock (coupon hours, expiry),
 * force the next reservation to fail, or reset all demo data. Not part of the product.
 */
export function DemoControls() {
  const dispatch = useAppDispatch();
  const offset = useAppSelector((state) => state.clock.offsetMs);
  const timeZone = useAppSelector(selectShopTimeZone);
  const [failNext, setFailNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.getDev().then((res) => setFailNext(res.data.failNextReserve), () => undefined);
  }, []);

  const refresh = async () => {
    await Promise.all([dispatch(fetchCart()), dispatch(fetchOrders())]);
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      setMessage(label);
    } catch {
      setMessage('That did not work, please retry.');
    } finally {
      setBusy(false);
    }
  };

  /** Shift the dev offset so the server clock reads `hhmmss` today (shop time zone). */
  const setServerClock = (hhmmss: string) =>
    run(`Server clock set to ${hhmmss}`, async () => {
      const { data } = await api.getDev();
      const current = estimateServerNow(offset);
      const zoneSuffix = toZonedIso(Math.floor(current / 1000) * 1000, timeZone).slice(-6);
      const target = Date.parse(`${zonedDate(current, timeZone)}T${hhmmss}${zoneSuffix}`);
      await api.setDev({ clockOffsetMs: data.clockOffsetMs + (target - current) });
    });

  const shiftClock = (ms: number, label: string) =>
    run(label, async () => {
      const { data } = await api.getDev();
      await api.setDev({ clockOffsetMs: data.clockOffsetMs + ms });
    });

  return (
    <details className={s.panel}>
      <summary>Demo controls (mock server)</summary>
      <div className={s.body}>
        <div className={s.group}>
          <span className={s.label}>Server clock</span>
          <Button size="sm" disabled={busy} onClick={() => setServerClock('10:59:30')}>
            Set 10:59:30
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setServerClock('11:00:00')}>
            Set 11:00:00
          </Button>
          <Button size="sm" disabled={busy} onClick={() => shiftClock(4 * 60_000 + 50_000, 'Server clock moved +4:50')}>
            +4:50
          </Button>
          <Button size="sm" disabled={busy} onClick={() => run('Server clock reset (+90 s skew only)', () => api.setDev({ clockOffsetMs: 0 }))}>
            Reset clock
          </Button>
        </div>
        <div className={s.group}>
          <span className={s.label}>Failures</span>
          <label className={s.toggle}>
            <input
              type="checkbox"
              checked={failNext}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.checked;
                setFailNext(next);
                void run(next ? 'Next reservation will fail' : 'Reservations back to normal', () => api.setDev({ failNextReserve: next }));
              }}
            />
            Fail the next reservation half-way
          </label>
        </div>
        <div className={s.group}>
          <span className={s.label}>Data</span>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              void run('Demo data reset to the seed', () => api.resetDemo());
            }}
            onBlur={() => setConfirmReset(false)}
          >
            {confirmReset ? 'Click again to wipe cart, stock and new orders' : 'Reset demo data'}
          </Button>
        </div>
        {message && (
          <p className={s.message} role="status">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
