import { useCallback, useEffect, useState } from 'react';
import { db, q } from './supabase';
import type { Offer } from './types';

/** Корзина заказа: вид товара компании → количество. Своя на каждую пару «магазин — компания». */
export type Cart = Record<string, number>;

const prefix = (storeId: string) => `sauda:cart:${storeId}:`;
const key = (storeId: string, companyId: string) => prefix(storeId) + companyId;
/** Корзину меняют каталог, страница компании и пакеты для нового магазина: счётчик в шапке слушает это событие. */
const CHANGED = 'sauda:cart';

// без хранилища (приватный режим) корзина живёт в памяти до перезагрузки
const memory = new Map<string, string>();

function storedKeys(): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
  } catch {
    return [...memory.keys()];
  }
}

export function readCart(storeId: string, companyId: string): Cart {
  const k = key(storeId, companyId);
  try {
    return JSON.parse(localStorage.getItem(k) ?? memory.get(k) ?? '{}') as Cart;
  } catch {
    return JSON.parse(memory.get(k) ?? '{}') as Cart;
  }
}

export function writeCart(storeId: string, companyId: string, cart: Cart) {
  const k = key(storeId, companyId);
  const empty = !Object.keys(cart).length;
  try {
    if (empty) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(cart));
  } catch {
    if (empty) memory.delete(k);
    else memory.set(k, JSON.stringify(cart));
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Все непустые корзины магазина: компания → корзина. */
export function readCarts(storeId: string): Record<string, Cart> {
  const carts: Record<string, Cart> = {};
  for (const k of storedKeys()) {
    if (!k.startsWith(prefix(storeId))) continue;
    const companyId = k.slice(prefix(storeId).length);
    const cart = readCart(storeId, companyId);
    if (Object.keys(cart).length) carts[companyId] = cart;
  }
  return carts;
}

const round = (qty: number) => Math.round(qty * 1000) / 1000;

/** Количество не больше свободного остатка компании. */
export const clampQty = (qty: number, offer: Pick<Offer, 'free'>) => round(Math.max(0, offer.free == null ? qty : Math.min(qty, Number(offer.free))));

/** Корзины всех компаний сразу: каталог товаров кладёт товар в корзину той компании, чьё предложение выбрано. */
export function useCarts(storeId: string) {
  const [carts, setCarts] = useState(() => readCarts(storeId));
  useEffect(() => {
    const sync = () => setCarts(readCarts(storeId));
    sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, [storeId]);

  const setQty = useCallback(
    (companyId: string, variantId: string, qty: number) => {
      const next = { ...readCart(storeId, companyId) };
      if (qty > 0) next[variantId] = round(qty);
      else delete next[variantId];
      writeCart(storeId, companyId, next);
    },
    [storeId],
  );
  const clear = useCallback((companyId: string) => writeCart(storeId, companyId, {}), [storeId]);

  const count = Object.values(carts).reduce((n, c) => n + Object.keys(c).length, 0);
  return { carts, count, setQty, clear, qty: (companyId: string, variantId: string) => carts[companyId]?.[variantId] ?? 0 };
}

/** Корзина одной компании. */
export function useCart(storeId: string, companyId: string) {
  const { carts, setQty, clear } = useCarts(storeId);
  const cart = carts[companyId] ?? EMPTY;
  return {
    cart,
    setQty: useCallback((variantId: string, qty: number) => setQty(companyId, variantId, qty), [setQty, companyId]),
    replace: useCallback((next: Cart) => writeCart(storeId, companyId, next), [storeId, companyId]),
    clear: useCallback(() => clear(companyId), [clear, companyId]),
  };
}
const EMPTY: Cart = {};

/**
 * Сколько заказать, чтобы поднять остаток до двойного критического, с округлением вверх до упаковки.
 * Пример: остаток 3, критический 10, упаковка 6 → нужно 17 → 18.
 */
export function suggestQty(stock: number, minStock: number, pack: number): number {
  const need = minStock * 2 - stock;
  if (need <= 0) return 0;
  const p = pack > 0 ? pack : 1;
  return Math.round(Math.ceil(need / p - 1e-9) * p * 1000) / 1000;
}

/** Предложения компаний для магазина: по компании, по штрихкодам или по видам из корзины. */
export async function loadOffers(storeId: string, by: { company?: string; barcodes?: string[]; variants?: string[] }): Promise<Offer[]> {
  const list = by.barcodes ?? by.variants;
  if (list && !list.length) return [];
  // страница компании показывает и товары без цен (прайс по запросу), остальным нужны только те, что можно заказать
  if (!list) return q<Offer[]>(db.rpc('store_offers', { p_store: storeId, p_company: by.company }));
  const out: Offer[] = [];
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    out.push(...(await q<Offer[]>(db.rpc('store_offers', { p_store: storeId, ...(by.barcodes ? { p_barcodes: part } : { p_variants: part }) }))));
  }
  return out.filter((o) => o.price != null);
}

/** Лучшее предложение на товар: сначала те, что есть в наличии, из них — с филиалом в городе магазина, затем по цене. */
export function bestOffer(offers: Offer[]): Offer | undefined {
  const inStock = (o: Offer) => o.free == null || Number(o.free) > 0;
  return [...offers].sort(
    (a, b) => Number(inStock(b)) - Number(inStock(a)) || Number(b.local) - Number(a.local) || Number(a.price) - Number(b.price),
  )[0];
}
