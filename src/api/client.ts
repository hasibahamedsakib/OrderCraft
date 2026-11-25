import type {
  AddItemRequest,
  AddItemResponse,
  ApiErrorBody,
  CartSnapshot,
  CheckoutRequest,
  CheckoutResponse,
  DevSettings,
  ErrorCode,
  MenuResponse,
  OrdersResponse,
  PriceRequest,
  PriceResponse,
  UpdateItemRequest,
} from './contracts';

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'ABORTED' | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly body: ApiErrorBody | null;

  constructor(status: number, code: ClientErrorCode, message: string, body: ApiErrorBody | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Response plus when it was sent/received by the browser, for server-clock offset. */
export interface Timed<T> {
  data: T;
  sentAt: number;
  receivedAt: number;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Timed<T>> {
  const url = new URL(path, window.location.origin).toString();
  const sentAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) throw new ApiError(0, 'ABORTED', 'Request was cancelled.');
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and retry.', null);
  }
  const receivedAt = Date.now();
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    if (isErrorBody(json)) throw new ApiError(response.status, json.code, json.message, json);
    throw new ApiError(response.status, 'UNKNOWN', `Request failed (${response.status}).`);
  }
  return { data: json as T, sentAt, receivedAt };
}

export const api = {
  getMenu: () => request<MenuResponse>('GET', '/api/menu'),
  getCart: () => request<CartSnapshot>('GET', '/api/cart'),
  addItem: (body: AddItemRequest) => request<AddItemResponse>('POST', '/api/cart/items', body),
  updateItem: (itemId: string, body: UpdateItemRequest) =>
    request<CartSnapshot>('PUT', `/api/cart/items/${encodeURIComponent(itemId)}`, body),
  removeItem: (itemId: string, baseVersion: number) =>
    request<CartSnapshot>('DELETE', `/api/cart/items/${encodeURIComponent(itemId)}?baseVersion=${baseVersion}`),
  setCoupon: (code: string | null) => request<CartSnapshot>('PUT', '/api/cart/coupon', { code }),
  checkout: (body: CheckoutRequest) => request<CheckoutResponse>('POST', '/api/checkout', body),
  getOrders: () => request<OrdersResponse>('GET', '/api/orders'),
  price: (body: PriceRequest, signal?: AbortSignal) => request<PriceResponse>('POST', '/api/price', body, signal),
  getDev: () => request<DevSettings & { serverTime: string }>('GET', '/api/__dev'),
  setDev: (body: Partial<DevSettings>) => request<DevSettings & { serverTime: string }>('PUT', '/api/__dev', body),
  resetDemo: () => request<{ ok: true }>('POST', '/api/__dev/reset'),
};

/** Unique key for idempotent requests. Falls back when randomUUID is unavailable (non-HTTPS LAN demo). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
