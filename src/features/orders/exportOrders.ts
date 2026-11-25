import type { StoredOrder } from '../../domain/orders';

/** The orders.json file shape (documented in DECISIONS.md, D6). */
export interface OrdersExport {
  schemaVersion: 1;
  exportedAt: string;
  currency: string;
  moneyUnit: 'poisha';
  orderCount: number;
  orders: StoredOrder[];
}

export function buildOrdersExport(orders: StoredOrder[], currency: string, exportedAt: string): OrdersExport {
  return { schemaVersion: 1, exportedAt, currency, moneyUnit: 'poisha', orderCount: orders.length, orders };
}

/** Trigger a browser download of `data` as pretty-printed JSON. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
