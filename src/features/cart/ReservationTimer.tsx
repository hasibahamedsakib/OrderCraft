import { useServerNow } from '../../app/hooks';
import { formatCountdown } from '../../app/serverTime';
import { cx } from '../../components/ui';
import { ClockIcon } from '../../components/ui/icons';
import s from './cart.module.css';

const WARN_MS = 60_000;

/** Countdown on the SERVER clock (browser time + measured offset), never Date.now() alone. */
export function ReservationTimer({ reservedAt, expiresAt, expired }: { reservedAt: string; expiresAt: string; expired: boolean }) {
  const now = useServerNow(1000);
  const end = Date.parse(expiresAt);
  const total = Math.max(1, end - Date.parse(reservedAt));
  const left = Math.max(0, end - now);

  if (expired || left === 0) {
    return (
      <div className={cx(s.timer, s.timerExpired)} role="status">
        <ClockIcon size={13} />
        Reservation expired, stock released. Remove it, or add it again.
      </div>
    );
  }
  const minutes = Math.floor(Math.ceil(left / 1000) / 60);
  const seconds = Math.ceil(left / 1000) % 60;
  return (
    <div
      className={cx(s.timer, left <= WARN_MS && s.timerWarn)}
      aria-label={`Stock held for ${minutes} minutes ${seconds} seconds`}
      title="Ingredients are held for you until the timer ends (server time)."
    >
      <ClockIcon size={13} />
      <span>Held</span>
      <span className={s.timerTrack} aria-hidden="true">
        <span className={s.timerFill} style={{ width: `${(left / total) * 100}%`, display: 'block' }} />
      </span>
      <time aria-hidden="true">{formatCountdown(left)}</time>
    </div>
  );
}
