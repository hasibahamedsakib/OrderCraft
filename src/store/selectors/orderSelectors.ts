import { createSelector } from '@reduxjs/toolkit';
import { averageOrderValue, couponUsage, totalRevenue } from '../../domain/stats';
import type { RootState } from '../index';

export const selectOrders = (state: RootState) => state.orders.items;

export const selectOrdersNewestFirst = createSelector([selectOrders], (orders) =>
  [...orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
);

export const selectOrderStats = createSelector([selectOrders], (orders) => {
  const coupons = couponUsage(orders);
  return {
    count: orders.length,
    revenue: totalRevenue(orders),
    average: averageOrderValue(orders),
    couponApplied: coupons.ordersDiscounted,
    couponEntered: coupons.ordersWithCode,
  };
});
