export interface ImportRow {
  name: string;
  barcode: string;
  extra_barcodes: string[] | null;
  unit: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  wholesale_price: number | null;
  category: string | null;
  subcategory: string | null;
  supplier: string | null;
  qty: number | null;
}

const COLUMNS: { key: keyof ImportRow; label: string; re: RegExp }[] = [
  { key: 'name', label: 'Название', re: /назв|наимен/ },
  { key: 'barcode', label: 'Штрихкод', re: /^штрих|barcode|баркод/ },
  { key: 'extra_barcodes', label: 'Доп. код', re: /доп.*(код|штрих)/ },
  { key: 'unit', label: 'Ед. изм', re: /ед\.?\s*изм|единиц/ },
  { key: 'purchase_price', label: 'Закупочная цена', re: /закуп/ },
  { key: 'sale_price', label: 'Продажная цена', re: /прод.*цен|рознич/ },
  { key: 'wholesale_price', label: 'Оптовая цена', re: /опт/ },
  { key: 'category', label: 'Категория', re: /^категор/ },
  { key: 'subcategory', label: 'Подкатегория', re: /^подкатегор/ },
  { key: 'supplier', label: 'Поставщик', re: /поставщ/ },
  { key: 'qty', label: 'Остаток', re: /остат|кол-?во|колич/ },
];

const UNIT_ALIASES: [RegExp, string][] = [
  [/^шт/, 'шт'],
  [/^кг|^килог/, 'кг'],
  [/^л$|^л\.|^литр/, 'л'],
  [/^м$|^м\.|^метр/, 'м'],
];

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // «1 658 409,00 тг», «292.276 кг.» — берём первое число, единицы и валюту отбрасываем
  const m = String(v ?? '').replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
}

function text(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

/** В выгрузке UMAG товары без категории помечены словом «Незаданные». */
function category(v: unknown): string | null {
  const s = text(v);
  return s && s.toLowerCase() !== 'незаданные' ? s : null;
}

const codes = (v: unknown) => String(v ?? '').split(/[;,\s]+/).map((c) => c.trim()).filter(Boolean);

/** Ищет строку заголовка по столбцам «Название» и «Штрихкод», остальные столбцы необязательны. */
export function parseImport(rows: unknown[][]): { items: ImportRow[]; found: string[] } {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const head = (rows[r] ?? []).map((c) => String(c ?? '').toLowerCase().trim());
    const col = Object.fromEntries(COLUMNS.map((c) => [c.key, head.findIndex((h) => c.re.test(h))])) as Record<keyof ImportRow, number>;
    if (col.name < 0 || col.barcode < 0) continue;

    const items: ImportRow[] = [];
    for (const row of rows.slice(r + 1)) {
      const name = text(row[col.name]);
      const main = codes(row[col.barcode]);
      if (!name || !main.length) continue;
      const extra = [...main.slice(1), ...(col.extra_barcodes >= 0 ? codes(row[col.extra_barcodes]) : [])];
      const unitRaw = col.unit >= 0 ? String(row[col.unit] ?? '').toLowerCase().trim() : '';
      items.push({
        name,
        barcode: main[0],
        // null оставляет прежние доп. коды товара, если такого столбца в файле нет
        extra_barcodes: col.extra_barcodes >= 0 || extra.length ? [...new Set(extra)] : null,
        unit: UNIT_ALIASES.find(([re]) => re.test(unitRaw))?.[1] ?? null,
        purchase_price: col.purchase_price >= 0 ? num(row[col.purchase_price]) : null,
        sale_price: col.sale_price >= 0 ? num(row[col.sale_price]) : null,
        wholesale_price: col.wholesale_price >= 0 ? num(row[col.wholesale_price]) : null,
        category: col.category >= 0 ? category(row[col.category]) : null,
        subcategory: col.subcategory >= 0 ? text(row[col.subcategory]) : null,
        supplier: col.supplier >= 0 ? text(row[col.supplier]) : null,
        qty: col.qty >= 0 ? num(row[col.qty]) : null,
      });
    }
    return { items, found: COLUMNS.filter((c) => col[c.key] >= 0).map((c) => c.label) };
  }
  throw new Error('В файле не найдены столбцы «Название» и «Штрихкод»');
}
