import { Component, type ReactNode } from 'react';
import { reportError } from '../lib/monitoring';

interface State {
  error: Error | null;
}

/** Ошибка при отрисовке страницы: вместо белого экрана — объяснение и кнопка перезагрузки. Чек в кассе хранится в браузере и не теряется. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <div className="auth-card stack">
          <h1>Что-то пошло не так</h1>
          <p className="muted">Страница не открылась из-за ошибки. Обновите её — открытый чек в кассе сохранится.</p>
          <button className="btn primary large" onClick={() => location.reload()}>Обновить страницу</button>
        </div>
      </div>
    );
  }
}
