import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import { SessionProvider } from './lib/session';
import { watchTheme } from './lib/theme';
import { Toasts } from './ui/toast';
import './styles.css';

watchTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <SessionProvider>
          <App />
          <Toasts />
        </SessionProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
