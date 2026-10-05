import type { Variant } from './types';

// То же правило раскладывает прежние каталоги в миграции 20261011000000_companies.sql (pg_temp.split_name).
const SIZE = /^(.*?\S) ((?:\d+ ?[xх*] ?)?\d+(?:[.,]\d+)? ?(?:мл|мг|кг|гр|г|л|шт|см|мм|м|ml|kg|g|l)(?![a-zа-яё]).*)$/i;

/**
 * Название из прайса → товар и его вид: «Вода питьевая 0,5 л» → «Вода питьевая» и «0,5 л».
 * Вид начинается с первого размера в названии; без размера вид пустой, и товар остаётся с одним видом.
 */
export function splitName(name: string): { product: string; label: string } {
  const clean = name.replace(/\s+/g, ' ').trim();
  const m = SIZE.exec(clean);
  return m ? { product: m[1], label: m[2] } : { product: clean, label: '' };
}

/** Полное название вида: так он записан в заказах и в общем каталоге товаров. */
export const fullName = (product: string, label: string) => `${product} ${label}`.trim();

const LITERS = ['0,25 л', '0,33 л', '0,5 л', '1 л', '1,5 л', '2 л', '5 л'];
const GRAMS = ['50 г', '100 г', '200 г', '250 г', '500 г', '1 кг'];
const sizeKey = (label: string) => label.toLowerCase().replace(/\s/g, '').replace('.', ',');

/**
 * Ходовые фасовки — подсказки при добавлении вида. Литры или граммы выбираются по уже заведённым видам
 * («0,5 л» → предложить «1 л», «1,5 л»), а без них — по единице измерения.
 */
export function sizeHints(labels: string[], unit: string): string[] {
  const known = labels.map(sizeKey);
  const text = known.join(' ');
  const list = /\d(мл|л)(?![а-яё])/.test(text) || unit === 'л' ? LITERS
    : /\d(кг|гр|г)(?![а-яё])/.test(text) || unit === 'кг' ? GRAMS
    : [...LITERS.slice(2, 5), ...GRAMS.slice(1, 4)];
  return list.filter((h) => !known.includes(sizeKey(h)));
}

/** Диапазон цен видов товара: одно число, если цена одна. */
export function priceRange(variants: Pick<Variant, 'price'>[]): [number, number] | null {
  const prices = variants.map((v) => Number(v.price));
  return prices.length ? [Math.min(...prices), Math.max(...prices)] : null;
}
