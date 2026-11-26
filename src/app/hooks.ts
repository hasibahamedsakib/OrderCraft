import { useEffect, useState, useSyncExternalStore } from 'react';
import { SERVER_STORAGE_KEY } from '../mocks/storage';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectActiveItems, selectClockOffset } from '../store/selectors/cartSelectors';
import { fetchCart, fetchMenu, fetchOrders } from '../store/thunks';
import { msUntilClock } from '../domain/time';
import { estimateServerNow, msUntil } from './serverTime';

export type View = 'order' | 'orders' | 'assistant';
const VIEWS: View[] = ['order', 'orders', 'assistant'];

function readView(): View {
  const id = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS as string[]).includes(id) ? (id as View) : 'order';
}

function subscribeHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/** Current view from the URL hash, so a refresh keeps the user on the same screen. */
export function useHashView(): View {
  return useSyncExternalStore(subscribeHash, readView, () => 'order');
}

/** Server-clock "now", re-rendering every `intervalMs`. Use only in small leaf components. */
export function useServerNow(intervalMs = 1000): number {
  const offset = useAppSelector(selectClockOffset);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return estimateServerNow(offset);
}

const POLL_MS = 15_000;
const EXPIRY_GRACE_MS = 250;

/**
 * Keeps the server mirrors fresh:
 *  - initial load of menu, cart and orders
 *  - poll the cart while the tab is visible
 *  - another tab wrote to the shared server storage -> reload cart and orders
 *  - a reservation is about to expire (server clock) -> reload the cart right after
 */
export function useServerSync(): void {
  const dispatch = useAppDispatch();
  const active = useAppSelector(selectActiveItems);
  const offset = useAppSelector(selectClockOffset);

  useEffect(() => {
    void dispatch(fetchMenu());
    void dispatch(fetchCart());
    void dispatch(fetchOrders());
  }, [dispatch]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void dispatch(fetchCart());
    }, POLL_MS);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SERVER_STORAGE_KEY) return;
      void dispatch(fetchCart());
      void dispatch(fetchOrders());
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void dispatch(fetchCart());
    };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dispatch]);

  useEffect(() => {
    if (active.length === 0) return;
    const next = Math.min(...active.map((item) => msUntil(item.expiresAt, offset)));
    const id = window.setTimeout(() => void dispatch(fetchCart()), Math.max(0, next) + EXPIRY_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [active, offset, dispatch]);

  // An applied time-limited coupon (MORNING15 before 11:00) stops at a known server-clock moment:
  // re-price the cart right then, so the summary never shows a discount the server would refuse.
  const appliedCouponId = useAppSelector((state) =>
    state.cart.pricing?.coupon?.status === 'applied' ? state.cart.pricing.discount?.id ?? null : null,
  );
  const coupon = useAppSelector((state) =>
    state.menu.data?.promotions.cartDiscounts.find((d) => d.id === appliedCouponId && d.type === 'couponPercentOff'),
  );
  useEffect(() => {
    if (!coupon || coupon.type !== 'couponPercentOff') return;
    const wait = msUntilClock(estimateServerNow(offset), coupon.validBefore, coupon.timeZone);
    if (wait > 2 ** 31 - 1) return; // beyond setTimeout's range; the poll covers it
    const id = window.setTimeout(() => void dispatch(fetchCart()), wait + EXPIRY_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [coupon, offset, dispatch]);
}
