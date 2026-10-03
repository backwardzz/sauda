import { useCallback, useEffect, useState } from 'react';

/** Корзина заказа: товар каталога поставщика → количество. Своя на каждую пару «магазин — поставщик». */
export type Cart = Record<string, number>;

const key = (storeId: string, supplierId: string) => `sauda:cart:${storeId}:${supplierId}`;

export function readCart(storeId: string, supplierId: string): Cart {
  try {
    return JSON.parse(localStorage.getItem(key(storeId, supplierId)) ?? '{}') as Cart;
  } catch {
    return {};
  }
}

export function useCart(storeId: string, supplierId: string) {
  const [cart, setCart] = useState<Cart>(() => readCart(storeId, supplierId));
  useEffect(() => setCart(readCart(storeId, supplierId)), [storeId, supplierId]);

  const save = useCallback(
    (next: Cart) => {
      setCart(next);
      try {
        if (Object.keys(next).length) localStorage.setItem(key(storeId, supplierId), JSON.stringify(next));
        else localStorage.removeItem(key(storeId, supplierId));
      } catch {
        // без хранилища корзина живёт до перезагрузки
      }
    },
    [storeId, supplierId],
  );

  const setQty = useCallback(
    (productId: string, qty: number) => {
      const next = { ...cart };
      if (qty > 0) next[productId] = Math.round(qty * 1000) / 1000;
      else delete next[productId];
      save(next);
    },
    [cart, save],
  );

  return { cart, setQty, replace: save, clear: () => save({}) };
}

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
