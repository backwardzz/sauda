import { useEffect, useState } from 'react';
import { db, q } from './supabase';
import type { City } from './types';

let cache: Promise<City[]> | null = null;

/** Справочник городов меняется только миграциями: загружается один раз за сеанс. */
export function loadCities(): Promise<City[]> {
  cache ??= q<City[]>(db.from('cities').select('*').order('name')).then(
    // города республиканского значения — в начале списка
    (list) => [...list].sort((a, b) => Number(Boolean(a.region)) - Number(Boolean(b.region)) || a.name.localeCompare(b.name, 'ru')),
    (e) => {
      cache = null;
      throw e;
    },
  );
  return cache;
}

export function useCities(): City[] {
  const [list, setList] = useState<City[]>([]);
  useEffect(() => {
    let alive = true;
    loadCities().then((l) => alive && setList(l)).catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export const cityName = (cities: City[], id: number | null | undefined) => cities.find((c) => c.id === id)?.name ?? '';
