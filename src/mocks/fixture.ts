import rawMenu from './fixture/menu.fixture.json';
import rawSeed from './fixture/orders.seed.json';
import type { IngredientAmounts, Menu, PaymentMethod, Promotions, Selection } from '../domain/types';

/** What the mock server is configured with. Swap the JSON to run a different menu. */
export interface Fixture {
  currency: string;
  /** Shop time zone used for order timestamps and "orders on a date". */
  timeZone: string;
  menu: Menu;
  promotions: Promotions;
  paymentMethods: PaymentMethod[];
  /** Ingredients that are tracked. Ingredients missing here are unlimited. */
  initialStock: IngredientAmounts;
  reservationTtlMs: number;
}

export interface SeedOrder {
  id: string;
  createdAt: string;
  paymentMethod: string;
  couponCode: string | null;
  lines: { qty: number; options: Selection }[];
}

interface RawIngredient {
  id: string;
  name: string;
  stock: number | null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid fixture: ${message}`);
}

/** Light structural check, then a typed view of the JSON. */
export function loadFixture(data: unknown = rawMenu): Fixture {
  assert(typeof data === 'object' && data !== null, 'not an object');
  const d = data as Record<string, unknown>;
  assert(Array.isArray(d.groups), 'groups must be an array');
  assert(Array.isArray(d.rules), 'rules must be an array');
  assert(Array.isArray(d.ingredients), 'ingredients must be an array');
  assert(typeof d.product === 'object' && d.product !== null, 'product missing');
  assert(typeof d.promotions === 'object' && d.promotions !== null, 'promotions missing');

  const ingredients = d.ingredients as RawIngredient[];
  const initialStock: IngredientAmounts = {};
  for (const ing of ingredients) if (typeof ing.stock === 'number') initialStock[ing.id] = ing.stock;

  const reservation = d.reservation as { ttlSeconds?: number } | undefined;
  return {
    currency: typeof d.currency === 'string' ? d.currency : 'BDT',
    timeZone: typeof d.timeZone === 'string' ? d.timeZone : 'UTC',
    menu: {
      product: d.product as Menu['product'],
      ingredients: ingredients.map(({ id, name }) => ({ id, name })),
      groups: d.groups as Menu['groups'],
      rules: d.rules as Menu['rules'],
    },
    promotions: d.promotions as Promotions,
    paymentMethods: (d.paymentMethods as PaymentMethod[] | undefined) ?? [],
    initialStock,
    reservationTtlMs: (reservation?.ttlSeconds ?? 300) * 1000,
  };
}

export function loadSeedOrders(data: unknown = rawSeed): SeedOrder[] {
  assert(typeof data === 'object' && data !== null, 'seed is not an object');
  const orders = (data as { orders?: unknown }).orders;
  assert(Array.isArray(orders), 'seed.orders must be an array');
  return orders as SeedOrder[];
}
