import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { SessionProvider } from './lib/session';
import { Toasts } from './ui/toast';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <SessionProvider>
        <App />
        <Toasts />
      </SessionProvider>
    </HashRouter>
  </StrictMode>,
);
