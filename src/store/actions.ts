import { createAction } from '@reduxjs/toolkit';
import type { CartSnapshot } from '../api/contracts';

/** Any response carrying serverTime: lets the clock slice compute the server offset. */
export const serverTimeObserved = createAction<{ serverTime: string; sentAt: number; receivedAt: number }>(
  'server/timeObserved',
);

/**
 * The server's view of cart + stock. Cart and inventory slices both replace their data with it.
 * Thunks only dispatch it when it is newer than what we have (see isNewerSnapshot).
 */
export const cartSnapshotReceived = createAction(
  'server/cartSnapshotReceived',
  (snapshot: CartSnapshot, sentAt: number) => ({ payload: snapshot, meta: { sentAt } }),
);
