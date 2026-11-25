import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import type { HttpResult, MockServer } from './server';

export interface LatencyConfig {
  /** [min, max] ms for POST /api/price (the brief asks for 200-1500). */
  price: [number, number];
  /** [min, max] ms for everything else. */
  other: [number, number];
}

export const BROWSER_LATENCY: LatencyConfig = { price: [200, 1500], other: [120, 450] };
export const NO_LATENCY: LatencyConfig = { price: [0, 0], other: [0, 0] };

function wait([min, max]: [number, number]): Promise<void> | void {
  if (max <= 0) return;
  return delay(min + Math.round(Math.random() * (max - min)));
}

function respond<T>(result: HttpResult<T>) {
  return HttpResponse.json(result.body as JsonBodyType, { status: result.status });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Thin HTTP layer: latency + JSON in/out. All behaviour lives in server.ts. */
export function createHandlers(server: MockServer, latency: LatencyConfig = BROWSER_LATENCY) {
  return [
    http.get('*/api/menu', async () => {
      await wait(latency.other);
      return respond(server.getMenu());
    }),
    http.get('*/api/cart', async () => {
      await wait(latency.other);
      return respond(server.getCart());
    }),
    http.post('*/api/cart/items', async ({ request }) => {
      const body = await readJson(request);
      await wait(latency.other);
      return respond(server.addItem(body));
    }),
    http.put('*/api/cart/items/:itemId', async ({ request, params }) => {
      const body = await readJson(request);
      await wait(latency.other);
      return respond(server.updateItem(String(params.itemId), body));
    }),
    http.delete('*/api/cart/items/:itemId', async ({ request, params }) => {
      const version = new URL(request.url).searchParams.get('baseVersion');
      await wait(latency.other);
      return respond(server.removeItem(String(params.itemId), version === null ? null : Number(version)));
    }),
    http.put('*/api/cart/coupon', async ({ request }) => {
      const body = await readJson(request);
      await wait(latency.other);
      return respond(server.setCoupon(body));
    }),
    http.post('*/api/checkout', async ({ request }) => {
      const body = await readJson(request);
      await wait(latency.other);
      return respond(server.checkout(body));
    }),
    http.get('*/api/orders', async () => {
      await wait(latency.other);
      return respond(server.getOrders());
    }),
    http.post('*/api/price', async ({ request }) => {
      const body = await readJson(request);
      await wait(latency.price);
      return respond(server.price(body));
    }),
    http.get('*/api/__dev', () => respond(server.getDev())),
    http.put('*/api/__dev', async ({ request }) => respond(server.setDev(await readJson(request)))),
    http.post('*/api/__dev/reset', () => respond(server.reset())),
  ];
}
