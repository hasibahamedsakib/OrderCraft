import { createSlice } from '@reduxjs/toolkit';
import { serverTimeObserved } from '../actions';

/**
 * Offset between the server clock and this browser: serverNow ≈ Date.now() + offsetMs.
 * Estimated from every response: serverTime minus the midpoint of the request's round trip.
 * Countdowns and expiry use this, never Date.now() alone (the server runs 90 s ahead).
 */
export interface ClockState {
  offsetMs: number;
  synced: boolean;
}

const initialState: ClockState = { offsetMs: 0, synced: false };

export function estimateOffset(serverTime: string, sentAt: number, receivedAt: number): number {
  return Date.parse(serverTime) - Math.round((sentAt + receivedAt) / 2);
}

const clockSlice = createSlice({
  name: 'clock',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(serverTimeObserved, (state, { payload }) => {
      state.offsetMs = estimateOffset(payload.serverTime, payload.sentAt, payload.receivedAt);
      state.synced = true;
    });
  },
});

export default clockSlice.reducer;
