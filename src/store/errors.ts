import { ApiError, type ClientErrorCode } from '../api/client';
import type { Shortage } from '../domain/stock';
import type { Violation } from '../domain/validate';

/** Serializable error kept in Redux state. */
export interface SubmitError {
  code: ClientErrorCode;
  message: string;
  shortages?: Shortage[];
  violations?: Violation[];
}

export function toSubmitError(error: unknown): SubmitError {
  if (error instanceof ApiError) {
    const out: SubmitError = { code: error.code, message: error.message };
    if (error.body?.shortages) out.shortages = error.body.shortages;
    if (error.body?.violations) out.violations = error.body.violations;
    return out;
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Something went wrong.' };
}
