import type { Poisha } from './types';

/**
 * Integer division rounded half-up, using only integer arithmetic.
 * Works for non-negative integers, which is all money in this app.
 *   roundHalfUpDiv(75_475_000, 10_000) -> 7548  (75.475 BDT VAT -> 75.48)
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  assertNonNegativeInt(numerator, 'numerator');
  assertNonNegativeInt(denominator, 'denominator');
  if (denominator === 0) throw new Error('Division by zero');
  const remainder = numerator % denominator;
  const quotient = (numerator - remainder) / denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/** percentBps is basis points: 1000 = 10%, 500 = 5%. Result is rounded half-up to the poisha. */
export function percentOf(amount: Poisha, percentBps: number): Poisha {
  return roundHalfUpDiv(amount * percentBps, 10_000);
}

/** Round poisha half-up to whole BDT, still returned in poisha (e.g. 158498 -> 158500). */
export function roundToWholeTaka(amount: Poisha): Poisha {
  return roundHalfUpDiv(amount, 100) * 100;
}

/** BDT string -> poisha without going through floats: "679.50" -> 67950. */
export function parseTaka(value: string): Poisha {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim().replace(/,/g, ''));
  if (!match) throw new Error(`Not a BDT amount: ${value}`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

/** 165950 -> "1,659.50". Display only; built from integer parts. */
export function formatTaka(amount: Poisha): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const poisha = abs % 100;
  const taka = (abs - poisha) / 100;
  return `${sign}${taka.toLocaleString('en-US')}.${String(poisha).padStart(2, '0')}`;
}

/** 165950 -> "৳1,659.50" */
export function formatBDT(amount: Poisha): string {
  return amount < 0 ? `−৳${formatTaka(-amount)}` : `৳${formatTaka(amount)}`;
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer, got ${value}`);
  }
}
