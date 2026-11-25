import { useState, type FormEvent } from 'react';
import { Badge, Button, type Tone } from '../../components/ui';
import type { CouponResult } from '../../domain/pricing';
import { formatBDT } from '../../domain/money';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectCartPricing } from '../../store/selectors/cartSelectors';
import { applyCoupon } from '../../store/thunks';
import s from './cart.module.css';

const STATUS: Record<CouponResult['status'], { tone: Tone; label: string }> = {
  applied: { tone: 'success', label: 'Applied' },
  not_best: { tone: 'info', label: 'Not used' },
  outside_hours: { tone: 'warning', label: 'Not valid now' },
  unknown: { tone: 'danger', label: 'Invalid' },
};

export function CouponBadge({ coupon, discountAmount }: { coupon: CouponResult; discountAmount?: number }) {
  const status = STATUS[coupon.status];
  return (
    <Badge tone={status.tone} title={coupon.message}>
      {coupon.code.toUpperCase()} · {status.label}
      {coupon.status === 'applied' && discountAmount ? ` −${formatBDT(discountAmount)}` : ''}
    </Badge>
  );
}

export function CouponForm({ disabled }: { disabled?: boolean }) {
  const dispatch = useAppDispatch();
  const [code, setCode] = useState('');
  const couponCode = useAppSelector((state) => state.cart.couponCode);
  const pricing = useAppSelector(selectCartPricing);
  const status = useAppSelector((state) => state.cart.coupon);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    void dispatch(applyCoupon({ code: code.trim() })).then(() => setCode(''));
  };

  if (couponCode) {
    const result = pricing?.coupon;
    return (
      <div className={s.coupon}>
        <div className={s.couponApplied}>
          {result ? <CouponBadge coupon={result} discountAmount={pricing?.discount?.amount} /> : <Badge>{couponCode}</Badge>}
          <Button size="sm" variant="ghost" onClick={() => dispatch(applyCoupon({ code: null }))} loading={status.status === 'pending'}>
            Remove
          </Button>
        </div>
        {result && result.status !== 'applied' && <p className={s.couponText}>{result.message}</p>}
        {result?.status === 'applied' && (
          <p className={s.couponText}>Checked again at payment against the server clock.</p>
        )}
      </div>
    );
  }

  return (
    <form className={s.coupon} onSubmit={submit}>
      <label htmlFor="coupon-code" className="visually-hidden">
        Coupon code
      </label>
      <div className={s.couponRow}>
        <input
          id="coupon-code"
          className={s.input}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Coupon code"
          autoComplete="off"
          disabled={disabled}
        />
        <Button type="submit" variant="secondary" loading={status.status === 'pending'} disabled={disabled || !code.trim()}>
          Apply
        </Button>
      </div>
      {status.error && (
        <p className={s.couponText} role="alert">
          {status.error}
        </p>
      )}
    </form>
  );
}
