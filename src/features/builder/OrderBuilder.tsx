import { useState, type ReactNode } from 'react';
import { Alert, Button, cx, ErrorState, LoadingState, QuantitySelector } from '../../components/ui';
import { AlertIcon, CheckIcon, LockIcon } from '../../components/ui/icons';
import { formatBDT } from '../../domain/money';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  selectBuilderQty,
  selectCanSubmit,
  selectEditingContext,
  selectShortageText,
  selectSubmit,
  selectViolations,
  selectViolationsByGroup,
} from '../../store/selectors/builderSelectors';
import { selectIngredients, selectMenu, selectMenuStatus } from '../../store/selectors/menuSelectors';
import { builderReset, itemQtySet } from '../../store/slices/builderSlice';
import { fetchMenu, submitBuilder } from '../../store/thunks';
import { formatShortages } from '../../domain/stock';
import { MenuGroup } from './MenuGroup';
import { PriceBreakdownDetails, PriceSummary } from './PricePreview';
import { ValidationMessage } from './ValidationMessage';
import s from './builder.module.css';

export function OrderBuilder() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectMenuStatus);
  const menu = useAppSelector(selectMenu);
  const error = useAppSelector((state) => state.menu.error);

  if (status === 'failed') {
    return <ErrorState title="Menu unavailable" message={error ?? 'Could not load the menu.'} onRetry={() => dispatch(fetchMenu())} />;
  }
  if (!menu) return <LoadingState label="Loading menu…" />;

  return (
    <div className={s.builder}>
      <div className={s.productCard}>
        <span className={s.productEmoji} aria-hidden="true">
          🍳
        </span>
        <div>
          <h2 className={s.productName}>{menu.product.name}</h2>
          <p className={s.productMeta}>Choose each part below. Limits and stock update as you go.</p>
        </div>
        <div className={s.productPrice}>
          <div className={s.productPriceLabel}>Base price</div>
          <div className={s.productPriceValue}>{formatBDT(menu.product.basePrice)}</div>
        </div>
      </div>

      <EditBanner />

      {menu.groups.map((group) => (
        <MenuGroup key={group.id} group={group} />
      ))}

      <ActionBar />
    </div>
  );
}

/** Edit mode and the D3 case: the item's reservation expired (or it disappeared) mid-edit. */
function EditBanner() {
  const dispatch = useAppDispatch();
  const context = useAppSelector(selectEditingContext);
  if (context.mode === 'new') return null;
  const cancel = (
    <Button size="sm" variant="ghost" onClick={() => dispatch(builderReset())}>
      Discard changes
    </Button>
  );
  if (context.mode === 'edit') {
    return (
      <Alert tone="info" title="Editing a cart item" action={cancel}>
        Its own reserved stock counts as available while you edit. Saving swaps the reservation in one step.
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      role="alert"
      title={context.mode === 'edit-expired' ? 'This item’s reservation expired' : 'This item is no longer in the cart'}
      action={cancel}
    >
      {context.mode === 'edit-expired'
        ? 'Its stock was released. Your changes are kept: save to reserve them again as a new item.'
        : 'It was removed, maybe in another tab. Your changes are kept: save to add them as a new item.'}
    </Alert>
  );
}

function ActionBar() {
  const dispatch = useAppDispatch();
  const [showDetails, setShowDetails] = useState(false);
  const menu = useAppSelector(selectMenu);
  const qty = useAppSelector(selectBuilderQty);
  const violations = useAppSelector(selectViolations);
  const byGroup = useAppSelector(selectViolationsByGroup);
  const shortageText = useAppSelector(selectShortageText);
  const submit = useAppSelector(selectSubmit);
  const canSubmit = useAppSelector(selectCanSubmit);
  const context = useAppSelector(selectEditingContext);
  const ingredients = useAppSelector(selectIngredients);
  const lastSaved = useAppSelector((state) => state.builder.lastSaved);
  const inventoryLoaded = useAppSelector((state) => state.inventory.loaded);
  if (!menu) return null;

  const general = byGroup.get('_general') ?? [];
  const submitError = submit.error;
  const submitLabel =
    context.mode === 'edit' ? 'Save changes' : context.mode === 'new' ? 'Add to cart' : 'Reserve as new item';

  let status: { tone: 'ok' | 'bad' | 'warn'; content: ReactNode };
  if (submitError) {
    status = {
      tone: submitError.code === 'RESERVATION_FAILED' || submitError.code === 'NETWORK' ? 'warn' : 'bad',
      content: (
        <>
          <span className={s.barStatusRow}>
            <AlertIcon size={14} />
            {submitError.message}
          </span>
          {submitError.shortages && submitError.shortages.length > 0 && (
            <strong>{formatShortages(submitError.shortages, ingredients)}</strong>
          )}
        </>
      ),
    };
  } else if (violations.length > 0) {
    status = {
      tone: 'bad',
      content: (
        <>
          <span className={s.barStatusRow}>
            <AlertIcon size={14} />
            {violations.length === 1 ? '1 issue to fix before adding' : `${violations.length} issues to fix before adding`}
          </span>
          <ValidationMessage violations={general} />
        </>
      ),
    };
  } else if (shortageText) {
    status = {
      tone: 'bad',
      content: (
        <span className={s.barStatusRow}>
          <LockIcon size={14} />
          Not enough stock. <strong>{shortageText}</strong>
        </span>
      ),
    };
  } else if (lastSaved) {
    status = {
      tone: 'ok',
      content: (
        <span className={s.barStatusRow}>
          <CheckIcon size={14} />
          {lastSaved === 'added' ? 'Added to cart. Stock is reserved for 5 minutes.' : 'Changes saved.'}
        </span>
      ),
    };
  } else {
    status = {
      tone: 'ok',
      content: (
        <span className={s.barStatusRow}>
          <CheckIcon size={14} />
          {inventoryLoaded ? 'Ready to add' : 'Checking stock…'}
        </span>
      ),
    };
  }

  return (
    <section className={s.bar} aria-label="Your item">
      <div
        className={cx(s.barStatus, status.tone === 'ok' ? s.barStatusOk : status.tone === 'warn' ? s.barStatusWarn : s.barStatusBad)}
        role={status.tone === 'ok' ? 'status' : 'alert'}
      >
        {status.content}
      </div>
      <div className={s.barMain}>
        <div className={cx(s.barField, s.barPrice)}>
          <PriceSummary />
          <button type="button" className={s.detailsToggle} onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
            {showDetails ? 'Hide price details' : 'Price details'}
          </button>
        </div>
        <div className={s.barField}>
          <span className={s.barLabel}>Quantity</span>
          <QuantitySelector
            label="Item quantity"
            value={qty}
            min={menu.product.minQty}
            max={menu.product.maxQty}
            onChange={(next) => dispatch(itemQtySet(next))}
          />
        </div>
        <div className={s.barActions}>
          <Button variant="ghost" onClick={() => dispatch(builderReset())} disabled={submit.status === 'pending'}>
            {context.mode === 'new' ? 'Clear' : 'Cancel'}
          </Button>
          <Button
            variant="accent"
            size="lg"
            onClick={() => dispatch(submitBuilder())}
            disabled={!canSubmit}
            loading={submit.status === 'pending'}
          >
            {submitError && submitError.code !== 'INSUFFICIENT_STOCK' && submitError.code !== 'VALIDATION_FAILED'
              ? 'Retry'
              : submitLabel}
          </Button>
        </div>
      </div>
      {showDetails && (
        <div className={s.breakdown}>
          <PriceBreakdownDetails />
        </div>
      )}
    </section>
  );
}
