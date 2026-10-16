import { useCallback, useState } from 'react';
import { toast } from './toast';

interface Options {
  /**
   * Не снимать блокировку после успеха: экран после действия закрывается или уходит на другую страницу,
   * и кнопка не должна успеть нажаться второй раз.
   */
  keepBusy?: boolean;
  /** Показать ошибку по-своему (например, строкой в форме) вместо всплывающего сообщения. */
  onError?: (e: unknown) => void;
}

/**
 * Действие по кнопке: на время запроса блокирует кнопки (busy), ошибку показывает всплывающим сообщением.
 * run возвращает true, если действие удалось, — по нему вызывающий решает, что делать после сбоя.
 */
export function useAction(initialBusy = false): [boolean, (fn: () => unknown, options?: Options) => Promise<boolean>] {
  const [busy, setBusy] = useState(initialBusy);
  const run = useCallback(async (fn: () => unknown, options?: Options) => {
    setBusy(true);
    try {
      await fn();
      if (!options?.keepBusy) setBusy(false);
      return true;
    } catch (e) {
      if (options?.onError) options.onError(e);
      else toast.error(e);
      setBusy(false);
      return false;
    }
  }, []);
  return [busy, run];
}
