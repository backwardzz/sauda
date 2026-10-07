import { parseNum } from './format';

export interface StockImportRow {
  barcode: string;
  branch_id: string;
  qty: number;
}

export interface StockImport {
  items: StockImportRow[];
  /** Названия филиалов, для которых в файле нашёлся столбец. */
  columns: string[];
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/ё/g, 'е');

/**
 * Остатки из Excel для склада компании. Подходит файл кнопки «Скачать» (столбец на каждый филиал)
 * и простой файл «Штрихкод + Остаток» — тогда остаток ставится на главный филиал.
 * Пустая ячейка остаток не трогает; отрицательные и нечисловые значения пропускаются.
 */
export function parseStockImport(rows: unknown[][], branches: { id: string; name: string; is_main: boolean }[]): StockImport {
  const head = rows.slice(0, 15).findIndex((r) => r.some((c) => /^штрих|barcode|баркод/.test(norm(c))));
  if (head < 0) throw new Error('В файле нет столбца «Штрихкод»');
  const header = rows[head].map(norm);
  const barcodeCol = header.findIndex((h) => /^штрих|barcode|баркод/.test(h));

  let cols = branches
    .map((b) => ({ branch: b, col: header.indexOf(norm(b.name)) }))
    .filter((c) => c.col >= 0);
  if (cols.length === 0) {
    // файл не из нашей выгрузки: один столбец остатка — на главный филиал
    const col = header.findIndex((h) => /^(?!.*(упаков|заказ|свобод)).*(остат|кол-?во|колич|всего)/.test(h));
    const main = branches.find((b) => b.is_main) ?? branches[0];
    if (col < 0 || !main) throw new Error('В файле нет столбцов с остатками: нужен столбец с названием филиала или «Остаток»');
    cols = [{ branch: main, col }];
  }

  const items: StockImportRow[] = [];
  for (const row of rows.slice(head + 1)) {
    const barcode = String(row[barcodeCol] ?? '').trim();
    if (!barcode) continue;
    for (const { branch, col } of cols) {
      const cell = row[col];
      if (cell === '' || cell == null) continue;
      if (typeof cell !== 'number' && !/^-?[\d\s]+([.,]\d+)?$/.test(String(cell).trim())) continue;
      const qty = parseNum(cell as string | number);
      if (qty < 0) continue;
      items.push({ barcode, branch_id: branch.id, qty });
    }
  }
  return { items, columns: cols.map((c) => c.branch.name) };
}
