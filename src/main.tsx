import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { startMonitoring } from './lib/monitoring';
import { queryClient } from './lib/queryClient';
import { SessionProvider } from './lib/session';
import { watchTheme } from './lib/theme';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Toasts } from './ui/toast';
import './styles.css';

startMonitoring();
watchTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <SessionProvider>
            <App />
            <Toasts />
          </SessionProvider>
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
