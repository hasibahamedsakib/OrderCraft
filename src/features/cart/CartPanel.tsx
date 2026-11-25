import { Alert, Badge, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { CartIcon } from '../../components/ui/icons';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectActiveItems, selectCartItems, selectCartPricing, selectExpiredItems } from '../../store/selectors/cartSelectors';
import { fetchCart } from '../../store/thunks';
import { CartItem } from './CartItem';
import { CheckoutForm } from './CheckoutForm';
import { CouponForm } from './CouponForm';
import { PriceBreakdown } from './PriceBreakdown';
import s from './cart.module.css';

export function CartPanel() {
  const dispatch = useAppDispatch();
  const items = useAppSelector(selectCartItems);
  const active = useAppSelector(selectActiveItems);
  const expired = useAppSelector(selectExpiredItems);
  const pricing = useAppSelector(selectCartPricing);
  const loadStatus = useAppSelector((state) => state.cart.loadStatus);
  const loadError = useAppSelector((state) => state.cart.loadError);
  const checkoutState = useAppSelector((state) => state.cart.checkout);

  let body;
  if (loadStatus === 'failed') {
    body = <ErrorState title="Cart unavailable" message={loadError ?? 'Could not load the cart.'} onRetry={() => dispatch(fetchCart())} />;
  } else if (loadStatus !== 'succeeded') {
    body = <LoadingState label="Loading cart…" />;
  } else if (items.length === 0) {
    body = (
      <>
        {checkoutState.status === 'succeeded' && checkoutState.lastOrderId && (
          <Alert tone="success" role="status" title={`Order ${checkoutState.lastOrderId} placed`}>
            Stock is now sold. <a href="#/orders">View orders</a>
          </Alert>
        )}
        <EmptyState icon={<CartIcon size={20} />} title="Your cart is empty">
          Build a breakfast and add it. Ingredients are held for 5 minutes once added.
        </EmptyState>
      </>
    );
  } else {
    body = (
      <>
        <ul className={s.items}>
          {items.map((item, index) => (
            <CartItem key={item.id} item={item} index={index} />
          ))}
        </ul>

        {expired.length > 0 && (
          <div className={s.section}>
            <Alert tone="warning">
              {expired.length === 1 ? '1 expired item is' : `${expired.length} expired items are`} not included in the total
              or the payment.
            </Alert>
          </div>
        )}

        <div className={s.section}>
          <h3 className={s.sectionTitle}>Coupon</h3>
          <CouponForm disabled={active.length === 0} />
        </div>

        {pricing && active.length > 0 && (
          <div className={s.section}>
            <h3 className={s.sectionTitle}>Summary</h3>
            <PriceBreakdown pricing={pricing} />
          </div>
        )}

        <div className={s.section}>
          <h3 className={s.sectionTitle}>Payment</h3>
          <CheckoutForm />
        </div>
      </>
    );
  }

  return (
    <Card
      title="Cart"
      labelledBy="cart-title"
      subtitle={active.length > 0 ? `${active.length} active ${active.length === 1 ? 'item' : 'items'}` : undefined}
      actions={items.length > 0 ? <Badge tone="neutral">{items.length}</Badge> : undefined}
    >
      {body}
    </Card>
  );
}
