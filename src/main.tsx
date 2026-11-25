import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { App } from './app/App';
import { startMockServer } from './mocks/browser';
import { makeStore } from './store';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);

startMockServer()
  .then(() => {
    const store = makeStore();
    root.render(
      <StrictMode>
        <Provider store={store}>
          <App />
        </Provider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error(error);
    root.render(
      <div style={{ padding: 32, fontFamily: 'system-ui' }}>
        <h1>OrderCraft could not start</h1>
        <p>The mock server (MSW service worker) failed to start. Use a modern browser on http://localhost.</p>
      </div>,
    );
  });
