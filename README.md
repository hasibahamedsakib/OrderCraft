# OrderCraft

Smart order builder for a breakfast shop: data-driven menu rules, ingredient stock shared across the cart, integer-poisha pricing, atomic reservations against a mock server, orders stored as JSON, and a Gemini sales assistant whose numbers come from code.

Stack: React 19, TypeScript (strict), Vite, Redux Toolkit, MSW (the server), Vitest + React Testing Library, Gemini REST API with function calling.

## Setup

```bash
pnpm install
cp .env.example .env.local      # paste VITE_GEMINI_API_KEY (Google AI Studio, free tier)
pnpm dev                        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm test` | All automated tests (Section 9 acceptance tests, engines, mock server, store, UI) |
| `pnpm answers` | Prints the ANSWERS.md values from the real engines |
| `pnpm typecheck` / `pnpm build` | Strict type check / production build |

There is no backend. MSW intercepts `/api/*` in the browser, and its data lives in `localStorage` (key `ordercraft.server.v1`). It survives a refresh, and every tab of the app shares it.

Optional `VITE_GEMINI_MODEL` overrides the default model, `gemini-2.5-flash`.

**Demo controls** (footer, "Demo controls (mock server)") let you move the server clock (10:59:30 / 11:00:00 / +4:50), force the next reservation to fail half-way, or reset all demo data. Use them to check TC-06/07, TC-14 and TC-15 by hand.

## Architecture

```
src/
  domain/        Pure TypeScript, no React/Redux. Shared by the mock server, the store and tests.
    validate.ts    validate(config, groups, rules) -> every violation
    stock.ts       ingredient usage, net-difference edits, shortages, headroom
    pricing.ts     priceUnit / priceCart (integer poisha, exact step order)
    money.ts       roundHalfUpDiv, percentOf, formatting (no floats in money math)
    orders.ts      StoredOrder shape (D6) + createStoredOrder (priced at createdAt)
    stats.ts       sales statistics used by the assistant
    availability.ts  per-group / per-option UI state (full, max different, out of stock)
  mocks/         The "server"
    fixture/       menu.fixture.json (Appendix A, money in poisha) + orders.seed.json
    server.ts      createMockServer(): reservations, idempotency, expiry, checkout, clock (+90 s)
    handlers.ts    MSW handlers: latency + JSON only
  api/           contracts.ts (HTTP types) + client.ts (typed fetch, idempotency keys)
  store/         Redux Toolkit
    slices/        menu, builder, cart, inventory, orders, chat, clock
    selectors/     createSelector wrappers around domain/ functions
    thunks.ts      all async flows (snapshot ordering, error snapshots)
    listeners.ts   debounced price preview (listener middleware)
  assistant/     Gemini client (fetch) + tool declarations/execution
  features/      builder / cart / orders / assistant / devtools UI
  components/ui  Button, Card, Alert, Badge, QuantitySelector, Loading/Empty/Error states, icons
  app/           App, layout, hooks (hash routing, server sync, server-clock "now")
```

### State ownership

| State | Owner | Why |
|---|---|---|
| Menu, cart, stock, orders | Redux **mirror of the server** | Shared with other tabs. Replaced only by server responses, never updated optimistically. |
| Configuration being built, price preview | Redux (`builder`) | Read by validation, stock headroom, preview and cart edit. Persisted so it survives a refresh. |
| Chat messages | Redux (`chat`) | Kept when you switch views. The assistant reads orders from the store at question time. |
| Server clock offset | Redux (`clock`) | Measured from every response's `serverTime`. |
| Open panels, text inputs | Component state | Purely visual. |

Business logic lives in `domain/`. Components read memoized selectors and dispatch actions. The same `validate` / `priceCart` / `shortagesFor` run in the browser (instant feedback) and in the mock server (the authority).

### Rules engine (`validate`)

It is generic over `groups` and `rules` from the API. It checks min, max, step, maxDistinct and maxPerOption per group, then `requires`, `excludes` and `overrideLimit`. The override replaces the group max, and the strictest override wins. It returns all violations, each with `code`, `groupId`, `ruleId` and a message. The UI shows each one under its group, and Add to cart stays disabled while any exist.

### Stock engine

`usage = Σ option.uses × option qty × item qty`. The server reports `available = onHand − active reservations`. When editing, `free = available + the item's own allocation`, so an item never double-counts itself or releases more than it holds. Shortages list every short ingredient in menu order ("Short: 2 egg, 2 cheese"). Headroom is how many more units of an option fit right now, and options are disabled at 0.

### Pricing engine

The steps are: unit subtotal, then P2 (cheapest extras free, per unit), then P1 (combo %, on the step-2 amount), then × qty, then the one best cart discount (tie → lowest `priority`, C1), then VAT, then payable rounded half-up to whole BDT. Promotions and discounts are data, typed by `type`. All percentages are basis points, with integer half-up rounding.

### Async flows

- **Price preview (TC-12):** the listener middleware debounces for 300 ms, cancels the previous run and aborts its request. The reducer only accepts the response whose `requestId` is the latest. The UI also shows a price only if it belongs to the exact configuration on screen. On failure the configuration is kept and Retry is offered.
- **Add to cart (TC-13):** a thunk `condition` and an idempotency key. The server replays a known key without reserving again.
- **Reservations (TC-14):** the server works on a fresh copy of its state and only saves if the whole request succeeds. A half-way failure leaves nothing held.
- **Expiry (TC-15):** the server clock = browser + 90 s. The client offset = `serverTime − midpoint(request)`. Countdowns use `Date.now() + offset`. The cart reloads right after the next expiry, and expired items become read-only.
- **Two tabs:** every change bumps `cart.version`. Edit, remove and pay send `baseVersion` and get `409 VERSION_CONFLICT` plus a fresh snapshot if it's stale. A `storage` event makes other tabs reload.
- **Checkout (TC-16):** idempotency key + condition + server replay. Reserved stock becomes sold exactly once.

### Assistant

`askAssistant` makes one Gemini call with mode `ANY`, so the model must pick a tool. The tool runs locally over the orders in Redux. A second call with mode `NONE` lets Gemini phrase the result. Questions the data can't answer get a fixed reply from code, with no second call. Missing key, invalid key, 429 quota, network and server errors each have a clear message and Retry. Tests mock Gemini with MSW. See DECISIONS.md, C2 for the tool table.

## Trade-offs

- **The mock server persists to `localStorage` and runs inside each tab.** That is the simplest way to get "one server, two tabs" with MSW. Two tabs writing in the same millisecond could still race, because there's no cross-tab lock. A real backend would use a transaction, and `navigator.locks` could close the gap here.
- **No chat history is sent to Gemini.** This gives correct, fresh numbers, but follow-up questions like "and yesterday?" don't work.
- **Polling the cart (15 s) plus storage events** instead of a push channel.
- **No router dependency.** A tiny hash router keeps the view across refreshes.
- **Plain CSS modules with design tokens** instead of a UI kit, to keep the dependencies minimal.
- **Bundle size:** MSW ships in production too, because it is the backend. That's fine for a demo.

## Status

- Parts A–F are implemented and tested: `pnpm test` runs 84 tests, including every Section 9 case.
- Part G (bonus) is done: refresh keeps only valid reservations (the server is the source of truth), version conflicts across tabs, and the unfinished configuration survives a refresh.
- **Not covered by the automated suite:** visual layout, responsive breakpoints and the MSW service-worker start-up in a real browser. The UI tests run in jsdom.
- **The Gemini call has not been run against the live API in this repo's tests** (they're mocked). Check it with your own key: the request uses the documented `v1beta generateContent` function-calling format.

## Hours spent

_Fill in your actual hours._
