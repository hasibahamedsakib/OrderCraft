import { useState } from 'react';
import { Alert, Button, Segmented } from '../../components/ui';
import { LockIcon } from '../../components/ui/icons';
import { formatBDT } from '../../domain/money';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectActiveItems, selectCartPricing } from '../../store/selectors/cartSelectors';
import { selectPaymentMethods } from '../../store/selectors/menuSelectors';
import { checkoutErrorDismissed } from '../../store/slices/cartSlice';
import { checkout } from '../../store/thunks';
import s from './cart.module.css';

export function CheckoutForm() {
  const dispatch = useAppDispatch();
  const methods = useAppSelector(selectPaymentMethods);
  const pricing = useAppSelector(selectCartPricing);
  const active = useAppSelector(selectActiveItems);
  const state = useAppSelector((st) => st.cart.checkout);
  const [method, setMethod] = useState<string | null>(null);
  const chosen = method ?? methods[0]?.id ?? null;
  const pending = state.status === 'pending';
  const error = state.error;

  return (
    <div className={s.checkout}>
      <Segmented
        name="payment-method"
        label="Payment method"
        options={methods.map((m) => ({ value: m.id, label: m.label }))}
        value={chosen}
        onChange={(value) => {
          setMethod(value);
          dispatch(checkoutErrorDismissed());
        }}
        disabled={pending}
      />

      {error && (
        <Alert
          role="alert"
          tone={error.code === 'PRICE_CHANGED' || error.code === 'VERSION_CONFLICT' ? 'warning' : 'danger'}
          title={
            error.code === 'PRICE_CHANGED'
              ? 'The price changed'
              : error.code === 'VERSION_CONFLICT'
                ? 'Cart updated in another tab'
                : 'Payment did not go through'
          }
        >
          {error.code === 'PRICE_CHANGED'
            ? `${pricing?.coupon && pricing.coupon.status !== 'applied' ? `${pricing.coupon.message} ` : ''}The new total is ${
                pricing ? formatBDT(pricing.payable) : 'shown above'
              }. Review it and press Pay again.`
            : error.code === 'VERSION_CONFLICT'
              ? 'We loaded the latest cart. Check it, then press Pay again.'
              : error.message}
        </Alert>
      )}

      <Button
        variant="accent"
        size="lg"
        block
        icon={<LockIcon size={15} />}
        loading={pending}
        disabled={!chosen || active.length === 0 || !pricing}
        onClick={() => chosen && dispatch(checkout({ paymentMethod: chosen }))}
      >
        {pricing && active.length > 0 ? `Pay ${formatBDT(pricing.payable)}` : 'Pay'}
      </Button>
    </div>
  );
}
