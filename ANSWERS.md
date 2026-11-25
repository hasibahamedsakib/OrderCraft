# ANSWERS

Every number here is printed by running the real engines:

```bash
pnpm answers        # runs src/answers/answers.test.ts and prints Q1–Q8
```

The same file asserts each value, so the answers stay pinned by tests. Money is computed in integer poisha and shown in BDT.

## Q1. Maximum number of item C from an empty cart

**2 units, limited by cheese.**

C uses, per unit: egg 2, paratha 1, tofu 1, cheese 2, baked beans 1, mushroom 1.
Cheese stock is 4, so floor(4 / 2) = **2**. Eggs alone would allow floor(10 / 2) = 5.
On the mock server, C x2 reserves fine. One more C is refused with `409 "Short: 2 cheese"`.

Code: `maxUnitsOf` / `limitingIngredients` in `src/domain/stock.ts`.

## Q2. Cheapest valid configuration and its unit price

**Toast + Fried x2 + Tofu = 360.00 BDT.**

The test builds every combination each group allows on its own (1,368,570 of them), runs `validate()` on each, and prices the valid ones with `priceUnit()`.
Working: 250 base + Toast 0 + Fried 2 × 30 + Tofu 50 = 360.00. No promotion applies.
Adding Ketchup (0 BDT) gives the same price, so "Toast, Fried x2, Tofu" is the cheapest with or without a free sauce.

## Q3. Cart = A x3, at 10:30 and at 11:30 (MORNING15 entered)

A = 250 + Toast 0 + Scrambled 2 × 35 + Chicken Sausage 60 + Ketchup 0 = **380.00**. It has 0 extras, so P2 doesn't apply. It has 2 egg units and 1 protein, so P1 doesn't apply.

Subtotal = 3 × 380.00 = **1,140.00**. That is below 1,200.00, so C1 isn't eligible at either time.

**10:30 (server time, Asia/Dhaka):**

| Step | Working | Result |
|---|---|---|
| C2 | 15% of 1,140.00 = 171.00, capped at 150.00 | **150.00** |
| Chosen discount | only C2 is eligible | **C2 150.00** |
| Discounted subtotal | 1,140.00 − 150.00 | 990.00 |
| VAT 5% | 990.00 × 0.05 = 49.50 (exact) | **49.50** |
| Payable | 990.00 + 49.50 = 1,039.50 → half-up to whole BDT | **1,040** |

**11:30:**

| Step | Working | Result |
|---|---|---|
| C2 | 11:30 is not strictly before 11:00 → rejected | 0 |
| C1 | 1,140.00 < 1,200.00 | not eligible |
| Chosen discount | none | **none** |
| VAT 5% | 1,140.00 × 0.05 | **57.00** |
| Payable | 1,140.00 + 57.00 = 1,197.00 | **1,197** |

## Q4. After TC-10, payable at 11:30

B' (Omelette x1 + Fried x3) = 643.50. C x2 = 980.00. Subtotal **1,623.50**.
The coupon is irrelevant at 11:30. C1 applies (1,623.50 ≥ 1,200), so 100.00 off gives **1,523.50**.
VAT = 5% of 1,523.50 = 76.175 → **76.18**. Payable = 1,599.68 → **1,600**.

## Q5. Payable of each seed order, and total revenue

Each seed order is priced with `priceCart` at its own `createdAt`.

| Order | Time (Dhaka) | Payment | Coupon | Subtotal | Discount | VAT | Exact | **Payable** |
|---|---|---|---|---|---|---|---|---|
| ORD-1001 | 20 Nov 09:15 | card | MORNING15 | 380.00 | C2 57.00 | 16.15 | 339.15 | **339** |
| ORD-1002 | 20 Nov 12:40 | bkash | — | 679.50 | none | 33.98 | 713.48 | **713** |
| ORD-1003 | 21 Nov 10:05 | cash | MORNING15 | 1,360.00 | C2 150.00 | 60.50 | 1,270.50 | **1,271** |
| ORD-1004 | 21 Nov 19:30 | card | — | 550.00 | none | 27.50 | 577.50 | **578** |
| ORD-1005 | 22 Nov 08:50 | bkash | MORNING15 | 970.00 | C2 145.50 | 41.23 | 865.73 | **866** |
| ORD-1006 | 22 Nov 13:10 | card | MORNING15 | 1,169.50 | none | 58.48 | 1,227.98 | **1,228** |

**Total revenue of all six: 4,995.00 BDT.** Revenue means the sum of payables, VAT included.

## Q6. Best-selling option (units = line qty × option qty)

**Fried, 10 units.**
Full ranking: Fried 10, Chicken Sausage 8, Scrambled 8, Cheese 6, Omelette 6, Mushroom 5, Hollandaise 4, Paratha 4, then Baked Beans, Beef Bacon, Croissant, Hash Brown, Toast and Tofu at 3 each, then Chili and Ketchup at 2 each.

## Q7. Payment method with the most revenue

**Card: 2,145.00 BDT** (3 orders). bKash: 1,579.00 (2 orders). Cash: 1,271.00 (1 order).

## Q8. How many seed orders actually received MORNING15?

**3 of the 4 orders that entered the code: ORD-1001, ORD-1003 and ORD-1005.**

| Order | Time | Subtotal | C1 (≥ 1,200 → 100) | C2 (15%, cap 150, before 11:00) | Result |
|---|---|---|---|---|---|
| ORD-1001 | 09:15 | 380.00 | not eligible | 57.00 | **C2 applied** |
| ORD-1003 | 10:05 | 1,360.00 | 100.00 | 204.00 → capped 150.00 | **C2 applied** (150 > 100) |
| ORD-1005 | 08:50 | 970.00 | not eligible | 145.50 | **C2 applied** |
| ORD-1006 | 13:10 | 1,169.50 | not eligible | **rejected**: 13:10 is not before 11:00 | **no discount** |

**ORD-1006 has the code but got no discount.** It was placed at 13:10 Dhaka time, and MORNING15 is only valid strictly before 11:00. C1 couldn't step in either, because 1,169.50 is below the 1,200.00 threshold.
The stored order keeps `couponCode: "MORNING15"` with `coupon.status: "outside_hours"`, so the export shows that the code was entered but not applied.
