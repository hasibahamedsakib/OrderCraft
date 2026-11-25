import { ChatAssistant } from '../features/assistant/ChatAssistant';
import { OrderBuilder } from '../features/builder/OrderBuilder';
import { CartPanel } from '../features/cart/CartPanel';
import { InventoryPanel } from '../features/cart/InventoryPanel';
import { DemoControls } from '../features/devtools/DemoControls';
import { OrderHistory } from '../features/orders/OrderHistory';
import { AppLayout } from './AppLayout';
import { useHashView, useServerSync } from './hooks';
import s from './app.module.css';

export function App() {
  useServerSync();
  const view = useHashView();

  return (
    <AppLayout view={view} footer={<DemoControls />}>
      {view === 'order' && (
        <div className={s.orderGrid}>
          <OrderBuilder />
          <div className={s.aside}>
            <CartPanel />
            <InventoryPanel />
          </div>
        </div>
      )}
      {view === 'orders' && <OrderHistory />}
      {view === 'assistant' && <ChatAssistant />}
    </AppLayout>
  );
}
