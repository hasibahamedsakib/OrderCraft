import { Fragment, useState } from 'react';
import { PageHeader } from '../../app/AppLayout';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { ChevronIcon, DownloadIcon, ReceiptIcon } from '../../components/ui/icons';
import { describeSelection } from '../../domain/menu';
import { formatBDT } from '../../domain/money';
import type { StoredOrder } from '../../domain/orders';
import { zonedParts } from '../../domain/time';
import { api } from '../../api/client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectGroups, selectPaymentMethodLabel, selectShopTimeZone } from '../../store/selectors/menuSelectors';
import { selectOrderStats, selectOrdersNewestFirst } from '../../store/selectors/orderSelectors';
import { fetchOrders } from '../../store/thunks';
import { CouponBadge } from '../cart/CouponForm';
import { buildOrdersExport, downloadJson } from './exportOrders';
import s from './orders.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string, timeZone: string): { date: string; time: string } {
  const p = zonedParts(iso, timeZone);
  return {
    date: `${p.day} ${MONTHS[p.month - 1]} ${p.year}`,
    time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
  };
}

export function OrderHistory() {
  const dispatch = useAppDispatch();
  const { items: orders, status, error } = useAppSelector((state) => state.orders);
  const currency = useAppSelector((state) => state.menu.data?.currency ?? 'BDT');
  const timeZone = useAppSelector(selectShopTimeZone);
  const methodLabel = useAppSelector(selectPaymentMethodLabel);
  const groups = useAppSelector(selectGroups);
  const [open, setOpen] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const sorted = useAppSelector(selectOrdersNewestFirst); // newest first for reading; the export keeps server order
  const stats = useAppSelector(selectOrderStats);

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await api.getOrders(); // export what the server has right now
      downloadJson('orders.json', buildOrdersExport(res.data.orders, currency, res.data.serverTime));
    } catch {
      setDownloadError('Could not fetch orders for the download. Please retry.');
    } finally {
      setDownloading(false);
    }
  };

  const header = (
    <PageHeader
      title="Orders"
      subtitle={`Seed orders and every checkout, priced by the same engine. Times in ${timeZone}.`}
      actions={
        <Button variant="primary" icon={<DownloadIcon size={15} />} onClick={download} loading={downloading} disabled={orders.length === 0}>
          Download orders.json
        </Button>
      }
    />
  );

  if (status === 'failed' && orders.length === 0) {
    return (
      <>
        {header}
        <Card>
          <ErrorState title="Orders unavailable" message={error ?? 'Could not load orders.'} onRetry={() => dispatch(fetchOrders())} />
        </Card>
      </>
    );
  }
  if (status !== 'succeeded' && orders.length === 0) {
    return (
      <>
        {header}
        <Card>
          <LoadingState label="Loading orders…" />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {downloadError && (
        <p role="alert" style={{ color: 'var(--danger)', marginBottom: 12 }}>
          {downloadError}
        </p>
      )}
      <div className={s.stats}>
        <Stat label="Orders" value={String(stats.count)} />
        <Stat label="Revenue (VAT incl.)" value={formatBDT(stats.revenue)} />
        <Stat label="Average order" value={formatBDT(stats.average)} />
        <Stat label="Coupon applied" value={`${stats.couponApplied} of ${stats.couponEntered} entered`} />
      </div>

      <Card bodyClassName={s.tableWrap}>
        {orders.length === 0 ? (
          <EmptyState icon={<ReceiptIcon size={20} />} title="No orders yet" action={<a href="#/order">Create the first order</a>}>
            Paid orders show up here instantly, and are kept after a refresh.
          </EmptyState>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Date</th>
                <th scope="col">Payment</th>
                <th scope="col">Coupon</th>
                <th scope="col" className={s.num}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((order) => {
                const when = formatDate(order.createdAt, timeZone);
                const expanded = open === order.id;
                return (
                  <Fragment key={order.id}>
                    <tr>
                      <td data-label="Order">
                        <button
                          type="button"
                          className={s.expand}
                          aria-expanded={expanded}
                          aria-controls={`order-${order.id}`}
                          onClick={() => setOpen(expanded ? null : order.id)}
                        >
                          <ChevronIcon size={14} />
                          <span>
                            <span className={s.orderId}>{order.id}</span>
                            <span className={s.sub}>
                              {order.lines.reduce((n, l) => n + l.qty, 0)} items{order.source === 'seed' ? ' · seed' : ''}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td data-label="Date">
                        <span>
                          {when.date}
                          <span className={s.sub}>{when.time}</span>
                        </span>
                      </td>
                      <td data-label="Payment">
                        <Badge>{methodLabel(order.paymentMethod)}</Badge>
                      </td>
                      <td data-label="Coupon">
                        {order.coupon ? (
                          <CouponBadge coupon={order.coupon} discountAmount={order.totals.discount?.amount} />
                        ) : order.totals.discount ? (
                          <Badge tone="success">{order.totals.discount.id}</Badge>
                        ) : (
                          <span className={s.sub}>—</span>
                        )}
                      </td>
                      <td data-label="Total" className={s.num}>
                        <strong>{formatBDT(order.totals.payable)}</strong>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className={s.detailRow} id={`order-${order.id}`}>
                        <td colSpan={5}>
                          <OrderDetail order={order} describe={(sel) => describeSelection(sel, groups).join(', ')} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
    </div>
  );
}

function OrderDetail({ order, describe }: { order: StoredOrder; describe: (sel: Record<string, number>) => string }) {
  const t = order.totals;
  return (
    <div className={s.detail}>
      <ul className={s.lines}>
        {order.lines.map((line, i) => (
          <li key={i} className={s.line}>
            <span className={s.lineQty}>{line.qty}×</span>
            <span>{describe(line.options)}</span>
            <span className={s.linePrice}>{formatBDT(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className={s.totals}>
        <dt>Subtotal</dt>
        <dd>{formatBDT(t.subtotal)}</dd>
        <dt>Discount{t.discount ? ` · ${t.discount.label}` : ''}</dt>
        <dd>{t.discount ? `−${formatBDT(t.discount.amount)}` : 'None'}</dd>
        <dt>VAT ({t.vatBps / 100}%)</dt>
        <dd>{formatBDT(t.vat)}</dd>
        <dt className={s.totalStrong}>Payable</dt>
        <dd className={s.totalStrong}>{formatBDT(t.payable)}</dd>
      </dl>
      {order.coupon && order.coupon.status !== 'applied' && <p className={s.sub}>{order.coupon.message}</p>}
    </div>
  );
}
