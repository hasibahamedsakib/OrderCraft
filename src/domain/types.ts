/**
 * Domain types. Everything here is data that comes from the mock API;
 * nothing in the engine knows option ids, names or limits.
 * All money values are integer poisha (1 BDT = 100 poisha).
 */

export type Poisha = number;
export type OptionId = string;
export type GroupId = string;
export type IngredientId = string;

/** optionId -> quantity chosen for one unit of the product. */
export type Selection = Record<OptionId, number>;

/** ingredientId -> amount. */
export type IngredientAmounts = Record<IngredientId, number>;

export interface Product {
  id: string;
  name: string;
  basePrice: Poisha;
  minQty: number;
  maxQty: number;
}

export interface Ingredient {
  id: IngredientId;
  name: string;
}

export interface MenuOption {
  id: OptionId;
  name: string;
  price: Poisha;
  /** Ingredient use for ONE unit of this option. */
  uses: IngredientAmounts;
}

export interface MenuGroup {
  id: GroupId;
  name: string;
  min: number;
  /** null = no total limit. */
  max: number | null;
  /** Total must be a multiple of step. */
  step?: number;
  maxDistinct?: number;
  maxPerOption?: number;
  options: MenuOption[];
}

export interface RequiresRule {
  id: string;
  type: 'requires';
  option: OptionId;
  anyOf: OptionId[];
}

export interface ExcludesRule {
  id: string;
  type: 'excludes';
  option: OptionId;
  options: OptionId[];
}

export interface OverrideLimitRule {
  id: string;
  type: 'overrideLimit';
  option: OptionId;
  group: GroupId;
  max: number;
}

export type Rule = RequiresRule | ExcludesRule | OverrideLimitRule;

export interface Menu {
  product: Product;
  ingredients: Ingredient[];
  groups: MenuGroup[];
  rules: Rule[];
}

/* ---------- promotions ---------- */

/** Per unit: for every `every` units in the group, the cheapest `freeUnits` are free. */
export interface FreeCheapestUnitsPromotion {
  id: string;
  type: 'freeCheapestUnits';
  label: string;
  groupId: GroupId;
  every: number;
  freeUnits: number;
}

/** Per unit: percent off the running unit amount when every condition holds. */
export interface ComboPercentOffPromotion {
  id: string;
  type: 'comboPercentOff';
  label: string;
  /** Counted in option units chosen in the group (e.g. Omelette x2 = 2 units). */
  conditions: { groupId: GroupId; minUnits: number }[];
  /** Basis points: 1000 = 10%. */
  percentBps: number;
}

export type ItemPromotion = FreeCheapestUnitsPromotion | ComboPercentOffPromotion;

export interface ThresholdAmountOffDiscount {
  id: string;
  type: 'thresholdAmountOff';
  label: string;
  minSubtotal: Poisha;
  amountOff: Poisha;
  /** Lower wins a tie. */
  priority: number;
}

export interface CouponPercentOffDiscount {
  id: string;
  type: 'couponPercentOff';
  label: string;
  code: string;
  percentBps: number;
  cap: Poisha;
  /** "HH:MM" in timeZone; valid only strictly before this time. */
  validBefore: string;
  timeZone: string;
  priority: number;
}

export type CartDiscount = ThresholdAmountOffDiscount | CouponPercentOffDiscount;

export interface Promotions {
  /** Applied in array order (the brief's step 2 then step 3). */
  itemPromotions: ItemPromotion[];
  cartDiscounts: CartDiscount[];
  vatBps: number;
}

export interface PaymentMethod {
  id: string;
  label: string;
}

/* ---------- cart input for pricing ---------- */

export interface CartLineInput {
  qty: number;
  options: Selection;
}

export interface CartInput {
  lines: CartLineInput[];
  couponCode: string | null;
}
