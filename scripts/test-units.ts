// Проверки чистых функций: без базы и без браузера.
import { grade } from '../src/lib/abc';
import { generateBarcode } from '../src/lib/barcode';
import { markupPct, marginPct, parseNum, round2, round3 } from '../src/lib/format';
import { parseImport } from '../src/lib/importParse';
import { decodeInvoice, encodeInvoice, invoiceUnit } from '../src/lib/invoice';
import { periodRange } from '../src/ui/Period';

let failed = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}: получено ${a}, ожидалось ${e}`);
  }
}

console.log('Числа');
eq('запятая и пробелы', parseNum('1 234,5'), 1234.5);
eq('мусор даёт 0', parseNum('abc'), 0);
eq('округление 1.005', round2(1.005), 1.01);
eq('округление веса', round3(0.1 + 0.2), 0.3);
eq('наценка', markupPct(100, 150), 50);
eq('наценка без закупочной', markupPct(0, 150), 0);
eq('рентабельность', marginPct(200, 50), 25);

console.log('Штрихкоды');
function validEan(code: string) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}
for (let i = 0; i < 50; i++) {
  const piece = generateBarcode('шт');
  const weight = generateBarcode('кг');
  if (!validEan(piece) || !piece.startsWith('20') || !validEan(weight) || !/^21\d{5}00000\d$/.test(weight)) {
    eq('сгенерированный штрихкод', [piece, weight], 'корректные EAN-13');
    break;
  }
}
eq('контрольная цифра и префиксы', failed, 0);

console.log('Импорт из Excel');
const parsed = parseImport([
  ['Выгрузка товаров'],
  [],
  ['Название товара', 'Штрихкод', 'Артикул', 'Доп. код', 'Закуп. цена ₸', 'Прод. цена ₸', 'Ед. изм', 'Поставщик', 'Категория', 'Кол-во'],
  ['Dizzy original 0.33л', 4870204391510, '', '4870204392647; 4870204392708', '417,00 тг', '550,00 тг', 'шт.', 'Макси чай', 'Напитки', '3977 шт.'],
  ['Картошка', '2760107', '', 1190, 150, 200, 'кг.', '', '', '292.276 кг.'],
  ['', '123'],
  ['Без штрихкода', ''],
]);
eq('найденные столбцы', parsed.found, ['Название', 'Штрихкод', 'Доп. код', 'Ед. изм', 'Закупочная цена', 'Продажная цена', 'Категория', 'Поставщик', 'Остаток']);
eq('строки без названия или штрихкода пропущены', parsed.items.length, 2);
eq('первая строка', parsed.items[0], {
  name: 'Dizzy original 0.33л', barcode: '4870204391510', extra_barcodes: ['4870204392647', '4870204392708'], unit: 'шт',
  purchase_price: 417, sale_price: 550, wholesale_price: null, category: 'Напитки', subcategory: null, supplier: 'Макси чай', qty: 3977,
});
eq('весовой товар', [parsed.items[1].unit, parsed.items[1].qty, parsed.items[1].extra_barcodes], ['кг', 292.276, ['1190']]);
const minimal = parseImport([['Наименование', 'Barcode'], ['Хлеб', '111 222']]);
eq('минимальный файл: второй код уходит в доп. коды', [minimal.items[0].barcode, minimal.items[0].extra_barcodes, minimal.items[0].sale_price], ['111', ['222'], null]);
const umag = parseImport([
  ['Название товара', 'Штрихкод', 'Артикул', 'Доп. код', 'Закуп. цена', 'Прод. цена', 'Ед. изм', 'Наценка', 'Маржа', 'Номер на весах', 'Дата изм.', 'Код НКТ (NTIN)', 'Поставщик', 'Оптовая цена', 'Категория', 'Подкатегория'],
  ['Перчатки', '2110000001964', '', '', 85, 150, 'шт', '', '', 'Товар не весовой', '', '', 'Рыночные товары', 0, 'Хозтовары', 'инструменты для уборки'],
  ['Новый продукт', '4810809415228', '', '', 0, 0, 'литр', '', '', 'Товар не весовой', '', '', '', 0, 'Незаданные', ''],
]);
eq('выгрузка UMAG: категория и подкатегория', [umag.items[0].category, umag.items[0].subcategory, umag.items[0].supplier, umag.items[0].wholesale_price], ['Хозтовары', 'инструменты для уборки', 'Рыночные товары', 0]);
eq('выгрузка UMAG: «Незаданные» — это без категории, литр — л', [umag.items[1].category, umag.items[1].unit, umag.items[1].qty], [null, 'л', null]);
let threw = false;
try {
  parseImport([['a', 'b'], [1, 2]]);
} catch {
  threw = true;
}
eq('файл без нужных столбцов отклонён', threw, true);

console.log('ABC-анализ');
const abc = grade(
  [{ key: 'a', v: 700 }, { key: 'b', v: 150 }, { key: 'c', v: 100 }, { key: 'd', v: 40 }, { key: 'e', v: 10 }, { key: 'f', v: 0 }, { key: 'g', v: -5 }],
  (r) => r.v,
);
// доли до товара: a 0%, b 70%, c 85%, d 95%, e 99% — товар, пересекающий порог, остаётся в старшем классе
eq('классы', ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => abc.get(k)).join(''), 'AABCCCC');
eq('суммы с пробелами и валютой', parseImport([['Название', 'Штрихкод', 'Продажная цена'], ['X', '1', '1 658 409,00 тг']]).items[0].sale_price, 1658409);
eq('единственный товар — A', grade([{ key: 'x', v: 5 }], (r) => r.v).get('x'), 'A');
eq('без продаж — C', grade([{ key: 'x', v: 0 }], (r) => r.v).get('x'), 'C');

console.log('Накладная из фото');
const inv = { supplier: 'ТОО «Макси чай»', number: '15', date: '03.10.2026', items: [{ barcode: '4870204391510', name: 'Dizzy 0.33л', unit: 'шт', qty: 24, price: 417.5 }] };
eq('накладная переживает кодирование в адрес', decodeInvoice(encodeInvoice(inv)), inv);
eq('код годится для адреса', /^[\w-]+$/.test(encodeInvoice(inv)), true);
eq('строки без штрихкода и количества отброшены', decodeInvoice(encodeInvoice({ ...inv, items: [...inv.items, { barcode: '', name: 'x', unit: '', qty: 1, price: 1 }, { barcode: '1', name: 'y', unit: '', qty: 0, price: 1 }] })).items.length, 1);
let bad = false;
try { decodeInvoice('%%%'); } catch { bad = true; }
eq('повреждённая ссылка отклонена', bad, true);
eq('единицы накладной', ['бут', 'кг.', 'Литр', 'пач', 'м'].map(invoiceUnit), ['шт', 'кг', 'л', 'шт', 'м']);

console.log('Период');
const range = periodRange({ from: '2026-10-01', to: '2026-10-03' });
eq('конец периода — начало следующего дня', (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400_000, 3);

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
