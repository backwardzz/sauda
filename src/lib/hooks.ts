import { useQuery as useTanstackQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './supabase';

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Изменились ли значения с прошлой отрисовки. Состояние, которое зависит от них (номер страницы при смене фильтра,
 * текст поля при новом значении), правится прямо при отрисовке, а не эффектом: эффект дал бы лишнюю отрисовку
 * со старым состоянием (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
 * onMount: true — первая отрисовка тоже считается изменением.
 */
export function useChanged(deps: unknown[], onMount = false): boolean {
  const [prev, setPrev] = useState<unknown[] | null>(onMount ? null : deps);
  if (prev && prev.length === deps.length && prev.every((v, i) => Object.is(v, deps[i]))) return false;
  setPrev(deps);
  return true;
}

/** Загрузка данных с отбрасыванием устаревших ответов. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  if (useChanged([...deps, tick]) && !loading) setLoading(true);

  useEffect(() => {
    const id = ++seq.current;
    fn()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (id === seq.current) setError(errorText(e));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

/**
 * Загрузка через общий кэш: одинаковый ключ — одни данные на всех страницах, повторный заход берёт их из кэша.
 * Ключ должен включать всё, от чего зависит запрос (организацию, фильтры). reload() сбрасывает ключ везде, где он показан.
 */
export function useCached<T>(key: QueryKey, fn: () => Promise<T>): QueryState<T> {
  const client = useQueryClient();
  const res = useTanstackQuery({ queryKey: key, queryFn: fn });
  const keyText = JSON.stringify(key);
  const reload = useCallback(
    () => void client.invalidateQueries({ queryKey: JSON.parse(keyText) as QueryKey }),
    [client, keyText],
  );
  return { data: res.data, loading: res.isPending, error: res.error ? errorText(res.error) : null, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // без хранилища настройка живёт до перезагрузки
      }
    },
    [key],
  );
  return [value, set];
}
