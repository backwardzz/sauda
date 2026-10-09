import type { Product } from './types';

type Attrs = Pick<Product, 'title' | 'size_value' | 'size_unit' | 'percent' | 'pack_qty' | 'pack_unit' | 'package'>;

/** Число без лишних нулей и с запятой: 0.45 → «0,45». Так же пишет база (app.num_text). */
const num = (n: number) => String(Number(n)).replace('.', ',');

export const sizeText = (p: Pick<Product, 'size_value' | 'size_unit'>) =>
  p.size_value != null && p.size_unit ? `${num(p.size_value)} ${p.size_unit}` : '';
export const percentText = (p: Pick<Product, 'percent'>) => (p.percent != null ? `${num(p.percent)}%` : '');
export const packText = (p: Pick<Product, 'pack_qty' | 'pack_unit'>) =>
  p.pack_qty != null && p.pack_unit ? `${num(p.pack_qty)} ${p.pack_unit}` : '';

/**
 * Полное название, как его соберёт база (app.product_full_name): «Coca cola 0,45 л ж/б».
 * Нужно для предпросмотра в карточке товара до сохранения.
 */
export function fullProductName(p: Attrs): string {
  return [p.title.trim(), percentText(p), sizeText(p), packText(p), (p.package ?? '').trim()].filter(Boolean).join(' ');
}
