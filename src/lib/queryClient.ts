import { QueryClient } from '@tanstack/react-query';

/**
 * Общий кэш запросов. Данные считаются свежими 30 секунд: переход между страницами не перезапрашивает справочники,
 * а после изменения их сбрасывает reload(). При фокусе окна не обновляем — касса не должна дёргаться под рукой.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
