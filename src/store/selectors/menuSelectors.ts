import { createSelector } from '@reduxjs/toolkit';
import type { Ingredient, MenuGroup, PaymentMethod, Rule } from '../../domain/types';
import type { RootState } from '../index';

const NO_GROUPS: MenuGroup[] = [];
const NO_RULES: Rule[] = [];
const NO_METHODS: PaymentMethod[] = [];
const NO_INGREDIENTS: Ingredient[] = [];

export const selectMenuStatus = (state: RootState) => state.menu.status;
export const selectMenuData = (state: RootState) => state.menu.data;
export const selectMenu = (state: RootState) => state.menu.data?.menu ?? null;
export const selectGroups = (state: RootState) => state.menu.data?.menu.groups ?? NO_GROUPS;
export const selectRules = (state: RootState) => state.menu.data?.menu.rules ?? NO_RULES;
export const selectProduct = (state: RootState) => state.menu.data?.menu.product ?? null;
export const selectIngredients = (state: RootState) => state.menu.data?.menu.ingredients ?? NO_INGREDIENTS;
export const selectPaymentMethods = (state: RootState) => state.menu.data?.paymentMethods ?? NO_METHODS;
export const selectShopTimeZone = (state: RootState) => state.menu.data?.timeZone ?? 'UTC';

export const selectGroupById = createSelector([selectGroups], (groups) => new Map(groups.map((g) => [g.id, g])));

export const selectPaymentMethodLabel = createSelector(
  [selectPaymentMethods],
  (methods) => (id: string) => methods.find((m) => m.id === id)?.label ?? id,
);
