import type { City } from './types';

/** Строка company_geo: заказы одного магазина по одному товару в одном городе. */
export interface GeoSale {
  city_id: number | null;
  product_id: string;
  store_org: string;
  qty: number;
  sum: number;
  orders: number;
}

export interface GeoMarket {
  city_id: number;
  stores: number;
}

export interface GeoData {
  sales: GeoSale[];
  market: GeoMarket[];
}

/** Итог по территории или товару. buyers — магазины с заказами, stores — все магазины площадки на территории. */
export interface GeoTotal {
  qty: number;
  sum: number;
  buyers: number;
  stores: number;
}

export interface GeoCity extends GeoTotal {
  id: number;
  name: string;
}

export interface GeoRegion extends GeoTotal {
  id: number;
  name: string;
  sort: number;
  cities: GeoCity[];
}

/** Область для точек, у которых город не указан. */
export const NO_REGION = -1;
const NO_CITY = -1;

export type Area = { kind: 'region' | 'city'; id: number } | null;

/**
 * Территория верхнего уровня для города: его область. Алматы, Астана и Шымкент — сами себе территория
 * (id отрицательный, чтобы не пересекаться с областями), а не общая строка «Города республиканского значения».
 */
function territory(city: City | undefined): { id: number; name: string; sort: number } {
  if (!city) return { id: NO_REGION, name: 'Город не указан', sort: 9999 };
  return city.region_sort === 0
    ? { id: -1000 - city.id, name: city.name, sort: 0 }
    : { id: city.region_id, name: city.region, sort: city.region_sort };
}

/** Попадает ли город в выбранную территорию. */
export function inArea(area: Area, cityId: number | null, cities: Map<number, City>): boolean {
  if (!area) return true;
  if (area.kind === 'city') return (cityId ?? NO_CITY) === area.id;
  return territory(cityId == null ? undefined : cities.get(cityId)).id === area.id;
}

/**
 * Области и города: заказы (по всем товарам или по одному) и охват магазинов.
 * В список попадают и города без заказов, если в них есть магазины площадки, — это и есть «белые пятна».
 */
export function byRegion(data: GeoData, cities: City[], productIds: Set<string> | null): GeoRegion[] {
  const cityMap = new Map(cities.map((c) => [c.id, c]));
  const acc = new Map<number, { qty: number; sum: number; buyers: Set<string>; stores: number }>();
  const cell = (id: number) => {
    let c = acc.get(id);
    if (!c) acc.set(id, (c = { qty: 0, sum: 0, buyers: new Set(), stores: 0 }));
    return c;
  };
  for (const m of data.market) cell(m.city_id).stores = Number(m.stores);
  for (const s of data.sales) {
    if (productIds && !productIds.has(s.product_id)) continue;
    const c = cell(s.city_id ?? NO_CITY);
    c.qty += Number(s.qty);
    c.sum += Number(s.sum);
    c.buyers.add(s.store_org);
  }

  const regions = new Map<number, GeoRegion & { buyerSet: Set<string> }>();
  for (const [id, c] of acc) {
    const city = cityMap.get(id);
    const t = territory(city);
    let r = regions.get(t.id);
    if (!r) regions.set(t.id, (r = { ...t, qty: 0, sum: 0, buyers: 0, stores: 0, cities: [], buyerSet: new Set() }));
    // магазин с заказами считается и в общем числе магазинов, даже если его точка без города
    const stores = Math.max(c.stores, c.buyers.size);
    r.cities.push({ id, name: city?.name ?? 'Город не указан', qty: c.qty, sum: c.sum, buyers: c.buyers.size, stores });
    r.qty += c.qty;
    r.sum += c.sum;
    r.stores += stores;
    for (const b of c.buyers) r.buyerSet.add(b);
  }
  return [...regions.values()]
    .map(({ buyerSet, ...r }) => ({ ...r, buyers: buyerSet.size, cities: r.cities.sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name, 'ru')) }))
    .sort((a, b) => b.sum - a.sum || a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
}

/** Товары на выбранной территории: сколько заказали и сколько магазинов заказывало. */
export function byProduct(data: GeoData, cities: City[], area: Area): Map<string, GeoTotal> {
  const cityMap = new Map(cities.map((c) => [c.id, c]));
  const acc = new Map<string, { qty: number; sum: number; buyers: Set<string> }>();
  for (const s of data.sales) {
    if (!inArea(area, s.city_id, cityMap)) continue;
    let p = acc.get(s.product_id);
    if (!p) acc.set(s.product_id, (p = { qty: 0, sum: 0, buyers: new Set() }));
    p.qty += Number(s.qty);
    p.sum += Number(s.sum);
    p.buyers.add(s.store_org);
  }
  return new Map([...acc].map(([id, p]) => [id, { qty: p.qty, sum: p.sum, buyers: p.buyers.size, stores: 0 }]));
}

/** Ячейки таблицы «товар × область»: ключ `${product_id}:${region_id}`. */
export function matrix(data: GeoData, cities: City[]): Map<string, { qty: number; sum: number }> {
  const cityMap = new Map(cities.map((c) => [c.id, c]));
  const cells = new Map<string, { qty: number; sum: number }>();
  for (const s of data.sales) {
    const region = territory(s.city_id == null ? undefined : cityMap.get(s.city_id)).id;
    const key = `${s.product_id}:${region}`;
    const c = cells.get(key) ?? { qty: 0, sum: 0 };
    cells.set(key, { qty: c.qty + Number(s.qty), sum: c.sum + Number(s.sum) });
  }
  return cells;
}
