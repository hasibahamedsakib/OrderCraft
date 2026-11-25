import type { ReactNode } from 'react';
import { CartIcon, ClockIcon, ReceiptIcon, SparkleIcon } from '../components/ui/icons';
import { zonedParts } from '../domain/time';
import { useAppSelector } from '../store/hooks';
import { selectActiveItems } from '../store/selectors/cartSelectors';
import { selectShopTimeZone } from '../store/selectors/menuSelectors';
import { useServerNow, type View } from './hooks';
import s from './layout.module.css';

const NAV: { view: View; label: string; icon: ReactNode }[] = [
  { view: 'order', label: 'New order', icon: <CartIcon /> },
  { view: 'orders', label: 'Orders', icon: <ReceiptIcon /> },
  { view: 'assistant', label: 'Assistant', icon: <SparkleIcon /> },
];

function ServerClock() {
  const now = useServerNow(1000);
  const timeZone = useAppSelector(selectShopTimeZone);
  const synced = useAppSelector((state) => state.clock.synced);
  if (!synced) return null;
  const p = zonedParts(now, timeZone);
  const time = [p.hour, p.minute, p.second].map((n) => String(n).padStart(2, '0')).join(':');
  return (
    <span className={s.clock} title={`Server time (${timeZone}). Countdowns and coupon hours use this clock.`}>
      <ClockIcon size={13} />
      <span className={s.clockLabel}>Server</span>
      <time>{time}</time>
    </span>
  );
}

export function AppHeader({ view }: { view: View }) {
  const cartCount = useAppSelector(selectActiveItems).length;
  return (
    <header className={s.header}>
      <div className={s.headerInner}>
        <a className={s.brand} href="#/order" aria-label="OrderCraft home">
          <span className={s.logo} aria-hidden="true">
            O
          </span>
          <span className={s.brandText}>OrderCraft</span>
        </a>
        <nav className={s.nav} aria-label="Main">
          {NAV.map((item) => (
            <a key={item.view} className={s.navLink} href={`#/${item.view}`} aria-current={view === item.view ? 'page' : undefined}>
              <span className={s.navIcon}>{item.icon}</span>
              {item.label}
              {item.view === 'order' && cartCount > 0 && (
                <span className={s.navCount} aria-label={`${cartCount} items in cart`}>
                  {cartCount}
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className={s.headerEnd}>
          <ServerClock />
        </div>
      </div>
    </header>
  );
}

export function AppLayout({ view, children, footer }: { view: View; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={s.shell}>
      <AppHeader view={view} />
      <main className={s.main} id="main">
        {children}
      </main>
      <footer className={s.footer}>
        <div className={s.footerInner}>{footer}</div>
      </footer>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.pageHeader}>
      <div>
        <h1 className={s.pageTitle}>{title}</h1>
        {subtitle && <p className={s.pageSubtitle}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
