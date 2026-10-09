/**
 * Отчёты об ошибках в Sentry. Включается переменной VITE_SENTRY_DSN при сборке; без неё ничего не грузится.
 * Код Sentry подгружается отдельным файлом после запуска: касса открывается так же быстро.
 * Персональные данные не отправляются: ни IP, ни содержимое запросов.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const dsn = env.VITE_SENTRY_DSN;

type Sentry = typeof import('@sentry/react');
let sentry: Promise<Sentry> | null = null;

export function startMonitoring(): void {
  if (!dsn) return;
  sentry = import('@sentry/react').then((S) => {
    S.init({
      dsn,
      environment: env.MODE,
      release: env.VITE_RELEASE,
      sendDefaultPii: false,
      // ошибки сети у кассы в магазине — не ошибки сайта
      ignoreErrors: ['Failed to fetch', 'NetworkError', 'Load failed', 'Нет связи с сервером'],
    });
    return S;
  });
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error(error);
  sentry?.then((S) => S.captureException(error, { extra: context })).catch(() => {});
}
