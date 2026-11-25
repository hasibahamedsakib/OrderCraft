import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { bestSellingOptions } from '../domain/stats';
import { dhaka } from '../test/configs';
import { createTestServer } from '../test/testServer';
import { makeStore } from '../store';
import { App } from './App';

const server = createTestServer();

/**
 * Fake Gemini: picks a tool from keywords in the question (mode ANY), then echoes the
 * function response it was given (mode NONE). So any number in the reply came from our code.
 */
interface GeminiBody {
  contents: { role: string; parts: { text?: string; functionResponse?: { name: string; response: unknown } }[] }[];
  toolConfig?: { functionCallingConfig?: { mode?: string } };
}
const geminiCalls: GeminiBody[] = [];
const fakeGemini = http.post('https://generativelanguage.googleapis.com/*', async ({ request }) => {
  const body = (await request.json()) as GeminiBody;
  geminiCalls.push(body);
  if (body.toolConfig?.functionCallingConfig?.mode === 'ANY') {
    const question = body.contents[0]?.parts[0]?.text?.toLowerCase() ?? '';
    const name = question.includes('customer')
      ? 'explain_unanswerable'
      : question.includes('best-selling')
        ? 'get_best_selling_option'
        : 'get_order_count';
    return HttpResponse.json({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args: {} } }] } }] });
  }
  const fr = body.contents.flatMap((c) => c.parts).find((p) => p.functionResponse)?.functionResponse;
  return HttpResponse.json({ candidates: [{ content: { role: 'model', parts: [{ text: `Result: ${JSON.stringify(fr?.response)}` }] } }] });
});

beforeAll(() => server.msw.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  server.clock.now = Date.parse(dhaka('09:00:00'));
  server.mock.reset();
  server.msw.use(fakeGemini);
  geminiCalls.length = 0;
  window.location.hash = '#/order';
  URL.createObjectURL = vi.fn(() => 'blob:orders');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  server.msw.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.msw.close());

async function renderApp() {
  const store = makeStore({ storage: null });
  const user = userEvent.setup();
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
  await waitFor(() => {
    const st = store.getState();
    expect(st.menu.status).toBe('succeeded');
    expect(st.cart.loadStatus).toBe('succeeded');
    expect(st.orders.status).toBe('succeeded');
  });
  return { store, user };
}

type User = ReturnType<typeof userEvent.setup>;

async function increase(user: User, optionName: string, times = 1) {
  for (let i = 0; i < times; i++) await user.click(screen.getByRole('button', { name: `Increase ${optionName}` }));
}

async function buildA(user: User) {
  await user.click(screen.getByRole('radio', { name: /^Toast/ }));
  await increase(user, 'Scrambled', 2);
  await increase(user, 'Chicken Sausage');
  await user.click(screen.getByRole('checkbox', { name: /^Ketchup/ }));
}

const addButton = () => screen.getByRole('button', { name: /add to cart/i });

describe('Order builder UI', () => {
  it('TC-01: shows the eggs step violation next to the group and blocks Add to cart', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /^Toast/ }));
    await increase(user, 'Scrambled', 3);
    await increase(user, 'Chicken Sausage');

    const eggs = screen.getByRole('region', { name: 'Eggs' });
    expect(within(eggs).getByText('Eggs total must be 2-6 in steps of 2 (currently 3).')).toBeInTheDocument();
    expect(addButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Decrease Scrambled' }));
    expect(within(eggs).queryByText(/currently 3/)).not.toBeInTheDocument();
  });

  it('TC-04: lists both exclusion violations', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole('radio', { name: /^Toast/ }));
    await increase(user, 'Scrambled', 2);
    await increase(user, 'Tofu');
    await increase(user, 'Beef Bacon');
    await user.click(screen.getByRole('checkbox', { name: /^Chili/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Hollandaise/ }));
    expect(screen.getByText('Tofu cannot be combined with Beef Bacon.')).toBeInTheDocument();
    expect(screen.getByText('Chili cannot be combined with Hollandaise.')).toBeInTheDocument();
    expect(screen.getByText('2 issues to fix before adding')).toBeInTheDocument();
  });

  it('shows the server price preview, then adds once on a triple click (TC-05, TC-13)', async () => {
    const { user, store } = await renderApp();
    await buildA(user);
    expect(await screen.findByTestId('preview-total', {}, { timeout: 2000 })).toHaveTextContent('৳380.00');

    const button = addButton();
    await act(async () => {
      button.click();
      button.click();
      button.click();
    });
    const cart = screen.getByRole('region', { name: 'Cart' });
    await within(cart).findByRole('listitem', { name: 'Cart item 1' });
    expect(within(cart).queryByRole('listitem', { name: 'Cart item 2' })).not.toBeInTheDocument();
    expect(store.getState().inventory.stock.egg?.reserved).toBe(2);
    expect(within(cart).getByTestId('cart-payable')).toHaveTextContent('৳399.00');
  });

  it('TC-08 / TC-11: shared stock disables egg options and blocks a quantity change with every shortage', async () => {
    const { user } = await renderApp();
    // B x1
    await user.click(screen.getByRole('radio', { name: /^Croissant/ }));
    await increase(user, 'Omelette', 2);
    await increase(user, 'Fried', 2);
    await increase(user, 'Chicken Sausage');
    await increase(user, 'Beef Bacon');
    await increase(user, 'Hash Brown');
    await increase(user, 'Mushroom');
    await user.click(screen.getByRole('checkbox', { name: /^Hollandaise/ }));
    await user.click(addButton());
    await screen.findByRole('listitem', { name: 'Cart item 1' });
    // C x2
    await user.click(screen.getByRole('radio', { name: /^Paratha/ }));
    await increase(user, 'Fried', 2);
    await increase(user, 'Tofu');
    await increase(user, 'Cheese', 2);
    await increase(user, 'Baked Beans');
    await increase(user, 'Mushroom');
    await user.click(screen.getByRole('checkbox', { name: /^Chili/ }));
    await user.click(screen.getByRole('button', { name: 'Increase Item quantity' }));
    await user.click(addButton());
    const second = await screen.findByRole('listitem', { name: 'Cart item 2' });

    const eggs = screen.getByRole('region', { name: 'Eggs' });
    expect(within(eggs).getAllByText('Out of stock')).toHaveLength(3);
    expect(within(eggs).getByRole('button', { name: 'Increase Fried' })).toBeDisabled();

    await user.click(within(second).getByRole('button', { name: 'Increase Quantity' }));
    expect(within(second).getByRole('alert')).toHaveTextContent('Short: 2 egg, 2 cheese');
  });

  it('TC-16: Pay clicked twice creates one order and empties the cart', async () => {
    const { user, store } = await renderApp();
    await buildA(user);
    await user.click(addButton());
    const pay = await screen.findByRole('button', { name: /^Pay ৳399\.00/ });
    await act(async () => {
      pay.click();
      pay.click();
    });
    await screen.findByText(/Order ORD-1007 placed/);
    expect(store.getState().orders.items).toHaveLength(7);
    expect((server.mock.getOrders().body as { orders: unknown[] }).orders).toHaveLength(7);
  });
});

describe('Orders view', () => {
  it('lists seed orders and exports orders.json', async () => {
    window.location.hash = '#/orders';
    const { user } = await renderApp();
    expect(await screen.findByText('ORD-1006')).toBeInTheDocument();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: /download orders\.json/i }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    const file = JSON.parse(await blob.text());
    expect(file).toMatchObject({ schemaVersion: 1, moneyUnit: 'poisha', orderCount: 6 });
    expect(file.orders[0]).toMatchObject({ id: 'ORD-1001', totals: { payable: 33_900 } });
    click.mockRestore();
  });
});

describe('Sales assistant (Part F)', () => {
  async function ask(user: User, question: string) {
    const input = screen.getByRole('textbox', { name: 'Your question' });
    await user.type(input, `${question}{Enter}`);
    await waitFor(() => expect(screen.queryByLabelText('Assistant is typing')).not.toBeInTheDocument());
  }

  it('shows a clear message when the key is missing', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', '');
    window.location.hash = '#/assistant';
    const { user } = await renderApp();
    expect(screen.getByText('Gemini API key missing')).toBeInTheDocument();
    await ask(user, 'How many orders?');
    expect(await screen.findByText(/No Gemini API key found/)).toBeInTheDocument();
    expect(geminiCalls).toHaveLength(0);
  });

  it('TC-18: "How many orders?" changes by exactly one after a checkout, without reload', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    window.location.hash = '#/assistant';
    const { user, store } = await renderApp();
    await waitFor(() => expect(store.getState().orders.items).toHaveLength(6));
    await ask(user, 'How many orders?');
    expect(await screen.findByText('Result: {"orderCount":6}')).toBeInTheDocument();
    // the model never received raw orders
    expect(JSON.stringify(geminiCalls)).not.toContain('ORD-1001');

    window.location.hash = '#/order';
    await screen.findByRole('heading', { name: 'Build Your Breakfast' });
    await buildA(user);
    await user.click(addButton());
    await user.click(await screen.findByRole('button', { name: /^Pay / }));
    await screen.findByText(/Order ORD-1007 placed/);

    window.location.hash = '#/assistant';
    await screen.findByRole('textbox', { name: 'Your question' });
    await ask(user, 'How many orders?');
    expect(await screen.findByText('Result: {"orderCount":7}')).toBeInTheDocument();
  });

  it('TC-19: best-selling option matches the stats function', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    window.location.hash = '#/assistant';
    const { user, store } = await renderApp();
    await waitFor(() => expect(store.getState().orders.items).toHaveLength(6));
    await ask(user, 'What is the best-selling option?');
    const expected = bestSellingOptions(store.getState().orders.items, store.getState().menu.data!.menu)[0]!;
    expect(await screen.findByText(new RegExp(`"option":"${expected.name}","units":${expected.units}`))).toBeInTheDocument();
  });

  it('TC-20: "Who is our best customer?" is refused with fixed text, never a name', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    window.location.hash = '#/assistant';
    const { user } = await renderApp();
    await ask(user, 'Who is our best customer?');
    expect(await screen.findByText(/can't answer that from the sales data/)).toBeInTheDocument();
    expect(geminiCalls).toHaveLength(1); // no second call: the model never phrases this one
  });

  it('shows quota and invalid-key errors with Retry', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
    server.msw.use(
      http.post('https://generativelanguage.googleapis.com/*', () =>
        HttpResponse.json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }, { status: 429 }),
      ),
    );
    window.location.hash = '#/assistant';
    const { user } = await renderApp();
    await ask(user, 'How many orders?');
    expect(await screen.findByText(/quota reached \(429\)/)).toBeInTheDocument();

    server.msw.use(
      http.post('https://generativelanguage.googleapis.com/*', () =>
        HttpResponse.json({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }, { status: 400 }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/API key was rejected/)).toBeInTheDocument();
  });
});
