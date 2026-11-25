# DECISIONS

> **DRAFT NOTES — rewrite every section in your own words before submitting.**
> The brief says decisions that read like generic AI text will be questioned. These notes list
> the facts the code actually implements, and where to find them, so your prose matches the code.
> Each section should be 3–6 sentences in your voice.

---

## ✋ C1 — Why 679.50 as a float is risky, and how the VAT of 75.48 is rounded

**Facts to explain:**
- JavaScript numbers are IEEE-754 binary doubles. Most decimal fractions have no exact binary form: `0.1 + 0.2 === 0.30000000000000004`.
- In TC-06 the discounted subtotal is 1,509.50, and `1509.5 * 0.05` evaluates to `75.47500000000001` (checked in `pricing.test.ts`). Rounding a float that sits right on a `.5` boundary can go either way depending on accumulated error, so the same cart could give 75.47 on one code path and 75.48 on another.
- The fix used here: all money is **integer poisha**. 679.50 BDT is stored as `67950`. Percentages are basis points (5% = `500`). Rounding is integer division with remainder (`roundHalfUpDiv` in `src/domain/money.ts`), with no float involved.

**Hand working for TC-06 VAT:**
```
Subtotal         = 67950 (B) + 2 × 49000 (C)      = 165950 poisha (1,659.50)
C1 = 10000, C2 = min(15% of 165950 = 24893, cap 15000) = 15000 → C2 wins
Discounted       = 165950 − 15000                  = 150950 poisha
VAT numerator    = 150950 × 500                    = 75,475,000
75,475,000 ÷ 10,000 = 7547 remainder 5000
remainder × 2 = 10000 ≥ 10000  → round half up    = 7548 poisha = 75.48 BDT
Payable exact    = 150950 + 7548                   = 158498 → ÷100 = 1584 r 98 → 1585 BDT
```

---

## ✋ C2 — Every question the bot supports and the function that answers it

All tools are in `src/assistant/tools.ts`, built on pure functions in `src/domain/stats.ts`. Gemini sees only the declarations and the result of the one tool it picks, never the raw orders.

| Question | Tool (Gemini) | Inputs | Output (to the model) | Pure function |
|---|---|---|---|---|
| How many orders? | `get_order_count` | – | `{ orderCount }` | `orderCount(orders)` |
| Total revenue? | `get_total_revenue` | – | `{ totalRevenue, orderCount, includesVat }` | `totalRevenue(orders)` |
| Best-selling option (units)? | `get_best_selling_option` | – | `{ best: [{option, units}], top5 }` (ties listed) | `bestSellingOptions`, `optionUnitsRanking` |
| Revenue by payment method? | `get_revenue_by_payment_method` | – | `{ byPaymentMethod: [{paymentMethod, orders, revenue}] }` | `revenueByPaymentMethod(orders)` |
| Average order value? | `get_average_order_value` | – | `{ averageOrderValue, orderCount }` | `averageOrderValue(orders)` |
| How many orders actually got the coupon? | `get_coupon_usage` | `code?` | `{ ordersThatEnteredCode, ordersThatReceivedDiscount, discountedOrderIds, notApplied:[{orderId, reason}] }` | `couponUsage(orders, code)` |
| Orders on a given date? | `get_orders_on_date` | `date` (YYYY-MM-DD, shop TZ) | `{ date, orderCount, revenue, orders:[…] }` | `ordersOnDate(orders, date, tz)` |
| Anything the data can't answer | `explain_unanswerable` | `topic?` | fixed text from code | `unanswerableResult()` |

Money goes to the model already formatted ("1,585.00 BDT"), so it never converts poisha.

---

## ◆ D1 — Two tabs, tab B takes the last eggs while tab A is editing

**What the code does:**
- Both tabs share one server: the mock server's state lives in `localStorage` and is re-read on every request (`src/mocks/server.ts`). Every cart change bumps a `version`.
- When tab A saves, the server does one atomic swap (`PUT /api/cart/items/:id`) using the net-difference rule: free = available + A's own allocation.
- If B changed the cart, A first gets `409 VERSION_CONFLICT` with a fresh snapshot. A's Redux state updates, A sees the new stock, and A presses Save again. The server never silently overwrites.
- If eggs are still short, A gets `409 INSUFFICIENT_STOCK` with the exact list ("Short: 2 egg"). The shortage also appears live in A's builder, because B's write fires a `storage` event and A reloads the cart.
- **Nothing A typed is lost.** The draft stays in `builderSlice` (and in `localStorage`). Only the server's cart is untouched. A can lower the eggs and save, or discard.
- Tests: `server.test.ts › D1`, `store.test.ts`.

---

## ◆ D2 — When is a price locked?

**Choice: at checkout (Pay), using the server clock at that moment.**
- The cart price is never frozen at Add to cart. Every cart snapshot is priced by `priceCart` at the server's current time, so the cart view shows what you would pay now.
- That is what makes TC-06 and TC-07 consistent: the same cart gives 1,585 at 10:59:59 and 1,637 at 11:00:00.
- To avoid a surprise when the coupon expires between looking and paying, Pay sends `expectedPayable`. If the server's price at checkout differs, it refuses with `409 PRICE_CHANGED` and the new total. The UI shows why (for example, the coupon is only valid before 11:00) and the user presses Pay again.
- The stored order keeps the totals computed at its `createdAt`. After that it never changes.
- Test: `server.test.ts › D2`.

---

## ◆ D3 — A reservation expires while the user is editing that item

**What the code does:**
- Expiry is decided by the server (5 minutes on the server clock). The client schedules a cart reload right after the earliest `expiresAt`, plus a 15 s poll.
- When the edited item comes back `expired`, `selectEditingContext` switches to `edit-expired`.
- **Unsaved changes are kept.** The builder still holds the draft.
- The screen shows a warning: "This item's reservation expired. Its stock was released. Your changes are kept: save to reserve them again as a new item." The button changes to **Reserve as new item**.
- Saving does a normal Add (with a fresh idempotency key and the current free stock, with no own allocation). Then it removes the dead expired copy. If stock is now short, the user sees the exact shortage.
- The expired cart row is read-only: it can be removed but not edited.
- Test: `store.test.ts › D3`.

---

## ◆ D4 — Who creates the order id and timestamp, and how double-click on Pay is stopped

**Choice: the server creates both.**
- `id` = `ORD-<next number>`, continuing after the highest seed id (ORD-1007, …). `createdAt` = server clock in shop time (`+06:00`). The browser clock is 90 s off, and two tabs could both invent the same id, so the server is the only safe source.
- Double-click protection has three layers:
  1. The thunk's `condition` refuses to start while a checkout is pending, and the button shows a loading state.
  2. Every Pay sends an **idempotency key** kept in Redux. The key changes only after a successful checkout.
  3. The server stores `key → orderId`. A repeat returns the same order with `replayed: true` and does nothing else. Stock isn't sold or released again, and the cart isn't touched.
- Add to cart uses the same pattern (TC-13).
- Tests: `server.test.ts › TC-16`, `store.test.ts › TC-16`, `App.test.tsx › TC-16`.

---

## ◆ D5 — "Who is our best customer?"

**What the code does:**
- There is no customer field, and no tool can return a person. The tool list has `explain_unanswerable`, and the system instruction tells Gemini to use it for customers, staff, costs and similar topics.
- Function calling uses mode `ANY`, so the model must pick a tool. It can't free-write the first reply.
- When the chosen tool is not answerable, **the reply text comes from our code, not the model**. Gemini is not called a second time, so it has no chance to make up a name. The reply says orders only record time, items, payment method, coupon and totals, and lists what the bot can answer.
- If Gemini returns no function call at all, the same fixed text is used.
- Test: `App.test.tsx › TC-20` (also checks that only one Gemini call happens).

---

## ◆ D6 — Shape of a stored order

Defined in `src/domain/orders.ts` (`StoredOrder`). The export (`orders.json`) wraps all orders:

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-11-25T19:40:12.345+06:00",   // server time
  "currency": "BDT",
  "moneyUnit": "poisha",                            // every amount below is an integer
  "orderCount": 7,
  "orders": [
    {
      "id": "ORD-1006",
      "createdAt": "2026-11-22T13:10:00+06:00",
      "source": "seed",                             // "seed" | "checkout"
      "paymentMethod": "card",
      "currency": "BDT",
      "moneyUnit": "poisha",
      "couponCode": "MORNING15",                    // exactly what was entered (or null)
      "coupon": {                                   // what happened to it (null if none entered)
        "code": "MORNING15",
        "status": "outside_hours",                  // applied | outside_hours | unknown | not_best
        "message": "MORNING15 is only valid before 11:00 (Asia/Dhaka)."
      },
      "lines": [
        {
          "qty": 1,
          "options": { "croissant": 1, "omelette": 2, "...": 1 },   // same shape as the seed
          "unit": { "base": 25000, "optionsTotal": 50500, "subtotal": 75500,
                    "promotions": [{ "id": "P1", "label": "Breakfast combo", "amount": 7550 }],
                    "unitPrice": 67950 },
          "unitPrice": 67950,
          "lineTotal": 67950
        }
      ],
      "totals": {
        "subtotal": 116950,
        "discount": null,                           // or { id, label, amount }
        "discountedSubtotal": 116950,
        "vatBps": 500,
        "vat": 5848,
        "payableExact": 122798,
        "payable": 122800                           // whole BDT, still in poisha
      }
    }
  ]
}
```

**Why:**
- Integer poisha everywhere, so a reader of the file can't hit the float problem from C1.
- `options` keeps the seed's shape, so stats code reads seed and new orders the same way.
- "Coupon entered but not applied" is recorded explicitly: `couponCode` is set and `coupon.status` isn't `applied`. That is how Q8 and the bot's coupon tool count real use.
- The per-line `unit` breakdown makes each total auditable without re-running the engine.

---

## Other decisions worth defending

- **"eggs ≥ 4" counts units in the Eggs group** (Omelette x2 = 2 units), not egg ingredients. The group's own limits (2–6, step 2) are in units. B and TC-10 give the same result either way. It is data in the fixture (`conditions: [{ groupId, minUnits }]`).
- **Several active overrides on one group:** the strictest max wins (`effectiveMax`).
- **Editing an item renews its 5-minute reservation**, because an edit is a new allocation swapped in for the old one.
- **Expired items at checkout:** they are not paid and not included in totals. Pay clears them along with the paid items.
- **Revenue = sum of payable** (after discount, VAT included, rounded).
- **The bot gets no chat history.** Each question is answered from fresh data, so an old number in the conversation can't leak into a new answer (TC-18). Follow-up questions have to be self-contained.
- **Server snapshots can arrive out of order** (a slow poll after a fast edit). The client accepts only a newer `version` (or the same version at a later server time) — `isNewerSnapshot`.
