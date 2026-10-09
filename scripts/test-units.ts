// Проверки чистых функций: без базы и без браузера.
import { grade } from '../src/lib/abc';
import { generateBarcode } from '../src/lib/barcode';
import { bestOffer, clampQty, suggestQty } from '../src/lib/cart';
import { cityLabel, cityName } from '../src/lib/cities';
import { totals, variantState } from '../src/lib/companyCatalog';
import { isDocKind, lineExpected, linePrice, lineSum } from '../src/lib/docs';
import {
  formatPhone, fromDateInput, markupPct, marginPct, maskPhone, money, moneyShort, parseNum, pct, PHONE_PATTERN, plural, qty, round2, round3,
  toDateInput,
} from '../src/lib/format';
import { byProduct, byRegion, inArea, matrix, type GeoData } from '../src/lib/geo';
import { parseImport } from '../src/lib/importParse';
import { decodeInvoice, encodeInvoice, invoiceUnit } from '../src/lib/invoice';
import { categoryTree } from '../src/lib/refs';
import { parseStockImport } from '../src/lib/stockImport';
import { errorText } from '../src/lib/supabase';
import type { Category, City, DocLine, Offer, Variant, VariantStats } from '../src/lib/types';
import { fullName, priceRange, sizeHints, splitName } from '../src/lib/variants';
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
  product: null, label: null, pack_qty: null, price: null,
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

console.log('Товар и его виды');
const split = (name: string) => { const p = splitName(name); return [p.product, p.label]; };
eq('размер в конце названия', split('Вода питьевая 0,5 л'), ['Вода питьевая', '0,5 л']);
eq('размер слитно и с упаковкой', split('Coca cola 0.45л ж/б'), ['Coca cola', '0.45л ж/б']);
eq('процент жирности — не размер', split('Молоко 3,2% 1 л'), ['Молоко 3,2%', '1 л']);
eq('граммы и «гр»', [split('Мыло Absolut 90гр'), split('Йогурт Alpenland 2.5% 95г')], [['Мыло Absolut', '90гр'], ['Йогурт Alpenland 2.5%', '95г']]);
eq('вид начинается с первого размера', split('Набор кружек 2 шт 300 мл'), ['Набор кружек', '2 шт 300 мл']);
eq('без размера вид пустой', split('  Сыр   твёрдый '), ['Сыр твёрдый', '']);
eq('буква после числа — не единица', [split('5 минут каша'), split('Сигареты Kent 4')], [['5 минут каша', ''], ['Сигареты Kent 4', '']]);
eq('название из одного размера не делится', split('0,5 л'), ['0,5 л', '']);
eq('товар и вид складываются обратно', ['Coca cola 0.5л', 'Сыр твёрдый'].map((n) => fullName(splitName(n).product, splitName(n).label)), ['Coca cola 0.5л', 'Сыр твёрдый']);

console.log('Прайс компании');
const priceList = parseImport([
  ['Название', 'Товар', 'Вид', 'Штрихкод', 'Ед. изм', 'Продажная цена', 'Категория', 'В упаковке', 'Остаток'],
  ['Кола 0,5 л', 'Кола', '0,5 л', '4870000000011', 'шт', 200, 'Напитки', 12, 240],
  ['Хлеб', 'Хлеб', '', '4870000000028', 'шт', 120, 'Выпечка', 1, ''],
]);
eq('выгрузка каталога компании читается обратно', [priceList.items[0].product, priceList.items[0].label, priceList.items[0].pack_qty, priceList.items[0].qty], ['Кола', '0,5 л', 12, 240]);
eq('товар с одним видом: вид пустой, остаток не задан', [priceList.items[1].product, priceList.items[1].label, priceList.items[1].qty], ['Хлеб', '', null]);
const simple = parseImport([['Товар', 'Штрихкод', 'Цена', 'Кол-во в упаковке'], ['Сок яблочный 1 л', '111', '520 тг', 6]]);
eq('простой прайс: «Товар» — это название, «Цена» — цена, упаковка не путается с остатком',
  [simple.items[0].name, simple.items[0].product, simple.items[0].price, simple.items[0].pack_qty, simple.items[0].qty], ['Сок яблочный 1 л', null, 520, 6, null]);
const pair = parseImport([['Товар', 'Вид', 'Штрихкод'], ['Кола', '1 л', '222']]);
eq('без «Названия» название складывается из товара и вида', [pair.items[0].name, pair.items[0].product, pair.items[0].label], ['Кола 1 л', 'Кола', '1 л']);

console.log('Корзина и предложения');
const offer = (o: Partial<Offer>) => ({ price: 100, free: null, local: false, pack_qty: 1, ...o }) as Offer;
eq('количество не больше свободного остатка', [clampQty(30, offer({ free: 24 })), clampQty(30, offer({})), clampQty(-5, offer({})), clampQty(0.1 + 0.2, offer({}))], [24, 30, 0, 0.3]);
eq('лучшее предложение: сначала в наличии', bestOffer([offer({ variant_id: 'a', price: 90, free: 0 }), offer({ variant_id: 'b', price: 110 })])?.variant_id, 'b');
eq('лучшее предложение: свой город важнее цены', bestOffer([offer({ variant_id: 'a', price: 90 }), offer({ variant_id: 'b', price: 95, local: true })])?.variant_id, 'b');
eq('лучшее предложение: при прочих равных дешевле', bestOffer([offer({ variant_id: 'a', price: 95 }), offer({ variant_id: 'b', price: 90 })])?.variant_id, 'b');
eq('предложений нет', bestOffer([]), undefined);
eq('дозаказ до двойного критического, упаковками', [suggestQty(3, 10, 6), suggestQty(25, 10, 6), suggestQty(0, 5, 1)], [18, 0, 10]);

console.log('Телефон и склонения');
eq('номер приводится к единому виду', ['87010001122', '7010001122', '+7 (701) 000-11-22', ' 12345 '].map(formatPhone), ['+7 701 000 11 22', '+7 701 000 11 22', '+7 701 000 11 22', '12345']);
eq('маска номера: «+7» и не больше десяти цифр',
  ['+7 7', '+7 7012', '+7 701 000 11 229', '87010001122', '+7 87010001122', '77010001122', '+7 (701) 000-11-22', '8', '+7', 'абв'].map(maskPhone),
  ['+7 7', '+7 701 2', '+7 701 000 11 22', '+7 701 000 11 22', '+7 701 000 11 22', '+7 701 000 11 22', '+7 701 000 11 22', '+7 ', '', '']);
eq('шаблон номера', ['+7 701 000 11 22', '+7 701 000 11 2', '8 701 000 11 22'].map((s) => new RegExp(`^(?:${PHONE_PATTERN})$`).test(s)), [true, false, false]);
const stockBranches = [{ id: 'm', name: 'Главный офис', is_main: true }, { id: 'k', name: 'Склад в Конаеве', is_main: false }];
const ownFile = parseStockImport([
  ['Товар', 'Вид', 'Штрихкод', 'Категория', 'Главный офис', 'склад в конаеве ', 'Всего', 'В заказах', 'Свободно', 'Цена'],
  ['Айран', '0,5 л', 4870000005109, 'Кисломолочные', 120, '', 120, 0, 120, 240],
  ['Кефир', '1 л', '4870000005110', '', '1 250,5', 30, 80, 0, 80, 300],
  ['Сыр', '', '4870000005111', '', -5, 'нет', '', '', '', 900],
  ['', '', '', '', 10, 10],
], stockBranches);
eq('остатки из своей выгрузки: столбец на филиал, пустые и ошибочные ячейки пропущены', [ownFile.columns, ownFile.items], [
  ['Главный офис', 'Склад в Конаеве'],
  [{ barcode: '4870000005109', branch_id: 'm', qty: 120 }, { barcode: '4870000005110', branch_id: 'm', qty: 1250.5 }, { barcode: '4870000005110', branch_id: 'k', qty: 30 }],
]);
const plainFile = parseStockImport([['Отчёт 1С'], ['Штрихкод', 'Наименование', 'Остаток'], ['111', 'Айран', 7]], stockBranches);
eq('простой файл «Штрихкод + Остаток» — на главный филиал', plainFile.items, [{ barcode: '111', branch_id: 'm', qty: 7 }]);
let stockThrew = false;
try { parseStockImport([['Название', 'Цена'], ['Айран', 1]], stockBranches); } catch { stockThrew = true; }
eq('файл остатков без штрихкода отклонён', stockThrew, true);
eq('склонения', [1, 2, 5, 11, 21, 104].map((n) => plural(n, 'товар', 'товара', 'товаров')), ['товар', 'товара', 'товаров', 'товаров', 'товар', 'товара']);

console.log('Период');
const range = periodRange({ from: '2026-10-01', to: '2026-10-03' });
eq('конец периода — начало следующего дня', (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400_000, 3);

console.log('Вывод чисел и дат');
// неразрывные пробелы-разделители ru-RU приводятся к обычным
const sp = (s: string) => s.replace(/\s/g, ' ');
eq('сумма с копейками и разделителем тысяч', sp(money(1234.5)), '1 234,50');
eq('мусор и пустое — ноль', [money('abc'), money(null), qty(undefined)], ['0,00', '0,00', '0']);
eq('сумма без копеек, если целая', [sp(moneyShort(1500)), moneyShort(12.5)], ['1 500', '12,5']);
eq('количество до граммов', [qty(0.1 + 0.2), qty(1.23456)], ['0,3', '1,235']);
eq('процент', pct(12.5), '12,5%');
eq('дата для поля ввода', toDateInput(new Date(2026, 0, 5)), '2026-01-05');
eq('дата из поля ввода — местная полночь', [fromDateInput('2026-03-09').getDate(), fromDateInput('2026-03-09').getHours()], [9, 0]);
eq('дата туда и обратно', toDateInput(fromDateInput('2026-12-31')), '2026-12-31');

console.log('Города');
const cityList: City[] = [
  { id: 1, name: 'Алматы', region_id: 10, region: 'Города республиканского значения', region_sort: 0 },
  { id: 2, name: 'Семей', region_id: 20, region: 'Абайская область', region_sort: 1 },
  { id: 3, name: 'Аягоз', region_id: 20, region: 'Абайская область', region_sort: 1 },
  { id: 4, name: 'Караганда', region_id: 30, region: 'Карагандинская область', region_sort: 2 },
];
eq('город республиканского значения без области', cityLabel(cityList, 1), 'Алматы');
eq('город с областью', cityLabel(cityList, 2), 'Семей, Абайская область');
eq('неизвестный или не указанный город — пусто', [cityLabel(cityList, 99), cityLabel(cityList, null), cityName(cityList, undefined)], ['', '', '']);
eq('название города', cityName(cityList, 4), 'Караганда');

console.log('Склад компании');
const variant = (o: Partial<Variant>): Variant => ({
  id: 'v', org_id: 'o', product_id: 'p', label: '', barcode: '', unit: 'шт', price: 100, pack_qty: 1, image_url: '',
  active: true, track_stock: true, min_stock: null, sort: 0, archived: false, ...o,
});
const stat = (o: Partial<VariantStats>): VariantStats => ({
  variant_id: 'v', stock: 0, reserved: 0, sold_qty: 0, sold_sum: 0, sold_qty_30: 0, orders_count: 0, stores_count: 0, last_sold_at: null, ...o,
});
eq('состояние вида', [
  variantState(variant({ track_stock: false }), stat({ stock: 0 })),
  variantState(variant({}), stat({ stock: 10, reserved: 10 })),
  variantState(variant({ min_stock: 8 }), stat({ stock: 10, reserved: 2 })),
  variantState(variant({ min_stock: 8 }), stat({ stock: 10, reserved: 1 })),
  variantState(variant({}), stat({ stock: 1 })),
  variantState(variant({}), undefined),
], ['untracked', 'out', 'low', 'ok', 'ok', 'out']);
const catalogStats = new Map([
  ['a', stat({ variant_id: 'a', stock: 10, reserved: 2, sold_qty: 3, sold_qty_30: 1, sold_sum: 300, last_sold_at: '2026-10-01T10:00:00Z' })],
  ['b', stat({ variant_id: 'b', stock: null, reserved: 1, sold_qty: 2, sold_sum: 200, last_sold_at: '2026-10-05T10:00:00Z' })],
  ['c', stat({ variant_id: 'c', stock: 0 })],
  ['d', stat({ variant_id: 'd', stock: 5, reserved: 5 })],
]);
eq('сводка: остаток и свободное только по видам с учётом, продажи по всем',
  totals([variant({ id: 'a' }), variant({ id: 'b', track_stock: false }), variant({ id: 'c', active: false })], catalogStats),
  { stock: 10, reserved: 3, free: 8, sold: 5, sold30: 1, soldSum: 500, lastSold: '2026-10-05T10:00:00Z', state: 'ok' });
eq('пустой набор — без учёта', [totals([], catalogStats).stock, totals([], catalogStats).free, totals([], catalogStats).state], [null, null, 'untracked']);
const stateOf = (...vs: Variant[]) => totals(vs, catalogStats).state;
eq('товар закончился, только если закончились все виды в продаже', stateOf(variant({ id: 'c' }), variant({ id: 'd' })), 'out');
eq('один вид закончился — товар заканчивается', stateOf(variant({ id: 'a' }), variant({ id: 'd' })), 'low');
eq('снятый с продажи вид на состояние не влияет', stateOf(variant({ id: 'a' }), variant({ id: 'd', active: false })), 'ok');
eq('только виды без учёта', stateOf(variant({ id: 'b', track_stock: false })), 'untracked');

console.log('Складские документы');
eq('вид документа', [isDocKind('supply'), isDocKind('inventory'), isDocKind('sale'), isDocKind(undefined)], [true, true, false, false]);
const docLine = (o: Partial<DocLine>): DocLine => ({
  product_id: 'p', name: 'Товар', barcode: '1', unit: 'шт', qty: 5, price: 100, sale_price: null, expected: 8, stock: 7,
  card_purchase: 90, card_sale: 150, updated_at: '2026-10-01T00:00:00Z', ...o,
});
const dl = docLine({});
eq('цена строки: черновик списания — закупочная из карточки, проведённый — зафиксированная',
  [linePrice('writeoff', dl, false), linePrice('writeoff', dl, true), linePrice('transfer', dl, false)], [90, 100, 90]);
eq('цена строки: приёмка и оприходование — всегда своя', [linePrice('supply', dl, false), linePrice('posting', dl, false)], [100, 100]);
eq('учётный остаток инвентаризации: черновик — текущий, проведённая — зафиксированный', [lineExpected(dl, false), lineExpected(dl, true)], [7, 8]);
eq('учётный остаток без зафиксированного — ноль', lineExpected(docLine({ expected: null }), true), 0);
eq('сумма инвентаризации — по расхождению', [lineSum('inventory', dl, false), lineSum('inventory', dl, true)], [-180, -300]);
eq('сумма строки', lineSum('supply', dl, false), 500);
eq('вес на цену округляется до копеек', lineSum('supply', docLine({ qty: 0.333, price: 999.99 }), false), 333);

console.log('Продажи по территориям');
const geo: GeoData = {
  sales: [
    { city_id: 2, product_id: 'P1', store_org: 'A', qty: 10, sum: 1000, orders: 2 },
    { city_id: 3, product_id: 'P1', store_org: 'B', qty: 5, sum: 500, orders: 1 },
    { city_id: 2, product_id: 'P2', store_org: 'A', qty: 1, sum: 300, orders: 1 },
    { city_id: 1, product_id: 'P1', store_org: 'C', qty: 2, sum: 2000, orders: 1 },
    { city_id: null, product_id: 'P2', store_org: 'D', qty: 1, sum: 50, orders: 1 },
  ],
  market: [{ city_id: 2, stores: 4 }, { city_id: 4, stores: 3 }, { city_id: 1, stores: 1 }],
};
const regions = byRegion(geo, cityList, null);
eq('области по выручке: Алматы — сама себе территория, «белые пятна» тоже в списке',
  regions.map((r) => [r.name, r.qty, r.sum, r.buyers, r.stores]),
  [['Алматы', 2, 2000, 1, 1], ['Абайская область', 16, 1800, 2, 5], ['Город не указан', 1, 50, 1, 1], ['Карагандинская область', 0, 0, 0, 3]]);
eq('города области по выручке; магазин с заказами считается, даже если его нет в охвате',
  regions[1].cities.map((c) => [c.name, c.sum, c.buyers, c.stores]), [['Семей', 1300, 1, 4], ['Аягоз', 500, 1, 1]]);
eq('по одному товару: при равной выручке — по порядку областей',
  byRegion(geo, cityList, new Set(['P2'])).map((r) => [r.name, r.sum]),
  [['Абайская область', 300], ['Город не указан', 50], ['Алматы', 0], ['Карагандинская область', 0]]);
const cityById = new Map(cityList.map((c) => [c.id, c]));
eq('попадание в территорию', [
  inArea(null, 3, cityById),
  inArea({ kind: 'city', id: 2 }, 2, cityById), inArea({ kind: 'city', id: 2 }, 3, cityById),
  inArea({ kind: 'region', id: 20 }, 3, cityById), inArea({ kind: 'region', id: 20 }, 1, cityById),
  inArea({ kind: 'region', id: -1001 }, 1, cityById),
  inArea({ kind: 'region', id: -1 }, null, cityById), inArea({ kind: 'city', id: -1 }, null, cityById),
], [true, true, false, true, false, true, true, true]);
eq('товары области: сумма и число магазинов', [...byProduct(geo, cityList, { kind: 'region', id: 20 })],
  [['P1', { qty: 15, sum: 1500, buyers: 2, stores: 0 }], ['P2', { qty: 1, sum: 300, buyers: 1, stores: 0 }]]);
eq('таблица «товар × область»', [...matrix(geo, cityList)], [
  ['P1:20', { qty: 15, sum: 1500 }], ['P2:20', { qty: 1, sum: 300 }], ['P1:-1001', { qty: 2, sum: 2000 }], ['P2:-1', { qty: 1, sum: 50 }],
]);

console.log('Категории');
const cat = (id: string, parent_id: string | null): Category => ({ id, org_id: 'o', parent_id, name: id, markup_pct: 0 });
eq('подкатегории под своей категорией, потерявшие родителя — в корне',
  categoryTree([cat('b', null), cat('n', null), cat('k', 'b'), cat('s', 'n'), cat('x', 'gone')]).map((r) => `${r.depth}${r.cat.id}`),
  ['0b', '1k', '0n', '1s', '0x']);

console.log('Фасовки и цены видов');
eq('по литрам — литры без уже заведённых', sizeHints(['0,5 л'], 'шт'), ['0,25 л', '0,33 л', '1 л', '1,5 л', '2 л', '5 л']);
eq('по граммам — граммы', sizeHints(['500 г', '1 кг'], 'шт'), ['50 г', '100 г', '200 г', '250 г']);
eq('точка, регистр и миллилитры', [sizeHints(['0.5 Л'], 'шт').includes('0,5 л'), sizeHints(['330 мл'], 'шт')[0]], [false, '0,25 л']);
eq('без видов — по единице измерения', [sizeHints([], 'л').length, sizeHints([], 'кг')[0], sizeHints([], 'шт')],
  [7, '50 г', ['0,5 л', '1 л', '1,5 л', '100 г', '200 г', '250 г']]);
eq('диапазон цен', [priceRange([]), priceRange([{ price: 100 }]), priceRange([{ price: '250' as unknown as number }, { price: 90 }])], [null, [100, 100], [90, 250]]);

console.log('Тексты ошибок');
eq('ограничение по имени важнее кода', errorText({ code: '23505', message: 'duplicate key value violates unique constraint "products_barcode_uq"' }),
  'Товар с таким штрихкодом уже есть');
eq('отказ RLS по коду, при любом тексте', errorText({ code: '42501', message: 'new row violates policy' }), 'Недостаточно прав для этого действия');
eq('внешний ключ по коду', errorText({ code: '23503', message: 'update or delete on table' }), 'Запись используется в других документах');
const authError = Object.assign(new Error('Something changed in wording'), { code: 'invalid_credentials' });
eq('ошибка входа по коду Supabase Auth', errorText(authError), 'Неверная почта или пароль');
eq('без кода — по тексту', [errorText(new TypeError('Failed to fetch')), errorText({ message: 'Password should be at least 6 characters' })],
  ['Нет связи с сервером', 'Пароль слишком короткий: нужно минимум 6 символов']);
eq('текст из SQL-функции проходит как есть', errorText({ code: 'P0001', message: 'Смена закрыта' }), 'Смена закрыта');
eq('не объект', [errorText('строка'), errorText(null)], ['строка', 'null']);


console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
