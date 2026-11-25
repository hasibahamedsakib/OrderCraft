import { setupServer } from 'msw/node';
import { createHandlers, NO_LATENCY } from '../mocks/handlers';
import { createMockServer } from '../mocks/server';
import { memoryStorage } from '../mocks/storage';
import { dhaka } from './configs';

/**
 * Real mock server + MSW handlers with no latency and no random failures.
 * The browser clock is controllable through `clock`.
 */
export function createTestServer(startBrowserTime = dhaka('09:00:00')) {
  const clock = { now: Date.parse(startBrowserTime) };
  const storage = memoryStorage();
  const mock = createMockServer({ storage, now: () => clock.now, random: () => 0.5 });
  const msw = setupServer(...createHandlers(mock, NO_LATENCY));
  return { clock, storage, mock, msw };
}
