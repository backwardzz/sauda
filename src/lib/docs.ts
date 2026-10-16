import { round2 } from './format';
import type { DocKind, DocLine } from './types';
import { stockDocLines } from '../api/docs';

interface KindMeta {
  title: string;
  one: string;
  hint: string;
  posted: string;
}

export const DOC_KINDS: Record<DocKind, KindMeta> = {
  supply: {
    title: 'Приёмка', one: 'Приёмка', posted: 'Приёмка проведена',
    hint: 'Поступление товара от поставщика: остатки растут, закупочные цены обновляются.',
  },
  posting: {
    title: 'Оприходование', one: 'Оприходование', posted: 'Оприходование проведено',
    hint: 'Добавляет товар на склад без поставщика: начальные остатки, излишки.',
  },
  writeoff: {
    title: 'Списание', one: 'Списание', posted: 'Списание проведено',
    hint: 'Убирает товар со склада: бой, порча, истёкший срок.',
  },
  transfer: {
    title: 'Перемещение', one: 'Перемещение', posted: 'Перемещение проведено',
    hint: 'Перенос товара между своими торговыми точками.',
  },
  inventory: {
    title: 'Инвентаризация', one: 'Инвентаризация', posted: 'Инвентаризация проведена',
    hint: 'Сверка фактического количества с учётным: после проведения остатки равны подсчитанным.',
  },
};

export const isDocKind = (k: string | undefined): k is DocKind => !!k && k in DOC_KINDS;

/** Все строки документа: функция отдаёт не больше 1000 строк за запрос, большая инвентаризация читается частями. */
export async function loadDocLines(docId: string): Promise<DocLine[]> {
  const out: DocLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await stockDocLines(docId, from);
    if (error) throw error;
    out.push(...((data ?? []) as DocLine[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Цена строки: в черновике списания, перемещения и инвентаризации — текущая закупочная из карточки. */
export function linePrice(kind: DocKind, l: DocLine, posted: boolean): number {
  return posted || kind === 'posting' || kind === 'supply' ? Number(l.price) : Number(l.card_purchase);
}

/** Учётный остаток для инвентаризации: после проведения — зафиксированный, в черновике — текущий. */
export function lineExpected(l: DocLine, posted: boolean): number {
  return posted ? Number(l.expected ?? 0) : Number(l.stock);
}

export function lineSum(kind: DocKind, l: DocLine, posted: boolean): number {
  const price = linePrice(kind, l, posted);
  const qty = kind === 'inventory' ? Number(l.qty) - lineExpected(l, posted) : Number(l.qty);
  return round2(qty * price);
}
