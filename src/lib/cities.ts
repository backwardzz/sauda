import { useEffect, useState } from 'react';
import { db, q } from './supabase';
import type { City } from './types';

let cache: Promise<City[]> | null = null;

interface Row {
  id: number;
  name: string;
  region_id: number;
  regions: { name: string; sort: number };
}

/** Справочник областей и городов меняется только миграциями: загружается один раз за сеанс. */
export function loadCities(): Promise<City[]> {
  cache ??= q<Row[]>(db.from('cities').select('id, name, region_id, regions(name, sort)') as never).then(
    // порядок областей задан в базе (regions.sort): города республиканского значения — первыми
    (list) =>
      list
        .map((c) => ({ id: c.id, name: c.name, region_id: c.region_id, region: c.regions.name, region_sort: c.regions.sort }))
        .sort((a, b) => a.region_sort - b.region_sort || a.name.localeCompare(b.name, 'ru')),
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

/** «Алматы» или «Семей, Абайская область»: у городов республиканского значения область не подписывается. */
export function cityLabel(cities: City[], id: number | null | undefined): string {
  const c = cities.find((x) => x.id === id);
  return !c ? '' : c.region_sort === 0 ? c.name : `${c.name}, ${c.region}`;
}
