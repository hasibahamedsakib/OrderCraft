import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertIcon, CheckIcon, InfoIcon, MinusIcon, PlusIcon, RefreshIcon } from './icons';
import s from './ui.module.css';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
export { cx };

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.button, s[size], s[variant], block && s.block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={s.spinner} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className={s.spinner} />
  );
}

/* ---------- Badge ---------- */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const toneClass: Record<Tone, string | undefined> = {
  neutral: s.neutral,
  success: s.success,
  warning: s.warning,
  danger: s.dangerTone,
  info: s.info,
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={cx(s.badge, toneClass[tone])} title={title}>
      {children}
    </span>
  );
}

/* ---------- Card ---------- */

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'aside';
  labelledBy?: string;
}

export function Card({ title, subtitle, actions, children, className, bodyClassName, as: Tag = 'section', labelledBy }: CardProps) {
  return (
    <Tag className={cx(s.card, className)} aria-labelledby={labelledBy}>
      {(title || actions) && (
        <header className={s.cardHeader}>
          <div>
            {title && (
              <h2 className={s.cardTitle} id={labelledBy}>
                {title}
              </h2>
            )}
            {subtitle && <p className={s.cardSubtitle}>{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cx(s.cardBody, bodyClassName)}>{children}</div>
    </Tag>
  );
}

/* ---------- Alert ---------- */

const alertTone: Record<Tone, { className: string | undefined; icon: ReactNode }> = {
  neutral: { className: s.neutral, icon: <InfoIcon /> },
  info: { className: s.info, icon: <InfoIcon /> },
  success: { className: s.success, icon: <CheckIcon /> },
  warning: { className: s.warning, icon: <AlertIcon /> },
  danger: { className: s.dangerTone, icon: <AlertIcon /> },
};

interface AlertProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** 'alert' for errors that need attention now, 'status' for polite updates. */
  role?: 'alert' | 'status';
}

export function Alert({ tone = 'info', title, children, action, role }: AlertProps) {
  const t = alertTone[tone];
  return (
    <div className={cx(s.alert, t.className)} role={role}>
      {t.icon}
      <div className={s.alertBody}>
        {title && <div className={s.alertTitle}>{title}</div>}
        {children}
      </div>
      {action && <div className={s.alertAction}>{action}</div>}
    </div>
  );
}

/* ---------- QuantitySelector ---------- */

interface QuantitySelectorProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Extra reasons to block +/- (stock, rules), on top of min/max. */
  incrementDisabled?: boolean;
  decrementDisabled?: boolean;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function QuantitySelector({
  value,
  onChange,
  min = 0,
  max = Infinity,
  incrementDisabled,
  decrementDisabled,
  label,
  size = 'md',
  disabled,
}: QuantitySelectorProps) {
  return (
    <div className={cx(s.qty, size === 'sm' && s.qtySm)} role="group" aria-label={label}>
      <button
        type="button"
        className={s.qtyButton}
        onClick={() => onChange(value - 1)}
        disabled={disabled || decrementDisabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        <MinusIcon size={14} />
      </button>
      <span className={s.qtyValue} aria-live="polite" aria-label={`${label}: ${value}`}>
        {value}
      </span>
      <button
        type="button"
        className={s.qtyButton}
        onClick={() => onChange(value + 1)}
        disabled={disabled || incrementDisabled || value >= max}
        aria-label={`Increase ${label}`}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}

/* ---------- Loading / Empty / Error ---------- */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={s.state} role="status">
      <span className={s.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className={s.state}>
      {icon && <div className={s.stateIcon}>{icon}</div>}
      <div className={s.stateTitle}>{title}</div>
      {children && <div className={s.stateText}>{children}</div>}
      {action && <div className={s.stateAction}>{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, retrying }: ErrorStateProps) {
  return (
    <div className={s.state} role="alert">
      <div className={cx(s.stateIcon, s.stateIconDanger)}>
        <AlertIcon size={20} />
      </div>
      <div className={s.stateTitle}>{title}</div>
      <div className={s.stateText}>{message}</div>
      {onRetry && (
        <div className={s.stateAction}>
          <Button onClick={onRetry} loading={retrying} icon={<RefreshIcon size={14} />}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14 }: { width?: number | string; height?: number }) {
  return <span className={s.skeleton} style={{ width, height }} aria-hidden="true" />;
}

/* ---------- Segmented radio group ---------- */

interface SegmentedProps {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function Segmented({ name, label, options, value, onChange, disabled }: SegmentedProps) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={s.segment}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
