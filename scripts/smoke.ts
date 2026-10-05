// Сквозная проверка серверной логики на локальной базе (npm run db:start перед запуском).
// Создаёт магазины и компанию со случайными тестовыми пользователями и проверяет склад, кассу, отчёты, заказы и изоляцию.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`Тест пишет данные и запускается только на локальной базе, а в .env.local указано ${url}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let failed = 0;
function check(name: string, ok: boolean, details?: unknown) {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`, details ?? '');
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  check(name, Number(actual) === Number(expected), `получено ${actual}, ожидалось ${expected}`);
}

async function signUp(label: string): Promise<{ db: SupabaseClient; email: string }> {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const email = `${label}-${randomBytes(4).toString('hex')}@test.local`;
  const { error } = await db.auth.signUp({
    email,
    password: randomBytes(12).toString('hex'),
    options: { data: { full_name: label } },
  });
  if (error) throw error;
  return { db, email };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(p: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function fails(name: string, p: PromiseLike<{ error: { message: string } | null }>, part = '') {
  const { error } = await p;
  check(name, !!error && error.message.includes(part), error?.message ?? 'ошибки не было');
}

/**
 * Убирает тестовых пользователей (почта @test.local) с их магазинами и компаниями и тестовые строки справочника.
 * Запускается до и после проверок: компания из прерванного запуска осталась бы на общей витрине
 * и продавала бы товары с теми же штрихкодами.
 */
async function cleanup(admin: SupabaseClient) {
  const users = (await must(admin.from('profiles').select('id').like('email', '%@test.local'))) as { id: string }[];
  for (let i = 0; i < users.length; i += 100) {
    const owned = await must(admin.from('org_members').select('org_id').eq('role', 'owner').in('user_id', users.slice(i, i + 100).map((u) => u.id)));
    for (const m of owned) await must(admin.from('orgs').delete().eq('id', m.org_id));
  }
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  await must(admin.from('catalog_products').delete().in('barcode', ['4870000000011', '4870000009991', '4870000009992', '4870000009993']));
  await must(admin.from('catalog_products').delete().like('barcode', '29%').like('name', 'Квас разливной%'));
}

async function main() {
  // справочник наполняется только под служебным ключом, тестовые данные убираются им же
  const admin = env.SUPABASE_SERVICE_ROLE_KEY ? createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
  if (admin) await cleanup(admin);

  const { db: a } = await signUp('owner-a');
  const { db: b } = await signUp('owner-b');

  console.log('Организация');
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const cities = await must(anon.from('cities').select('id, name'));
  check('города видны до входа: они нужны на странице регистрации', cities.length > 80, cities.length);
  const almaty = cities.find((c: Row) => c.name === 'Алматы').id as number;
  const astana = cities.find((c: Row) => c.name === 'Астана').id as number;
  await fails('магазин без города не создаётся', a.rpc('create_org', { p_name: 'Магазин А' }), 'Укажите город');
  const orgA = await must(a.rpc('create_org', {
    p_name: 'Магазин А', p_store: 'Точка на Абая', p_city: almaty, p_profile: { phone: '+7 701 111 22 33', address: 'пр. Абая, 1', bin: '987 654 321 098' },
  }));
  const orgB = await must(b.rpc('create_org', { p_name: 'Магазин Б', p_city: astana }));
  const storesA = await must(a.from('stores').select('*'));
  check('у владельца виден только свой магазин', storesA.length === 1 && storesA[0].org_id === orgA);
  check('торговая точка создана с городом, адресом и телефоном',
    storesA[0].name === 'Точка на Абая' && storesA[0].city_id === almaty && storesA[0].address === 'пр. Абая, 1' && storesA[0].phone === '+7 701 111 22 33', storesA[0]);
  const orgRow = await must(a.from('orgs').select('kind, bin, phone').eq('id', orgA).single());
  check('реквизиты магазина сохранены, БИН очищен от пробелов', orgRow.kind === 'store' && orgRow.bin === '987654321098' && orgRow.phone === '+7 701 111 22 33', orgRow);
  const store = storesA[0].id as string;
  const register = (await must(a.from('registers').select('*')))[0].id as string;

  console.log('Товары');
  const cat = await must(
    a.from('categories').insert({ org_id: orgA, name: 'Напитки', markup_pct: 30 }).select().single(),
  );
  const cola = await must(
    a.from('products')
      .insert({ org_id: orgA, name: 'Кола 1 л', barcode: '4870000000011', category_id: cat.id, purchase_price: 300, sale_price: 450, wholesale_price: 400 })
      .select().single(),
  );
  const apples = await must(
    a.from('products')
      .insert({ org_id: orgA, name: 'Яблоки', unit: 'кг', barcode: '2100001000000', purchase_price: 500, sale_price: 800 })
      .select().single(),
  );
  const service = await must(
    a.from('products')
      .insert({ org_id: orgA, kind: 'service', name: 'Доставка', barcode: '2000000000017', sale_price: 1000 })
      .select().single(),
  );
  await fails('повтор штрихкода отклонён',
    a.from('products').insert({ org_id: orgA, name: 'Дубль', barcode: '4870000000011' }), 'duplicate');
  await fails('чужая организация не может добавить товар',
    b.from('products').insert({ org_id: orgA, name: 'Чужой', barcode: '1' }), 'row-level security');
  check('чужая организация не видит товары', (await must(b.from('products').select('id'))).length === 0);

  console.log('Склад');
  await must(a.rpc('post_stock_doc', {
    p_store: store, p_kind: 'posting', p_comment: 'Начальные остатки',
    p_items: [{ product_id: cola.id, qty: 20, price: 320 }, { product_id: apples.id, qty: 10.5, price: 500 }],
  }));
  await must(a.rpc('post_stock_doc', {
    p_store: store, p_kind: 'writeoff', p_comment: 'Бой', p_items: [{ product_id: cola.id, qty: 2 }],
  }));
  await fails('услугу нельзя оприходовать',
    a.rpc('post_stock_doc', { p_store: store, p_kind: 'posting', p_comment: '', p_items: [{ product_id: service.id, qty: 1 }] }),
    'Услуги');
  await fails('чужой не может оприходовать',
    b.rpc('post_stock_doc', { p_store: store, p_kind: 'posting', p_comment: '', p_items: [{ product_id: cola.id, qty: 1 }] }),
    'Нет доступа');
  const stockRows = await must(a.from('product_stock').select('*').eq('store_id', store));
  eq('остаток колы 18', stockRows.find((r: Row) => r.id === cola.id)?.qty, 18);
  eq('остаток яблок 10.5', stockRows.find((r: Row) => r.id === apples.id)?.qty, 10.5);
  eq('закупочная обновилась при оприходовании',
    (await must(a.from('products').select('purchase_price').eq('id', cola.id).single())).purchase_price, 320);
  const totals = (await must(a.rpc('stock_totals', { p_store: store })))[0];
  eq('сумма склада по закупочной', totals.purchase_sum, 18 * 320 + 10.5 * 500);

  console.log('Касса');
  const shift = await must(a.rpc('open_shift', { p_register: register, p_opening_cash: 5000 }));
  await fails('вторая смена на кассе не открывается', a.rpc('open_shift', { p_register: register }), 'уже открыта');
  await fails('чужой не может продавать в смене',
    b.rpc('create_sale', { p_shift: shift, p_items: [{ product_id: cola.id, qty: 1, price: 450 }] }), 'Нет доступа');
  await fails('подмена цены отклонена',
    a.rpc('create_sale', { p_shift: shift, p_items: [{ product_id: cola.id, qty: 1, price: 1 }] }), 'изменилась');
  await fails('скидка больше суммы отклонена',
    a.rpc('create_sale', { p_shift: shift, p_items: [{ product_id: cola.id, qty: 1, price: 450, discount: 500 }] }), 'скидка');

  // 3 колы по 450 со скидкой 50 + 1.25 кг яблок по 800 + доставка 1000 = 1300 + 1000 + 1000 = 3300
  const sale = await must(a.rpc('create_sale', {
    p_shift: shift,
    p_items: [
      { product_id: cola.id, qty: 3, price: 450, discount: 50 },
      { product_id: apples.id, qty: 1.25, price: 800 },
      { product_id: service.id, qty: 1, price: 1000 },
    ],
    p_paid_card: 1300,
  }));
  eq('сумма чека', sale.total, 3300);
  const saleRow = await must(a.from('sales').select('*, sale_items(*)').eq('id', sale.id).single());
  eq('наличными = сумма − карта', saleRow.paid_cash, 2000);
  eq('себестоимость чека', saleRow.cost, 3 * 320 + 1.25 * 500);
  const stockAfterSale = await must(a.from('product_stock').select('*').eq('store_id', store));
  eq('остаток колы после продажи', stockAfterSale.find((r: Row) => r.id === cola.id)?.qty, 15);
  eq('остаток яблок после продажи', stockAfterSale.find((r: Row) => r.id === apples.id)?.qty, 9.25);

  // оптовая продажа
  const wholesale = await must(a.rpc('create_sale', {
    p_shift: shift, p_items: [{ product_id: cola.id, qty: 10, price: 400 }],
  }));
  eq('оптовая цена принята', wholesale.total, 4000);

  console.log('Возврат');
  const colaLine = saleRow.sale_items.find((i: { product_id: string }) => i.product_id === cola.id);
  await fails('нельзя вернуть больше проданного',
    a.rpc('create_return', { p_shift: shift, p_sale: sale.id, p_items: [{ item_id: colaLine.id, qty: 4 }] }), 'больше');
  const ret = await must(a.rpc('create_return', {
    p_shift: shift, p_sale: sale.id, p_items: [{ item_id: colaLine.id, qty: 1 }],
  }));
  eq('сумма возврата с учётом скидки', ret.total, 433.33);
  await must(a.rpc('create_return', { p_shift: shift, p_sale: sale.id, p_items: [{ item_id: colaLine.id, qty: 2 }] }));
  await fails('повторный возврат сверх остатка отклонён',
    a.rpc('create_return', { p_shift: shift, p_sale: sale.id, p_items: [{ item_id: colaLine.id, qty: 1 }] }), 'больше');
  eq('остаток колы после возвратов',
    (await must(a.from('product_stock').select('qty').eq('store_id', store).eq('id', cola.id).single())).qty, 8);

  console.log('Касса: наличные');
  await must(a.rpc('cash_op', { p_shift: shift, p_kind: 'out', p_amount: 1000, p_comment: 'Инкассация' }));
  await fails('изъятие больше остатка отклонено',
    a.rpc('cash_op', { p_shift: shift, p_kind: 'out', p_amount: 1000000 }), 'недостаточно');
  await must(a.rpc('log_cancel', { p_register: register, p_product: cola.id, p_name: 'Кола 1 л', p_qty_from: 2, p_qty_to: 0 }));
  check('отмена записана', (await must(a.from('canceled_items').select('id'))).length === 1);

  console.log('Отчёты');
  const from = new Date(Date.now() - 3600_000).toISOString();
  const to = new Date(Date.now() + 3600_000).toISOString();
  const byProduct = await must(a.rpc('report_sales', { p_org: orgA, p_from: from, p_to: to, p_group: 'product' }));
  const colaRep = byProduct.find((r: { key: string }) => r.key === cola.id);
  eq('отчёт: продано колы', colaRep.qty_sold, 13);
  eq('отчёт: возвращено колы', colaRep.qty_returned, 3);
  eq('отчёт: выручка по коле', colaRep.revenue, 1300 + 4000 - 1300);
  eq('отчёт: прибыль по коле', colaRep.profit, 4000 - 10 * 320);
  const byCategory = await must(a.rpc('report_sales', { p_org: orgA, p_from: from, p_to: to, p_group: 'category' }));
  check('отчёт по категориям', byCategory.some((r: { label: string }) => r.label === 'Напитки')
    && byCategory.some((r: { label: string }) => r.label === 'Без категории'));
  const byDay = await must(a.rpc('report_sales', { p_org: orgA, p_from: from, p_to: to, p_group: 'day' }));
  eq('отчёт по дням: чеков', byDay.reduce((s: number, r: { receipts: number }) => s + r.receipts, 0), 2);
  const pnl = (await must(a.rpc('report_pnl', { p_org: orgA, p_from: from, p_to: to })))[0];
  eq('P&L: возвраты', pnl.returns_sum, 1300);
  eq('P&L: списания', pnl.writeoffs, 2 * 320);
  const cashiers = await must(a.rpc('report_cashiers', { p_org: orgA, p_from: from, p_to: to }));
  eq('отчёт по кассирам: итого', cashiers[0].total, 3300 + 4000 - 1300);
  check('чужая организация получает пустой отчёт',
    (await must(b.rpc('report_sales', { p_org: orgA, p_from: from, p_to: to }))).length === 0);

  console.log('Закрытие смены');
  // 5000 + 2000 + 4000 наличными − 1300 возвратов − 1000 изъятие = 8700
  const expected = await must(a.rpc('close_shift', { p_shift: shift, p_closing_cash: 8700 }));
  eq('ожидаемые наличные', expected, 8700);
  const shiftRep = (await must(a.rpc('report_shifts', { p_org: orgA, p_from: from, p_to: to })))[0];
  eq('отчёт по смене: наличные', shiftRep.expected_cash, 8700);
  eq('отчёт по смене: чеков', shiftRep.receipts, 2);
  await fails('в закрытую смену продать нельзя',
    a.rpc('create_sale', { p_shift: shift, p_items: [{ product_id: cola.id, qty: 1, price: 450 }] }), 'закрыта');

  console.log('Сотрудники');
  const { db: c, email: cashierEmail } = await signUp('cashier');
  await must(a.from('invites').insert({ org_id: orgA, email: cashierEmail, role: 'cashier' }));
  eq('приглашение принято', await must(c.rpc('accept_invites')), 1);
  check('кассир видит товары', (await must(c.from('products').select('id'))).length === 3);
  await fails('кассир не может менять товары',
    c.from('products').insert({ org_id: orgA, name: 'Левый', barcode: '999' }), 'row-level security');
  await fails('кассир не может оприходовать',
    c.rpc('post_stock_doc', { p_store: store, p_kind: 'posting', p_comment: '', p_items: [{ product_id: cola.id, qty: 5 }] }),
    'Нет доступа');
  const shift2 = await must(c.rpc('open_shift', { p_register: register, p_opening_cash: 0 }));
  await must(c.rpc('create_sale', { p_shift: shift2, p_items: [{ product_id: cola.id, qty: 1, price: 450 }] }));
  await must(c.rpc('close_shift', { p_shift: shift2, p_closing_cash: 450 }));
  check('кассир не может изменить свою роль',
    (await must(c.from('org_members').update({ role: 'owner' }).eq('org_id', orgA).select())).length === 0);

  console.log('Импорт');
  const imp = await must(a.rpc('import_products', {
    p_org: orgA, p_store: store,
    p_rows: [
      { name: 'Кола 1 л', barcode: '4870000000011', sale_price: 470, category: 'Напитки', qty: 100 },
      { name: 'Хлеб', barcode: '4870000000028', unit: 'шт', purchase_price: 120, sale_price: 180, category: 'Выпечка', qty: 30 },
      { name: '', barcode: '' },
    ],
  }));
  check('импорт: создан 1, обновлён 1, пропущен 1', imp.created === 1 && imp.updated === 1 && imp.skipped === 1, imp);
  const colaCard = await must(a.from('products').select('purchase_price, sale_price').eq('id', cola.id).single());
  check('импорт без закупочной цены её не обнуляет', Number(colaCard.purchase_price) === 320 && Number(colaCard.sale_price) === 470, colaCard);
  const afterImport = await must(a.from('product_stock').select('*').eq('store_id', store));
  eq('импорт не трогает ненулевой остаток', afterImport.find((r: Row) => r.id === cola.id)?.qty, 7);
  eq('импорт ставит остаток новому товару', afterImport.find((r: Row) => r.barcode === '4870000000028')?.qty, 30);
  check('чужая организация всё ещё пуста', (await must(b.from('products').select('id'))).length === 0 && !!orgB);

  const stockOf = async (product: string, inStore = store) =>
    Number((await must(a.from('product_stock').select('qty').eq('store_id', inStore).eq('id', product).single())).qty);
  const bread = (await must(a.from('products').select('id').eq('barcode', '4870000000028').single())).id as string;

  console.log('Черновики');
  const colaBefore = await stockOf(cola.id);
  const draft = await must(a.rpc('create_stock_doc', { p_store: store, p_kind: 'posting', p_comment: 'черновик' }));
  await must(a.rpc('set_stock_doc_item', { p_doc: draft, p_product: cola.id, p_qty: 5, p_price: 330 }));
  await must(a.rpc('set_stock_doc_item', { p_doc: draft, p_product: cola.id, p_qty: 7, p_price: 330 }));
  await must(a.rpc('set_stock_doc_item', { p_doc: draft, p_product: apples.id, p_qty: 1 }));
  await must(a.rpc('set_stock_doc_item', { p_doc: draft, p_product: apples.id, p_qty: null }));
  const draftLines = await must(a.rpc('stock_doc_lines', { p_doc: draft }));
  check('в черновике одна строка с последним количеством', draftLines.length === 1 && Number(draftLines[0].qty) === 7, draftLines);
  eq('черновик не трогает остатки', await stockOf(cola.id), colaBefore);
  await fails('кассир не может править черновик',
    c.rpc('set_stock_doc_item', { p_doc: draft, p_product: cola.id, p_qty: 1 }), 'Нет доступа');
  await fails('чужой не может править черновик',
    b.rpc('set_stock_doc_item', { p_doc: draft, p_product: cola.id, p_qty: 1 }), 'Нет доступа');
  await fails('услуга не добавляется в документ',
    a.rpc('set_stock_doc_item', { p_doc: draft, p_product: service.id, p_qty: 1 }), 'Услуги');
  await must(a.rpc('post_stock_doc_draft', { p_doc: draft }));
  eq('проведение добавило остаток', await stockOf(cola.id), colaBefore + 7);
  await fails('проведённый документ не правится',
    a.rpc('set_stock_doc_item', { p_doc: draft, p_product: cola.id, p_qty: 1 }), 'уже проведён');
  await fails('проведённый документ не удаляется', a.rpc('delete_stock_doc', { p_doc: draft }), 'уже проведён');
  const trash = await must(a.rpc('create_stock_doc', { p_store: store, p_kind: 'writeoff' }));
  await fails('пустой документ не проводится', a.rpc('post_stock_doc_draft', { p_doc: trash }), 'Добавьте товары');
  await must(a.rpc('delete_stock_doc', { p_doc: trash }));
  check('черновик удалён', (await must(a.from('stock_docs').select('id').eq('id', trash))).length === 0);

  console.log('Приёмка');
  const supplier = await must(a.from('contractors').insert({ org_id: orgA, kind: 'supplier', name: 'ТОО Фрукты' }).select().single());
  const foreignSupplier = await must(b.from('contractors').insert({ org_id: orgB, kind: 'supplier', name: 'Чужой' }).select().single());
  const applesBefore = await stockOf(apples.id);
  await fails('приёмка без поставщика не проводится',
    a.rpc('post_stock_doc', { p_store: store, p_kind: 'supply', p_comment: '', p_items: [{ product_id: apples.id, qty: 1 }] }), 'поставщика');
  await fails('поставщик чужой организации отклонён',
    a.rpc('create_stock_doc', { p_store: store, p_kind: 'supply', p_supplier: foreignSupplier.id }), 'Поставщик не найден');
  const supply = await must(a.rpc('post_stock_doc', {
    p_store: store, p_kind: 'supply', p_comment: 'Накладная 15',
    p_items: [{ product_id: apples.id, qty: 20, price: 520, sale_price: 850 }], p_supplier: supplier.id,
  }));
  eq('приёмка добавила остаток', await stockOf(apples.id), applesBefore + 20);
  const applesCard = await must(a.from('products').select('purchase_price, sale_price, supplier_id').eq('id', apples.id).single());
  check('приёмка обновила цены и поставщика',
    Number(applesCard.purchase_price) === 520 && Number(applesCard.sale_price) === 850 && applesCard.supplier_id === supplier.id, applesCard);
  eq('сумма приёмки', (await must(a.from('stock_docs').select('total').eq('id', supply).single())).total, 10400);
  await fails('платёж больше долга отклонён', a.rpc('pay_supply', { p_doc: supply, p_amount: 20000 }), 'больше остатка');
  await fails('кассир не может вносить платёж', c.rpc('pay_supply', { p_doc: supply, p_amount: 100 }), 'Нет доступа');
  await must(a.rpc('pay_supply', { p_doc: supply, p_amount: 4000, p_comment: 'Аванс' }));
  await must(a.rpc('pay_supply', { p_doc: supply, p_amount: 6400 }));
  eq('приёмка оплачена полностью', (await must(a.from('stock_docs').select('paid').eq('id', supply).single())).paid, 10400);
  await fails('платёж по закрытому долгу отклонён', a.rpc('pay_supply', { p_doc: supply, p_amount: 1 }), 'больше остатка');
  await fails('платёж по оприходованию отклонён', a.rpc('pay_supply', { p_doc: draft, p_amount: 1 }), 'только по проведённой приёмке');

  console.log('Перемещение');
  const store2 = (await must(a.from('stores').insert({ org_id: orgA, name: 'Склад' }).select().single())).id as string;
  const storeB = (await must(b.from('stores').select('id')))[0].id as string;
  await fails('перемещение в тот же магазин отклонено',
    a.rpc('create_stock_doc', { p_store: store, p_kind: 'transfer', p_to_store: store }), 'другой магазин');
  await fails('перемещение в чужой магазин отклонено',
    a.rpc('create_stock_doc', { p_store: store, p_kind: 'transfer', p_to_store: storeB }), 'Магазин не найден');
  await fails('перемещение без получателя не проводится',
    a.rpc('post_stock_doc', { p_store: store, p_kind: 'transfer', p_comment: '', p_items: [{ product_id: cola.id, qty: 1 }] }), 'Укажите магазин');
  const colaMid = await stockOf(cola.id);
  await must(a.rpc('post_stock_doc', {
    p_store: store, p_kind: 'transfer', p_comment: '', p_items: [{ product_id: cola.id, qty: 4 }], p_to_store: store2,
  }));
  eq('перемещение списало с магазина', await stockOf(cola.id), colaMid - 4);
  eq('перемещение пришло на склад', await stockOf(cola.id, store2), 4);

  console.log('Инвентаризация');
  const colaNow = await stockOf(cola.id);
  const applesNow = await stockOf(apples.id);
  const breadNow = await stockOf(bread);
  const inv = await must(a.rpc('create_stock_doc', { p_store: store, p_kind: 'inventory', p_comment: 'Выборочная' }));
  await must(a.rpc('set_stock_doc_item', { p_doc: inv, p_product: cola.id, p_qty: colaNow - 2 }));
  await must(a.rpc('set_stock_doc_item', { p_doc: inv, p_product: apples.id, p_qty: applesNow + 1.5 }));
  await fails('отрицательное количество отклонено',
    a.rpc('set_stock_doc_item', { p_doc: inv, p_product: bread, p_qty: -1 }), 'отрицательным');
  await must(a.rpc('post_stock_doc_draft', { p_doc: inv }));
  eq('недостача снята с остатка', await stockOf(cola.id), colaNow - 2);
  eq('излишек добавлен к остатку', await stockOf(apples.id), applesNow + 1.5);
  eq('товары вне документа не тронуты', await stockOf(bread), breadNow);
  const colaPrice = Number((await must(a.from('products').select('purchase_price').eq('id', cola.id).single())).purchase_price);
  eq('сумма инвентаризации = излишки − недостача',
    (await must(a.from('stock_docs').select('total').eq('id', inv).single())).total, 1.5 * 520 - 2 * colaPrice);
  const invLines = await must(a.rpc('stock_doc_lines', { p_doc: inv }));
  eq('учётный остаток записан в документ', invLines.find((l: Row) => l.product_id === cola.id).expected, colaNow);

  const full = await must(a.rpc('create_stock_doc', { p_store: store, p_kind: 'inventory', p_comment: 'Полная' }));
  await must(a.rpc('set_stock_doc_item', { p_doc: full, p_product: cola.id, p_qty: colaNow - 2 }));
  await must(a.rpc('post_stock_doc_draft', { p_doc: full, p_zero_missing: true }));
  eq('полная инвентаризация: подсчитанный товар остался', await stockOf(cola.id), colaNow - 2);
  eq('полная инвентаризация: неподсчитанный обнулён', await stockOf(apples.id), 0);
  eq('полная инвентаризация не трогает другой магазин', await stockOf(cola.id, store2), 4);
  const pnl2 = (await must(a.rpc('report_pnl', { p_org: orgA, p_from: from, p_to: to })))[0];
  const invTotals = await must(a.from('stock_docs').select('total').eq('kind', 'inventory'));
  eq('P&L: результат инвентаризаций', pnl2.inventory, invTotals.reduce((s: number, d: Row) => s + Number(d.total), 0));

  console.log('Компании и филиалы');
  const { db: s } = await signUp('company');
  await fails('компания без города не создаётся', s.rpc('create_org', { p_name: 'Завод напитков', p_kind: 'company' }), 'Укажите город');
  await fails('БИН не из 12 цифр отклонён', s.rpc('create_org', { p_name: 'Завод напитков', p_kind: 'company', p_city: almaty, p_profile: { bin: '123' } }), '12 цифр');
  const supOrg = await must(s.rpc('create_org', {
    p_name: 'Завод напитков', p_kind: 'company', p_city: almaty,
    p_profile: { phone: '+7 701 000 00 01', address: 'ул. Заводская, 1', bin: '123456789012', company_type: 'manufacturer', description: 'Напитки' },
  }));
  check('у компании нет магазинов и касс', (await must(s.from('stores').select('id'))).length === 0);
  const profile = await must(s.from('companies').select('*').eq('org_id', supOrg).single());
  check('компания создана отдельным объектом', profile.company_type === 'manufacturer' && profile.description === 'Напитки' && profile.verified === false, profile);
  const mainBranch = await must(s.from('company_branches').select('*').eq('org_id', supOrg).single());
  check('главный филиал создан в городе регистрации', mainBranch.is_main && mainBranch.city_id === almaty && mainBranch.address === 'ул. Заводская, 1', mainBranch);
  await must(s.from('companies').update({ min_order: 5000, delivery_note: 'Привозим по средам' }).eq('org_id', supOrg));
  await fails('отметку «подтверждённая» владелец себе не ставит', s.from('companies').update({ verified: true }).eq('org_id', supOrg).select(), 'permission denied');
  await fails('тип аккаунта не меняется', s.from('orgs').update({ kind: 'store' }).eq('id', supOrg).select(), 'permission denied');
  await must(s.from('orgs').update({ logo_url: 'data:image/webp;base64,AAAA', contact_name: 'Директор' }).eq('id', supOrg));
  await fails('логотип — только картинка', s.from('orgs').update({ logo_url: 'javascript:alert(1)' }).eq('id', supOrg).select(), 'orgs_logo_url_check');
  check('магазин видит профиль и филиалы компании',
    (await must(a.from('companies').select('org_id').eq('org_id', supOrg))).length === 1
    && (await must(a.from('company_branches').select('id').eq('org_id', supOrg))).length === 1);
  await fails('магазин не может завести филиал компании',
    a.from('company_branches').insert({ org_id: supOrg, city_id: astana, name: 'Левый' }), 'row-level security');
  await fails('магазин не может завести филиал себе',
    a.from('company_branches').insert({ org_id: orgA, city_id: astana, name: 'Левый' }), 'row-level security');
  const astanaBranch = (await must(s.from('company_branches').insert({ org_id: supOrg, city_id: astana, name: 'Филиал в Астане' }).select().single())).id as string;
  await fails('главный филиал напрямую не назначается', s.from('company_branches').update({ is_main: true }).eq('id', astanaBranch).select(), 'permission denied');
  await fails('главный филиал не удаляется', s.rpc('delete_company_branch', { p_branch: mainBranch.id }), 'Главный филиал');
  await fails('магазин не может назначить главный филиал', a.rpc('set_main_branch', { p_branch: astanaBranch }), 'Нет доступа');
  await must(s.rpc('set_main_branch', { p_branch: astanaBranch }));
  await must(s.rpc('set_main_branch', { p_branch: mainBranch.id }));
  const mains = await must(s.from('company_branches').select('id').eq('org_id', supOrg).eq('is_main', true));
  check('главный филиал всегда один', mains.length === 1 && mains[0].id === mainBranch.id, mains);
  const directory = await must(a.rpc('company_directory'));
  const card = directory.find((c: Row) => c.id === supOrg);
  check('витрина: города филиалов и условия компании', card?.cities.length === 2 && card.cities[0] === 'Алматы' && Number(card.min_order) === 5000, card);

  console.log('Каталог компании: товар и виды');
  await fails('магазин не может править каталог компании',
    a.from('company_products').insert({ org_id: supOrg, name: 'Левый' }), 'row-level security');
  const imp2 = await must(s.rpc('import_company_products', {
    p_org: supOrg,
    p_rows: [
      { product: 'Кола', label: '1 л', barcode: '4870000000011', price: 350, category: 'Напитки', pack_qty: 6, image_url: 'https://example.test/cola.jpg' },
      { product: 'кола', label: '0,5 л', barcode: '4870000009993', price: 200, pack_qty: 12, stock: 100 },
      { product: 'Новый лимонад', barcode: '4870000009991', price: 200, unit: 'шт' },
      { product: 'Сок', barcode: '4870000009992', price: 400, image_url: 'javascript:alert(1)' },
      { product: '', barcode: '1' },
    ],
  }));
  check('прайс загружен: 4 вида в 3 товарах', imp2.created === 4 && imp2.products === 3, imp2);
  await fails('магазин не может импортировать в чужой каталог', a.rpc('import_company_products', { p_org: supOrg, p_rows: [] }), 'Нет доступа');
  const colaProduct = await must(s.from('company_products').select('id, name, category, company_variants(id, label, barcode, track_stock)').eq('org_id', supOrg).eq('name', 'Кола').single());
  check('виды одного товара собраны вместе', colaProduct.company_variants.length === 2 && colaProduct.category === 'Напитки', colaProduct);
  const variantId = (barcode: string) => colaProduct.company_variants.find((v: Row) => v.barcode === barcode)?.id as string;
  const half = variantId('4870000009993');
  check('остаток из прайса включает учёт', colaProduct.company_variants.find((v: Row) => v.id === half).track_stock === true);
  const again2 = await must(s.rpc('import_company_products', { p_org: supOrg, p_rows: [{ product: 'Кола', label: '0,5 л', barcode: '4870000009993' }] }));
  const halfRow = await must(s.from('company_variants').select('price, pack_qty').eq('id', half).single());
  check('прайс без цены не обнуляет цену', again2.updated === 1 && Number(halfRow.price) === 200 && Number(halfRow.pack_qty) === 12, halfRow);

  let catalog = await must(a.rpc('store_offers', { p_store: store, p_company: supOrg }));
  check('магазин видит предложения компании', catalog.length === 4, catalog);
  const offer = (barcode: string) => catalog.find((p: Row) => p.barcode === barcode);
  check('фото товара: сохраняется только ссылка https', offer('4870000000011').image_url === 'https://example.test/cola.jpg' && offer('4870000009992').image_url === '', catalog);
  check('свободный остаток: число у вида с учётом, без ограничения у остальных', Number(offer('4870000009993').free) === 100 && offer('4870000000011').free === null);
  check('заказ соберёт филиал города магазина', offer('4870000000011').branch_name === 'Главный офис' && offer('4870000000011').local === true, offer('4870000000011'));
  const offersB = await must(b.rpc('store_offers', { p_store: storeB, p_barcodes: ['4870000009993'] }));
  check('магазину из Астаны отвечает филиал в Астане', offersB.length === 1 && offersB[0].branch_id === astanaBranch && Number(offersB[0].free) === 0, offersB);
  await fails('чужой магазин не подставляется в предложения', b.rpc('store_offers', { p_store: store, p_company: supOrg }), 'Нет доступа');
  await fails('фото не по https отклоняется', s.from('company_variants').update({ image_url: 'http://example.test/a.jpg' }).eq('org_id', supOrg).select(), 'company_variants_image_https');
  await fails('повтор штрихкода в каталоге отклонён', s.rpc('save_company_product', {
    p_org: supOrg, p_product: { name: 'Дубль' }, p_variants: [{ label: '', barcode: '4870000000011', price: 1 }],
  }), 'company_variants_barcode_uq');
  const inCatalog = await must(a.rpc('catalog_search', { p_org: orgA, p_term: '4870000009991' }));
  check('товар компании появился в каталоге товаров магазина с предложением', inCatalog.length === 1 && inCatalog[0].mine === false && Number(inCatalog[0].offers) === 1, inCatalog);

  const ownCode = `29${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
  await fails('товар без видов не сохраняется', s.rpc('save_company_product', { p_org: supOrg, p_product: { name: 'Квас' }, p_variants: [] }), 'хотя бы один вид');
  await fails('магазин не может сохранить товар компании', a.rpc('save_company_product', {
    p_org: supOrg, p_product: { name: 'Квас' }, p_variants: [{ barcode: ownCode }],
  }), 'Нет доступа');
  const kvas = await must(s.rpc('save_company_product', {
    p_org: supOrg, p_product: { name: 'Квас разливной', category: 'Напитки', description: 'Живого брожения' },
    p_variants: [
      { label: '', barcode: ownCode, unit: 'л', price: 300, track_stock: true, min_stock: 10, stock: { [mainBranch.id]: 50, [astanaBranch]: 5 } },
      { label: 'кега 30 л', barcode: `${ownCode}1`, unit: 'шт', price: 8000, active: false },
    ],
  }));
  const manual = await must(a.rpc('catalog_search', { p_org: orgA, p_term: ownCode }));
  check('товар, созданный компанией вручную, виден в каталоге товаров',
    manual.some((m: Row) => m.name === 'Квас разливной' && m.unit === 'л' && m.category === 'Напитки'), manual);
  const kvasOffers = await must(a.rpc('store_offers', { p_store: store, p_barcodes: [ownCode, `${ownCode}1`] }));
  check('вид, снятый с продажи, магазинам не виден', kvasOffers.length === 1 && Number(kvasOffers[0].free) === 50, kvasOffers);
  const kvasVariants = await must(s.from('company_variants').select('id, barcode').eq('product_id', kvas).order('sort'));
  await must(s.rpc('save_company_product', {
    p_org: supOrg, p_product: { id: kvas, name: 'Квас разливной', category: 'Напитки' },
    p_variants: [{ id: kvasVariants[0].id, label: '', barcode: ownCode, unit: 'л', price: 320, track_stock: true, stock: { [mainBranch.id]: 60 } }],
  }));
  const kvasAfter = await must(s.from('company_variants').select('barcode, price, archived').eq('product_id', kvas).order('sort'));
  check('сохранение товара: цена обновлена, убранный вид в архиве',
    Number(kvasAfter[0].price) === 320 && kvasAfter[0].archived === false && kvasAfter[1].archived === true, kvasAfter);
  const kvasMoves = await must(s.from('company_stock_moves').select('delta, qty_after, reason').eq('variant_id', kvasVariants[0].id).eq('branch_id', mainBranch.id).order('id'));
  check('история остатков: приход 50, затем правка +10', kvasMoves.length === 2 && Number(kvasMoves[1].delta) === 10 && Number(kvasMoves[1].qty_after) === 60, kvasMoves);
  await fails('магазин не видит склад компании и не правит его',
    a.rpc('set_company_stock', { p_variant: kvasVariants[0].id, p_branch: mainBranch.id, p_qty: 1 }), 'Нет доступа');
  check('магазин не видит остатки компании напрямую', (await must(a.from('company_stock').select('qty'))).length === 0);
  await fails('отрицательный остаток отклонён', s.rpc('set_company_stock', { p_variant: half, p_branch: mainBranch.id, p_qty: -1 }), 'отрицательным');
  await fails('филиал со складом не удаляется', s.rpc('delete_company_branch', { p_branch: astanaBranch }), 'обнулите остатки');
  await must(s.rpc('archive_company_product', { p_product: kvas }));
  check('товар, убранный из каталога, магазинам не виден',
    (await must(a.rpc('store_offers', { p_store: store, p_barcodes: [ownCode] }))).length === 0);

  console.log('Заказы');
  check('магазин видит компанию на витрине', (await must(a.from('orgs').select('id').eq('kind', 'company').eq('id', supOrg))).length === 1);
  check('компания не видит товары магазина', (await must(s.from('products').select('id'))).length === 0);
  const sp = (barcode: string) => offer(barcode).variant_id as string;
  await fails('заказ меньше минимальной суммы отклонён',
    a.rpc('place_order', { p_store: store, p_supplier: supOrg, p_items: [{ variant_id: sp('4870000009992'), qty: 1 }] }), 'Минимальная сумма');
  await fails('кассир не может заказывать',
    c.rpc('place_order', { p_store: store, p_supplier: supOrg, p_items: [{ variant_id: sp('4870000000011'), qty: 100 }] }), 'Нет доступа');
  await fails('заказать больше свободного остатка нельзя',
    a.rpc('place_order', { p_store: store, p_supplier: supOrg, p_items: [{ variant_id: half, qty: 120 }] }), 'Недостаточно на складе');
  const order = await must(a.rpc('place_order', {
    p_store: store, p_supplier: supOrg, p_comment: 'Привезите до обеда',
    p_items: [{ variant_id: sp('4870000000011'), qty: 12 }, { variant_id: half, qty: 24 }, { variant_id: sp('4870000009991'), qty: 10 }, { variant_id: sp('4870000009992'), qty: 5 }],
  }));
  const seen = (await must(s.from('orders').select('*, order_items(*)').eq('id', order).single()));
  eq('компания видит заказ и сумму', seen.total, 12 * 350 + 24 * 200 + 10 * 200 + 5 * 400);
  check('в заказе филиал, город и телефон магазина',
    seen.branch_id === mainBranch.id && seen.branch_name === 'Главный офис' && seen.store_city === 'Алматы' && seen.store_phone === '+7 701 111 22 33', seen);
  check('название в заказе — товар и вид', seen.order_items.some((i: Row) => i.name === 'Кола 0,5 л' && i.variant_id === half), seen.order_items);
  catalog = await must(a.rpc('store_offers', { p_store: store, p_company: supOrg }));
  eq('заказ резервирует остаток', offer('4870000009993').free, 76);
  check('чужой магазин заказа не видит', (await must(b.from('orders').select('id'))).length === 0);
  await fails('чужой не может менять заказ', b.rpc('set_order_status', { p_order: order, p_status: 'canceled' }), 'Нет доступа');
  await fails('магазин не может подтвердить за компанию', a.rpc('set_order_status', { p_order: order, p_status: 'confirmed' }), 'Нет доступа');
  await fails('неотгруженный заказ принять нельзя', a.rpc('receive_order', { p_order: order }), 'только отгруженный');
  const juice = seen.order_items.find((i: Row) => i.barcode === '4870000009992');
  await must(s.rpc('set_order_status', { p_order: order, p_status: 'confirmed', p_items: [{ item_id: juice.id, qty: 0 }], p_comment: 'Сока нет' }));
  await fails('магазин не может отменить подтверждённый заказ', a.rpc('set_order_status', { p_order: order, p_status: 'canceled' }), 'нельзя отменить');
  const stockAt = async (variant: string, branch: string) =>
    Number((await must(s.from('company_stock').select('qty').eq('variant_id', variant).eq('branch_id', branch).maybeSingle()))?.qty ?? 0);
  eq('до отгрузки склад компании не меняется', await stockAt(half, mainBranch.id), 100);
  await must(s.rpc('set_order_status', { p_order: order, p_status: 'shipped' }));
  eq('отгрузка списала товар со склада филиала', await stockAt(half, mainBranch.id), 76);
  const shipMove = await must(s.from('company_stock_moves').select('delta, reason, order_id').eq('variant_id', half).eq('reason', 'shipment'));
  check('отгрузка записана в историю остатков', shipMove.length === 1 && Number(shipMove[0].delta) === -24 && shipMove[0].order_id === order, shipMove);
  await fails('компания не может принять за магазин', s.rpc('receive_order', { p_order: order }), 'Нет доступа');
  const colaStock = await stockOf(cola.id);
  const supplyDoc = await must(a.rpc('receive_order', { p_order: order }));
  const supLines = await must(a.rpc('stock_doc_lines', { p_doc: supplyDoc }));
  check('в черновике приёмки отгруженные товары без отменённого', supLines.length === 3 && supLines.some((l: Row) => l.product_id === cola.id && Number(l.qty) === 12 && Number(l.price) === 350), supLines);
  check('недостающий товар создан в магазине', (await must(a.from('products').select('id').eq('barcode', '4870000009991'))).length === 1);
  eq('до проведения остаток не меняется', await stockOf(cola.id), colaStock);
  await must(a.rpc('post_stock_doc_draft', { p_doc: supplyDoc }));
  eq('после проведения остаток вырос', await stockOf(cola.id), colaStock + 12);
  const done = await must(a.from('orders').select('status, total, supply_doc').eq('id', order).single());
  check('заказ принят и связан с приёмкой', done.status === 'received' && done.supply_doc === supplyDoc && Number(done.total) === 11000, done);
  await fails('повторно принять нельзя', a.rpc('receive_order', { p_order: order }), 'только отгруженный');

  // второй заказ: на складе главного филиала товара не хватает, заказ уходит филиалу в Астане
  const order2 = await must(a.rpc('place_order', { p_store: store, p_supplier: supOrg, p_items: [{ variant_id: half, qty: 60 }] }));
  await must(s.rpc('set_order_status', { p_order: order2, p_status: 'confirmed' }));
  await must(s.rpc('set_company_stock', { p_variant: half, p_branch: mainBranch.id, p_qty: 10, p_comment: 'Пересчёт' }));
  await fails('отгрузка без товара на складе отклонена', s.rpc('set_order_status', { p_order: order2, p_status: 'shipped' }), 'Недостаточно на складе');
  await fails('магазин не может сменить филиал заказа', a.rpc('set_order_branch', { p_order: order2, p_branch: astanaBranch }), 'Нет доступа');
  await must(s.rpc('set_company_stock', { p_variant: half, p_branch: astanaBranch, p_qty: 80 }));
  await must(s.rpc('set_order_branch', { p_order: order2, p_branch: astanaBranch }));
  await fails('филиал с незавершённым заказом не удаляется', s.rpc('delete_company_branch', { p_branch: astanaBranch }), 'незавершённые заказы');
  await must(s.rpc('set_order_status', { p_order: order2, p_status: 'shipped' }));
  eq('отгрузка списала товар с другого филиала', await stockAt(half, astanaBranch), 20);
  eq('склад главного филиала не тронут', await stockAt(half, mainBranch.id), 10);
  await fails('после отгрузки филиал не меняется', s.rpc('set_order_branch', { p_order: order2, p_branch: mainBranch.id }), 'только до отгрузки');
  const stats = await must(s.rpc('company_stats', { p_org: supOrg }));
  const halfStats = stats.find((r: Row) => r.variant_id === half);
  check('статистика вида: продано, выручка, остаток по всем филиалам',
    Number(halfStats.sold_qty) === 84 && Number(halfStats.sold_sum) === 84 * 200 && Number(halfStats.stock) === 30
    && Number(halfStats.reserved) === 0 && Number(halfStats.orders_count) === 2 && Number(halfStats.stores_count) === 1, halfStats);
  check('чужой не получает статистику компании', (await must(a.rpc('company_stats', { p_org: supOrg }))).length === 0);

  if (admin) {

    console.log('Каталог товаров');
    const mark = `Смоук ${randomBytes(3).toString('hex')}`;
    const code = () => `09${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;
    const [codeNew, codeSub] = [code(), code()];
    await must(admin.from('catalog_products').delete().eq('barcode', cola.barcode));
    // у всех строк один набор полей: при пакетной вставке пропущенное поле стало бы null
    const item = (name: string, barcode: string, category = '', subcategory = '', starter_pack = '', business = 'grocery') =>
      ({ name: `${mark} ${name}`, barcode, category, subcategory, starter_pack, business });
    await must(admin.from('catalog_products').insert([
      item('кола', cola.barcode, 'Напитки', '', 'drinks'),
      item('чай', codeNew, `${mark} бакалея`, 'Чай', 'tea'),
      item('кофе', codeSub, `${mark} бакалея`, 'Кофе'),
      item('аспирин', code(), '', '', '', 'pharmacy'),
    ]));
    await fails('пользователь не может править справочник', a.from('catalog_products').insert({ name: 'x', barcode: code() }).select(), 'row-level security');
    const found = await must(a.rpc('catalog_search', { p_org: orgA, p_term: mark }));
    check('поиск по справочнику: товары своего типа магазина', found.length === 3 && Number(found[0].total) === 3, found);
    check('товар с тем же штрихкодом помечен «уже у вас»', found.find((r: Row) => r.barcode === cola.barcode)?.mine === true);
    const onlyNew = await must(a.rpc('catalog_search', { p_org: orgA, p_term: mark, p_only_new: true }));
    check('фильтр «скрыть те, что уже есть»', onlyNew.length === 2 && onlyNew.every((r: Row) => !r.mine), onlyNew);
    const bySub = await must(a.rpc('catalog_search', { p_org: orgA, p_category: `${mark} бакалея`, p_subcategory: 'Чай' }));
    check('отбор по подкатегории', bySub.length === 1 && bySub[0].barcode === codeNew, bySub);
    const cats = await must(a.rpc('catalog_categories', { p_org: orgA }));
    check('категории справочника со счётчиками', cats.filter((c: Row) => c.category === `${mark} бакалея`).length === 2, cats.length);
    const starter = await must(a.rpc('starter_products', { p_org: orgA }));
    check('пакеты для нового магазина', starter.some((r: Row) => r.barcode === codeNew && r.starter_pack === 'tea' && !r.mine));

    await fails('чужая компания не может добавить товары', b.rpc('add_catalog_products', { p_org: orgA, p_ids: found.map((r: Row) => r.id) }), 'Нет доступа');
    await fails('компании справочник недоступен', s.rpc('add_catalog_products', { p_org: supOrg, p_ids: [] }), 'только магазинам');
    const teaId = found.find((r: Row) => r.barcode === codeNew).id;
    const added = await must(a.rpc('add_catalog_products', {
      p_org: orgA, p_ids: found.map((r: Row) => r.id), p_prices: [{ id: teaId, purchase_price: 500, sale_price: 650 }],
    }));
    check('добавлены только новые товары', added.created === 2 && added.skipped === 1, added);
    const tea = await must(a.from('products').select('name, purchase_price, sale_price, categories(name, parent_id)').eq('barcode', codeNew).single());
    check('товар создан с ценами компании и подкатегорией',
      Number(tea.purchase_price) === 500 && Number(tea.sale_price) === 650 && tea.categories?.name === 'Чай' && !!tea.categories?.parent_id, tea);
    const coffee = await must(a.from('products').select('purchase_price, sale_price').eq('barcode', codeSub).single());
    check('товар без предложения создан без цен', Number(coffee.purchase_price) === 0 && Number(coffee.sale_price) === 0, coffee);
    const withOffers = await must(a.rpc('catalog_search', { p_org: orgA, p_term: mark, p_only_offers: true }));
    check('отбор «только с ценами компаний»', withOffers.length === 1 && withOffers[0].barcode === cola.barcode && Number(withOffers[0].offers) === 1, withOffers);
    const again = await must(a.rpc('add_catalog_products', { p_org: orgA, p_ids: found.map((r: Row) => r.id) }));
    check('повторное добавление ничего не дублирует', again.created === 0 && again.skipped === 3, again);

    const { db: ph } = await signUp('pharmacy');
    const phOrg = await must(ph.rpc('create_org', { p_name: 'Аптека', p_business: 'pharmacy', p_city: almaty }));
    check('аптека запоминает тип', (await must(ph.from('orgs').select('business').eq('id', phOrg).single())).business === 'pharmacy');
    const phFound = await must(ph.rpc('catalog_search', { p_org: phOrg, p_term: mark }));
    check('аптека не видит продуктовый справочник', phFound.length === 1 && phFound[0].name.endsWith('аспирин'), phFound);
    await fails('неизвестный тип магазина', ph.rpc('create_org', { p_name: 'X', p_business: 'zoo' }), 'Неизвестный тип');

    await must(admin.from('catalog_products').delete().like('name', `${mark}%`));
    await cleanup(admin);
  }

  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Тест прерван:', e.message);
  process.exit(1);
});
