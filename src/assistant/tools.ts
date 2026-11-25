import { formatTaka } from '../domain/money';
import type { StoredOrder } from '../domain/orders';
import {
  averageOrderValue,
  bestSellingOptions,
  couponUsage,
  optionUnitsRanking,
  orderCount,
  ordersOnDate,
  revenueByPaymentMethod,
  totalRevenue,
} from '../domain/stats';
import type { Menu, Poisha } from '../domain/types';

/*
 * The assistant's tools. Gemini only chooses one of these and phrases its result;
 * every number comes from the pure functions in domain/stats.ts.
 */

export interface ToolContext {
  orders: StoredOrder[];
  menu: Menu | null;
  timeZone: string;
  currency: string;
  paymentMethodLabel: (id: string) => string;
}

export interface ToolResult {
  name: string;
  args: Record<string, unknown>;
  /** false = the data cannot answer the question; the reply is `summary`, never model text. */
  answerable: boolean;
  /** JSON sent back to Gemini as the function response. */
  data: Record<string, unknown>;
  /** Deterministic phrasing from code, used when Gemini is not needed or unavailable. */
  summary: string;
}

/** Function declarations in Gemini's format (OpenAPI subset). */
export const TOOL_DECLARATIONS = [
  {
    name: 'get_order_count',
    description: 'Total number of orders stored (seed orders plus every checkout).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_total_revenue',
    description: 'Total revenue of all orders: the sum of each order payable (VAT included, after discounts).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_best_selling_option',
    description:
      'Best-selling menu option counted in units (line quantity x option quantity). Returns ties and the top 5 ranking.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_revenue_by_payment_method',
    description: 'Revenue and order count per payment method, highest revenue first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_average_order_value',
    description: 'Average payable per order.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_coupon_usage',
    description:
      'How many orders entered a coupon code and how many actually received its discount, with the reason for each order that did not.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Coupon code, e.g. MORNING15. Omit for all codes.' } },
    },
  },
  {
    name: 'get_orders_on_date',
    description: 'Orders placed on one calendar date in the shop time zone: count, revenue and the list of orders.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Date as YYYY-MM-DD in the shop time zone.' } },
      required: ['date'],
    },
  },
  {
    name: 'explain_unanswerable',
    description:
      'Use when the question needs information the orders do not contain (customers, names, phone numbers, staff, costs, profit, delivery, ratings) or is not about sales.',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Short description of what was asked.' } },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DECLARATIONS)[number]['name'];

const STORED_FIELDS = 'date and time, items and options, payment method, coupon code, and totals';

function money(amount: Poisha, currency: string): string {
  return `${formatTaka(amount)} ${currency}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function unanswerableResult(args: Record<string, unknown> = {}): ToolResult {
  return {
    name: 'explain_unanswerable',
    args,
    answerable: false,
    data: { answerable: false, storedFields: STORED_FIELDS },
    summary:
      `I can't answer that from the sales data. Each order only records its ${STORED_FIELDS}. ` +
      'There is no customer, staff or cost information, so I won’t guess. ' +
      'I can tell you order counts, revenue, best-selling options, payment methods, average order value, coupon use, or orders on a date.',
  };
}

export function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const { orders, currency } = ctx;
  switch (name as ToolName) {
    case 'get_order_count': {
      const count = orderCount(orders);
      return { name, args, answerable: true, data: { orderCount: count }, summary: `There are ${plural(count, 'order')}.` };
    }
    case 'get_total_revenue': {
      const revenue = totalRevenue(orders);
      return {
        name,
        args,
        answerable: true,
        data: { totalRevenue: money(revenue, currency), orderCount: orders.length, includesVat: true },
        summary: `Total revenue is ${money(revenue, currency)} across ${plural(orders.length, 'order')} (VAT included).`,
      };
    }
    case 'get_best_selling_option': {
      const best = bestSellingOptions(orders, ctx.menu ?? undefined);
      if (best.length === 0) {
        return { name, args, answerable: true, data: { best: [] }, summary: 'There are no orders yet, so nothing has sold.' };
      }
      const names = best.map((b) => b.name).join(' and ');
      return {
        name,
        args,
        answerable: true,
        data: {
          best: best.map((b) => ({ option: b.name, units: b.units })),
          top5: optionUnitsRanking(orders, ctx.menu ?? undefined)
            .slice(0, 5)
            .map((r) => ({ option: r.name, units: r.units })),
        },
        summary:
          best.length === 1
            ? `The best-selling option is ${names} with ${plural(best[0]!.units, 'unit')}.`
            : `${names} are tied as best-selling with ${plural(best[0]!.units, 'unit')} each.`,
      };
    }
    case 'get_revenue_by_payment_method': {
      const rows = revenueByPaymentMethod(orders);
      return {
        name,
        args,
        answerable: true,
        data: {
          byPaymentMethod: rows.map((r) => ({
            paymentMethod: ctx.paymentMethodLabel(r.paymentMethod),
            orders: r.orders,
            revenue: money(r.revenue, currency),
          })),
        },
        summary:
          rows.length === 0
            ? 'There are no orders yet.'
            : `Revenue by payment method: ${rows
                .map((r) => `${ctx.paymentMethodLabel(r.paymentMethod)} ${money(r.revenue, currency)} (${plural(r.orders, 'order')})`)
                .join(', ')}.`,
      };
    }
    case 'get_average_order_value': {
      const avg = averageOrderValue(orders);
      return {
        name,
        args,
        answerable: true,
        data: { averageOrderValue: money(avg, currency), orderCount: orders.length },
        summary:
          orders.length === 0
            ? 'There are no orders yet, so there is no average.'
            : `The average order value is ${money(avg, currency)} over ${plural(orders.length, 'order')}.`,
      };
    }
    case 'get_coupon_usage': {
      const code = typeof args.code === 'string' ? args.code : null;
      const usage = couponUsage(orders, code);
      const label = usage.code ?? 'a coupon';
      return {
        name,
        args,
        answerable: true,
        data: {
          code: usage.code,
          ordersThatEnteredCode: usage.ordersWithCode,
          ordersThatReceivedDiscount: usage.ordersDiscounted,
          discountedOrderIds: usage.discountedOrderIds,
          notApplied: usage.notApplied,
        },
        summary:
          `${plural(usage.ordersDiscounted, 'order')} actually received ${label}` +
          ` (${usage.ordersWithCode} entered it)` +
          (usage.notApplied.length
            ? `. Not applied: ${usage.notApplied.map((n) => `${n.orderId}: ${n.reason}`).join(' ')}`
            : '.'),
      };
    }
    case 'get_orders_on_date': {
      const date = typeof args.date === 'string' ? args.date.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        return {
          name,
          args,
          answerable: false,
          data: { error: 'date must be YYYY-MM-DD' },
          summary: 'I could not tell which date you mean. Please give it like 2026-11-21.',
        };
      }
      const result = ordersOnDate(orders, date, ctx.timeZone);
      return {
        name,
        args,
        answerable: true,
        data: {
          date,
          timeZone: ctx.timeZone,
          orderCount: result.count,
          revenue: money(result.revenue, currency),
          orders: result.orders.map((o) => ({
            id: o.id,
            createdAt: o.createdAt,
            paymentMethod: ctx.paymentMethodLabel(o.paymentMethod),
            payable: money(o.payable, currency),
          })),
        },
        summary:
          result.count === 0
            ? `There were no orders on ${date}.`
            : `On ${date} there ${result.count === 1 ? 'was' : 'were'} ${plural(result.count, 'order')} (${result.orders
                .map((o) => o.id)
                .join(', ')}) totalling ${money(result.revenue, currency)}.`,
      };
    }
    case 'explain_unanswerable':
      return unanswerableResult(args);
    default:
      return unanswerableResult({ requestedTool: name });
  }
}
