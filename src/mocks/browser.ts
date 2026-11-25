import { setupWorker } from 'msw/browser';
import { createHandlers } from './handlers';
import { createMockServer } from './server';

/**
 * The browser's "server". State lives in localStorage so it survives a refresh and is
 * shared by every tab of this origin (each tab runs the handlers, all read the same data).
 */
export async function startMockServer(): Promise<void> {
  const server = createMockServer({
    storage: window.localStorage,
    priceFailureRate: 0.15,
    reserveFailureRate: 0.1,
  });
  const worker = setupWorker(...createHandlers(server));
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}
