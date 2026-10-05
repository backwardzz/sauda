// Демо-данные для локальной базы: магазин с товарами, остатками и продажами за две недели.
// Запуск: npm run seed. Логин и пароль демо-аккаунта лежат в .env.local (DEMO_EMAIL, DEMO_PASSWORD).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { splitName } from '../src/lib/variants';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = env.VITE_SUPABASE_URL;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`Сидер пишет демо-данные и запускается только на локальной базе, а в .env.local указано ${url}`);
}
if (!env.DEMO_EMAIL || !env.DEMO_PASSWORD || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('В .env.local нужны DEMO_EMAIL, DEMO_PASSWORD и SUPABASE_SERVICE_ROLE_KEY');
}

const db = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
// второй демо-вход владеет компаниями. Пароль тот же, что у магазина.
const REP_EMAIL = 'rep@sauda.test';
const rep = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// служебный вход для разработки: на сайте логин «dev», пароль «admin1». Владелец всех демо-компаний.
const DEV_EMAIL = 'dev@sauda.test';
const DEV_PASSWORD = 'admin1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(p: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

// детерминированный генератор: демо выглядит одинаково при каждом запуске
let state = 20261003;
const rnd = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(list: T[]) => list[int(0, list.length - 1)];

const CATALOG: [category: string, supplier: string, items: [name: string, unit: string, buy: number, sell: number, qty: number, min?: number][]][] = [
  ['Напитки', 'ТОО «Напитки Азии»', [
    ['Вода питьевая 0,5 л', 'шт', 90, 150, 240, 30], ['Вода питьевая 1,5 л', 'шт', 160, 250, 180, 24], ['Холодный чай лимон 1 л', 'шт', 500, 750, 96, 12],
    ['Газировка кола 1 л', 'шт', 540, 710, 120, 12], ['Газировка кола 0,5 л', 'шт', 330, 450, 144], ['Сок яблочный 1 л', 'шт', 520, 720, 60, 10],
    ['Энергетик 0,45 л', 'шт', 455, 600, 72, 12], ['Квас 1,5 л', 'шт', 420, 590, 36],
  ]],
  ['Выпечка', 'ИП Пекарня', [
    ['Хлеб пшеничный', 'шт', 120, 140, 40, 15], ['Батон нарезной', 'шт', 230, 255, 30, 10], ['Лепёшка тандырная', 'шт', 140, 170, 35, 10],
    ['Булочка с маком', 'шт', 110, 200, 24], ['Самса с мясом', 'шт', 250, 400, 20],
  ]],
  ['Молочные продукты', 'ТОО «Молочный двор»', [
    ['Молоко 3,2% 1 л', 'шт', 430, 560, 48, 12], ['Кефир 2,5% 1 л', 'шт', 410, 540, 36, 10], ['Сметана 20% 400 г', 'шт', 620, 790, 24],
    ['Творог 9% 500 г', 'шт', 890, 1150, 18, 6], ['Масло сливочное 180 г', 'шт', 1250, 1590, 20, 5], ['Сыр твёрдый', 'кг', 3900, 5200, 12],
  ]],
  ['Снеки и сладости', 'ТОО «Сладкий мир»', [
    ['Чипсы картофельные 80 г', 'шт', 390, 540, 80, 15], ['Шоколад молочный 90 г', 'шт', 480, 690, 70, 10], ['Печенье овсяное 300 г', 'шт', 520, 720, 40],
    ['Жвачка мятная', 'шт', 160, 250, 150], ['Конфеты шоколадные', 'кг', 2600, 3600, 15, 3], ['Семечки жареные 100 г', 'шт', 210, 320, 60],
  ]],
  ['Овощи и фрукты', 'КХ «Жетысу»', [
    ['Картофель', 'кг', 150, 200, 300, 40], ['Лук репчатый', 'кг', 120, 180, 120, 20], ['Морковь', 'кг', 160, 240, 80], ['Яблоки', 'кг', 500, 800, 60, 10],
    ['Бананы', 'кг', 720, 990, 45, 10], ['Помидоры', 'кг', 650, 950, 30],
  ]],
  ['Хозтовары', 'ТОО «Быт-Опт»', [
    ['Туалетная бумага', 'шт', 56, 100, 200, 30], ['Спички', 'шт', 9, 20, 300], ['Пакет-майка', 'шт', 8, 20, 500, 100], ['Губки для посуды 5 шт', 'шт', 240, 390, 40],
    ['Средство для посуды 500 мл', 'шт', 650, 890, 3, 5],
  ]],
];

function barcode(n: number, unit: string): string {
  const body = unit === 'кг' ? `21${String(n).padStart(5, '0')}00000` : `487${String(100000000 + n).slice(1)}0`.padEnd(12, '0').slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (sum % 10)) % 10);
}

/** Создаёт вход dev / admin1 (если его нет) и делает его владельцем демо-магазина и демо-поставщиков. */
async function addDevUser() {
  const users = (await must(admin.auth.admin.listUsers({ perPage: 1000 }))).users as { id: string; email?: string }[];
  let devId = users.find((u) => u.email === DEV_EMAIL)?.id;
  if (!devId) {
    const created = await must(admin.auth.admin.createUser({ email: DEV_EMAIL, password: DEV_PASSWORD, email_confirm: true, user_metadata: { full_name: 'Разработчик' } }));
    devId = created.user.id as string;
  } else {
    await must(admin.auth.admin.updateUserById(devId, { password: DEV_PASSWORD }));
  }
  const ids = new Set<string>();
  for (const client of [db, rep]) {
    const { data } = await client.auth.getUser();
    if (!data.user) continue;
    for (const m of await must(admin.from('org_members').select('org_id').eq('user_id', data.user.id))) ids.add(m.org_id);
  }
  const rows = [...ids].map((org_id) => ({ org_id, user_id: devId, role: 'owner' }));
  if (rows.length) await must(admin.from('org_members').upsert(rows, { onConflict: 'org_id,user_id' }));
  console.log(`Вход для разработки: логин dev, пароль ${DEV_PASSWORD} (компаний: ${rows.length})`);
}

async function main() {
  const signIn = await db.auth.signInWithPassword({ email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD });
  if (signIn.error) {
    const signUp = await db.auth.signUp({ email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD, options: { data: { full_name: 'Айгерим Демо' } } });
    if (signUp.error) throw signUp.error;
  }
  // сидер владеет только демо-магазином: другие компании аккаунта (например, с настоящей базой товаров) не трогает
  const memberships = await must(db.from('org_members').select('org_id, orgs(name)'));
  const existing = memberships.filter((m: { orgs: { name: string } | null }) => m.orgs?.name === 'Демо-магазин');
  if (existing.length > 0) {
    if (!process.argv.includes('--fresh')) {
      await addDevUser();
      console.log('Демо-магазин уже создан. Чтобы пересоздать его с нуля: npm run seed -- --fresh');
      return;
    }
    // пользователь остаётся прежним, поэтому открытая в браузере сессия не слетает
    for (const m of existing) await must(admin.from('orgs').delete().eq('id', m.org_id));
  }

  const cities = (await must(db.from('cities').select('id, name'))) as { id: number; name: string }[];
  const city = (name: string) => cities.find((c) => c.name === name)!.id;
  const org = await must(db.rpc('create_org', {
    p_name: 'Демо-магазин', p_store: 'Магазин на Абая', p_city: city('Алматы'),
    p_profile: { phone: '+7 701 555 10 10', address: 'пр. Абая, 10', email: env.DEMO_EMAIL, contact_name: 'Айгерим Демо' },
  }));
  const store = (await must(db.from('stores').select('id').eq('org_id', org)))[0].id;
  const register = (await must(db.from('registers').select('id').eq('org_id', org)))[0].id;
  const warehouse = (await must(db.from('stores').insert({ org_id: org, name: 'Склад на Толе би', city_id: city('Алматы'), address: 'ул. Толе би, 120' }).select().single())).id;
  /** Документ проведён «сейчас»: переносим его на нужный день и час демо-периода. */
  const backdate = async (doc: string, day: Date, hour: number) => {
    const at = new Date(day);
    at.setHours(hour, 15, 0, 0);
    await must(admin.from('stock_docs').update({ created_at: at.toISOString() }).eq('id', doc));
    await must(admin.from('doc_payments').update({ created_at: at.toISOString() }).eq('doc_id', doc));
  };

  type P = { id: string; unit: string; sale_price: number; wholesale_price: number; supplier_id: string };
  const products: (P & { stock: number; initial: number; buy: number })[] = [];
  const postings: { product_id: string; qty: number; price: number }[] = [];
  let n = 1;
  const contractorByName = new Map<string, string>();
  for (const [category, supplier, items] of CATALOG) {
    const cat = await must(db.from('categories').insert({ org_id: org, name: category, markup_pct: 30 }).select().single());
    const sup = await must(db.from('contractors').insert({ org_id: org, kind: 'supplier', name: supplier }).select().single());
    contractorByName.set(supplier, sup.id);
    for (const [name, unit, buy, sell, stock, min] of items) {
      const p = await must(
        db.from('products').insert({
          org_id: org, name, unit, barcode: barcode(n++, unit), category_id: cat.id, supplier_id: sup.id,
          purchase_price: buy, sale_price: sell, wholesale_price: unit === 'шт' && sell >= 500 ? Math.round(sell * 0.93) : 0, min_stock: min ?? null,
        }).select().single(),
      );
      products.push({ ...p, stock, initial: stock, buy });
      postings.push({ product_id: p.id, qty: stock, price: buy });
    }
  }
  await must(db.from('products').insert({ org_id: org, kind: 'service', name: 'Доставка по району', barcode: barcode(n++, 'шт'), sale_price: 500 }));

  for (const [i, name] of ['Выпечка', 'Овощи и фрукты', 'На развес'].entries()) {
    const g = await must(db.from('quick_groups').insert({ org_id: org, name, sort: i }).select().single());
    const cats = name === 'На развес' ? ['Сыр твёрдый', 'Конфеты шоколадные'] : null;
    const list = await must(db.from('products').select('id, name, categories(name)').eq('org_id', org));
    const ids = list
      .filter((p: { name: string; categories: { name: string } | null }) => (cats ? cats.includes(p.name) : p.categories?.name === name))
      .map((p: { id: string }) => p.id);
    await must(db.from('products').update({ quick_group_id: g.id }).in('id', ids));
  }

  const customers = [];
  for (const name of ['Кафе «Достар»', 'Школа № 12', 'Ержан (сосед)']) {
    customers.push((await must(db.from('contractors').insert({ org_id: org, kind: 'customer', name }).select().single())).id);
  }

  await must(db.rpc('post_stock_doc', { p_store: store, p_kind: 'posting', p_comment: 'Начальные остатки', p_items: postings }));
  await must(db.rpc('post_stock_doc', {
    p_store: store, p_kind: 'writeoff', p_comment: 'Истёк срок годности',
    p_items: [{ product_id: products[13].id, qty: 3 }, { product_id: products[16].id, qty: 2 }],
  }));
  products[13].stock -= 3;
  products[16].stock -= 2;

  const DAYS = 14;
  for (let d = DAYS - 1; d >= 0; d--) {
    const day = new Date();
    day.setDate(day.getDate() - d);
    if (d === 6) {
      // поставки в середине периода: по приёмке на поставщика, остатки возвращаются к начальным
      const low = products.filter((p) => p.stock < p.initial * 0.6);
      const bySupplier = new Map<string, typeof low>();
      for (const p of low) bySupplier.set(p.supplier_id, [...(bySupplier.get(p.supplier_id) ?? []), p]);
      let i = 0;
      for (const [supplier, list] of bySupplier) {
        const doc = await must(db.rpc('post_stock_doc', {
          p_store: store, p_kind: 'supply', p_comment: `Накладная № ${int(100, 999)}`, p_supplier: supplier,
          p_items: list.map((p) => ({ product_id: p.id, qty: Math.round((p.initial - p.stock) * 1000) / 1000, price: p.buy })),
        }));
        const total = Number((await must(db.from('stock_docs').select('total').eq('id', doc).single())).total);
        // первая приёмка оплачена целиком, вторая наполовину, остальные ждут оплаты
        if (i === 0) await must(db.rpc('pay_supply', { p_doc: doc, p_amount: total, p_comment: 'Наличными при получении' }));
        if (i === 1) await must(db.rpc('pay_supply', { p_doc: doc, p_amount: Math.round(total / 2), p_comment: 'Аванс' }));
        await backdate(doc, day, 8);
        for (const p of list) p.stock = p.initial;
        i++;
      }
    }
    if (d === 3) {
      const moved = products.filter((p) => p.unit === 'шт' && p.stock > 60).slice(0, 5);
      const doc = await must(db.rpc('post_stock_doc', {
        p_store: store, p_kind: 'transfer', p_comment: 'Запас на склад', p_to_store: warehouse,
        p_items: moved.map((p) => ({ product_id: p.id, qty: 20 })),
      }));
      await backdate(doc, day, 8);
      for (const p of moved) p.stock -= 20;
    }
    if (d === 1) {
      // выборочная инвентаризация: у пары товаров недостача, у одного излишек
      const counted = products.filter((p) => p.unit === 'шт' && p.stock > 10).slice(5, 11);
      const diffs = [-2, 0, -1, 0, 3, 0];
      const doc = await must(db.rpc('post_stock_doc', {
        p_store: store, p_kind: 'inventory', p_comment: 'Выборочная проверка',
        p_items: counted.map((p, k) => ({ product_id: p.id, qty: p.stock + diffs[k] })),
      }));
      await backdate(doc, day, 8);
      counted.forEach((p, k) => (p.stock += diffs[k]));
    }
    const shift = await must(db.rpc('open_shift', { p_register: register, p_opening_cash: 10000 }));
    const sales = d === 0 ? 6 : int(9, 18);
    const made: string[] = [];
    for (let s = 0; s < sales; s++) {
      const basket = new Map<string, { product_id: string; qty: number; price: number; discount?: number }>();
      for (let k = int(1, 5); k > 0; k--) {
        const p = pick(products);
        const qty = p.unit === 'кг' ? int(3, 25) / 10 : int(1, 3);
        // не продаём больше, чем есть: остатки в демо не уходят в минус
        if (p.stock < qty || basket.has(p.id)) continue;
        p.stock -= qty;
        const wholesale = Number(p.wholesale_price) > 0 && rnd() < 0.08;
        const price = wholesale ? Number(p.wholesale_price) : Number(p.sale_price);
        basket.set(p.id, { product_id: p.id, qty, price, discount: rnd() < 0.07 ? Math.round(price * qty * 0.1) : 0 });
      }
      const items = [...basket.values()];
      if (!items.length) continue;
      const total = items.reduce((a, i) => a + Math.round(i.price * i.qty * 100) / 100 - (i.discount ?? 0), 0);
      const mode = rnd();
      const res = await must(db.rpc('create_sale', {
        p_shift: shift, p_items: items,
        p_paid_card: mode < 0.45 ? Math.round(total * 100) / 100 : mode < 0.5 ? Math.floor(total / 2) : 0,
        p_customer: rnd() < 0.12 ? pick(customers) : null,
      }));
      made.push(res.id);
    }
    if (d > 0 && d % 4 === 0) {
      const sale = await must(db.from('sales').select('id, sale_items(id, qty)').eq('id', made[0]).single());
      await must(db.rpc('create_return', { p_shift: shift, p_sale: sale.id, p_items: [{ item_id: sale.sale_items[0].id, qty: sale.sale_items[0].qty }] }));
    }
    if (d > 0) {
      await must(db.rpc('cash_op', { p_shift: shift, p_kind: 'out', p_amount: 5000, p_comment: 'Инкассация' }));
      const expected = await must(db.rpc('close_shift', { p_shift: shift, p_closing_cash: null }));
      if (d === 5) await must(admin.from('shifts').update({ closing_cash: expected - 350 }).eq('id', shift));
    }

    // продажи созданы «сейчас»: разносим их по рабочему дню d дней назад
    const all = await must(admin.from('sales').select('id').eq('shift_id', shift).order('number'));
    const open = new Date(day);
    open.setHours(9, 0, 0, 0);
    const hours = d === 0 ? Math.max((Date.now() - open.getTime()) / 3600_000 - 0.2, 0.5) : 12;
    for (const [i, s] of all.entries()) {
      const at = new Date(open.getTime() + ((i + 0.5) / all.length) * hours * 3600_000);
      await must(admin.from('sales').update({ created_at: at.toISOString() }).eq('id', s.id));
    }
    const patch: Record<string, string> = { opened_at: (d === 0 && open.getTime() > Date.now() ? new Date(Date.now() - 3600_000) : open).toISOString() };
    if (d > 0) patch.closed_at = new Date(open.getTime() + 12.5 * 3600_000).toISOString();
    await must(admin.from('shifts').update(patch).eq('id', shift));
  }

  // незаконченная инвентаризация: показывает, как выглядит черновик
  const draft = await must(db.rpc('create_stock_doc', { p_store: store, p_kind: 'inventory', p_comment: 'Напитки, начали считать' }));
  for (const p of products.slice(0, 4)) await must(db.rpc('set_stock_doc_item', { p_doc: draft, p_product: p.id, p_qty: Math.max(p.stock - 1, 0) }));

  // ── Компании на площадке: профили, филиалы, каталоги с видами и остатками, заказы в разных статусах ──
  if ((await rep.auth.signInWithPassword({ email: REP_EMAIL, password: env.DEMO_PASSWORD })).error) {
    const up = await rep.auth.signUp({ email: REP_EMAIL, password: env.DEMO_PASSWORD, options: { data: { full_name: 'Данияр Торговый' } } });
    if (up.error) throw up.error;
  }
  // пересоздаются только компании этого сидера: демо-компании с известными марками (seed:brands) остаются
  const mine = (await must(rep.from('org_members').select('org_id, orgs(name)'))) as { org_id: string; orgs: { name: string } | null }[];

  interface Demo {
    name: string;
    type: 'manufacturer' | 'distributor' | 'wholesaler';
    profile: { phone: string; address: string; description: string };
    terms: { min_order: number; delivery_note: string; payment_terms: string; website: string };
    /** филиалы кроме главного офиса в Алматы */
    branches: { city: string; name: string; address: string; phone: string; manager_name: string; work_hours: string }[];
    extra: [name: string, unit: string, price: number, pack: number, category: string][];
  }
  const COMPANIES: Demo[] = [
    {
      name: 'ТОО «Напитки Азии»', type: 'manufacturer',
      profile: { phone: '+7 701 000 11 22', address: 'ул. Рыскулова, 57', description: 'Вода, соки, газировка и энергетики. Прямые поставки с завода.' },
      terms: { min_order: 15000, delivery_note: 'Доставка пн, ср, пт. Заказ до 17:00 накануне', payment_terms: 'Наличными или переводом при получении', website: 'https://napitki-azii.example' },
      branches: [
        { city: 'Астана', name: 'Филиал в Астане', address: 'ш. Алаш, 24', phone: '+7 701 000 11 33', manager_name: 'Ерлан Сапаров', work_hours: 'пн–сб, 9:00–18:00' },
        { city: 'Шымкент', name: 'Филиал в Шымкенте', address: 'Тамерлановское ш., 99', phone: '+7 701 000 11 44', manager_name: 'Бауыржан Нурлыбек', work_hours: 'пн–пт, 9:00–18:00' },
      ],
      extra: [
        ['Морс клюквенный 1 л', 'шт', 480, 6, 'Соки'], ['Вода газированная 0,5 л', 'шт', 95, 12, 'Вода'], ['Вода газированная 1,5 л', 'шт', 170, 6, 'Вода'],
        ['Вода питьевая 5 л', 'шт', 390, 2, 'Напитки'], ['Лимонад «Дюшес» 0,5 л', 'шт', 210, 12, 'Газировка'], ['Лимонад «Дюшес» 1,5 л', 'шт', 390, 6, 'Газировка'],
        ['Газировка кола 1,5 л', 'шт', 690, 6, 'Напитки'], ['Газировка кола 2 л', 'шт', 820, 6, 'Напитки'], ['Сок яблочный 0,2 л', 'шт', 150, 27, 'Напитки'], ['Сок яблочный 2 л', 'шт', 940, 6, 'Напитки'],
      ],
    },
    {
      name: 'ТОО «Молочный двор»', type: 'manufacturer',
      profile: { phone: '+7 702 000 33 44', address: 'ул. Бекмаханова, 96', description: 'Молоко, кефир, сметана, творог и сыр собственного производства.' },
      terms: { min_order: 10000, delivery_note: 'Привозим каждый день до 9:00', payment_terms: 'Отсрочка 7 дней для постоянных клиентов', website: '' },
      branches: [{ city: 'Конаев', name: 'Склад в Конаеве', address: 'ул. Индустриальная, 3', phone: '+7 702 000 33 55', manager_name: 'Гульнар Ахметова', work_hours: 'ежедневно, 6:00–15:00' }],
      extra: [
        ['Йогурт питьевой клубника 290 г', 'шт', 310, 8, 'Йогурты'], ['Йогурт питьевой клубника 450 г', 'шт', 440, 6, 'Йогурты'], ['Ряженка 4% 450 г', 'шт', 360, 6, 'Кисломолочные'],
        ['Айран 0,5 л', 'шт', 240, 12, 'Кисломолочные'], ['Айран 1 л', 'шт', 420, 6, 'Кисломолочные'], ['Молоко 3,2% 0,5 л', 'шт', 250, 12, 'Молочные продукты'], ['Сметана 20% 200 г', 'шт', 340, 12, 'Молочные продукты'],
      ],
    },
    {
      name: 'ТОО «Сладкий мир»', type: 'distributor',
      profile: { phone: '+7 705 000 55 66', address: 'пр. Суюнбая, 153', description: 'Шоколад, печенье, конфеты и снеки от ведущих производителей.' },
      terms: { min_order: 20000, delivery_note: 'Доставка по вторникам и четвергам', payment_terms: 'Оплата при получении', website: '' },
      branches: [{ city: 'Караганда', name: 'Филиал в Караганде', address: 'ул. Складская, 8', phone: '+7 705 000 55 77', manager_name: 'Асель Жумабаева', work_hours: 'пн–пт, 9:00–18:00' }],
      extra: [
        ['Вафли шоколадные 200 г', 'шт', 340, 10, 'Печенье и вафли'], ['Мармелад жевательный 80 г', 'шт', 190, 20, 'Конфеты'], ['Батончик ореховый 45 г', 'шт', 150, 24, 'Шоколад'],
        ['Шоколад молочный 200 г', 'шт', 950, 10, 'Снеки и сладости'], ['Чипсы картофельные 150 г', 'шт', 640, 12, 'Снеки и сладости'],
      ],
    },
  ];

  type Item = { id: string; name: string; barcode: string; price: number; pack_qty: number };
  const companyOrgs: { id: string; main: string; items: Item[] }[] = [];
  for (const c of COMPANIES) {
    for (const m of mine.filter((x) => x.orgs?.name === c.name)) await must(admin.from('orgs').delete().eq('id', m.org_id));
    const id = (await must(rep.rpc('create_org', {
      p_name: c.name, p_kind: 'company', p_city: city('Алматы'),
      p_profile: { ...c.profile, company_type: c.type, email: REP_EMAIL, contact_name: 'Данияр Торговый' },
    }))) as string;
    await must(rep.from('companies').update(c.terms).eq('org_id', id));
    for (const b of c.branches) {
      await must(rep.from('company_branches').insert({ org_id: id, city_id: city(b.city), name: b.name, address: b.address, phone: b.phone, manager_name: b.manager_name, work_hours: b.work_hours }));
    }
    const branches = (await must(rep.from('company_branches').select('id, is_main').eq('org_id', id).order('created_at'))) as { id: string; is_main: boolean }[];
    const main = branches.find((b) => b.is_main)!.id;

    const cid = contractorByName.get(c.name)!;
    const category = CATALOG.find(([, sName]) => sName === c.name)![0];
    const rows = [
      // те же штрихкоды, что в демо-магазине: магазин видит свои остатки рядом с ценой компании
      ...products.filter((p) => p.supplier_id === cid).map((p) => ({ name: (p as unknown as { name: string }).name, barcode: (p as unknown as { barcode: string }).barcode, unit: p.unit, price: p.buy, category, pack_qty: p.unit === 'кг' ? 1 : 6 })),
      ...c.extra.map(([name, unit, price, pack, cat]) => ({ name, barcode: barcode(n++, unit), unit, price, category: cat, pack_qty: pack })),
    ];
    await must(rep.rpc('import_company_products', {
      p_org: id,
      // размер в названии становится видом товара: «Вода питьевая 0,5 л» и «5 л» — один товар; на главном складе 20–60 упаковок
      p_rows: rows.map((r) => ({ ...splitName(r.name), barcode: r.barcode, unit: r.unit, price: r.price, category: r.category, pack_qty: r.pack_qty, stock: r.pack_qty * int(20, 60) })),
    }));
    await must(admin.from('contractors').update({ partner_org_id: id }).eq('id', cid));

    const variants = (await must(rep.from('company_variants').select('id, label, barcode, price, pack_qty, company_products(name)').eq('org_id', id))) as
      { id: string; label: string; barcode: string; price: number; pack_qty: number; company_products: { name: string } }[];
    const items = variants
      .map((v) => ({ id: v.id, name: `${v.company_products.name} ${v.label}`.trim(), barcode: v.barcode, price: v.price, pack_qty: v.pack_qty }))
      .sort((x, y) => x.name.localeCompare(y.name, 'ru'));
    // в остальных филиалах запас меньше и не по всем товарам
    for (const b of branches.filter((x) => !x.is_main)) {
      for (const v of items.filter((_, k) => k % 3 !== 2)) {
        await must(rep.rpc('set_company_stock', { p_variant: v.id, p_branch: b.id, p_qty: Number(v.pack_qty) * int(4, 15) }));
      }
    }
    // начальные остатки появились до первых заказов: история склада читается по порядку
    await must(admin.from('company_stock_moves').update({ created_at: new Date(Date.now() - 14 * 86400_000).toISOString() }).eq('org_id', id));
    companyOrgs.push({ id, main, items });
  }

  // заказы демо-магазина: принятые (история продаж компаний), отгруженный (можно принимать), подтверждённый и новый
  const order = async (sup: number, picks: [number, number][], comment: string, daysAgo: number, to: 'new' | 'confirmed' | 'shipped' | 'received') => {
    const cat = companyOrgs[sup];
    const id = await must(db.rpc('place_order', { p_store: store, p_supplier: cat.id, p_comment: comment, p_items: picks.map(([i, packs]) => ({ variant_id: cat.items[i].id, qty: packs * Number(cat.items[i].pack_qty) })) }));
    if (to !== 'new') await must(rep.rpc('set_order_status', { p_order: id, p_status: 'confirmed', p_comment: 'Привезём в ближайшую доставку' }));
    if (to === 'shipped' || to === 'received') await must(rep.rpc('set_order_status', { p_order: id, p_status: 'shipped' }));
    if (to === 'received') await must(db.rpc('post_stock_doc_draft', { p_doc: await must(db.rpc('receive_order', { p_order: id })) }));
    const at = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    const sent = to === 'shipped' || to === 'received';
    await must(admin.from('orders').update({ created_at: at, ...(to !== 'new' ? { confirmed_at: at } : {}), ...(sent ? { shipped_at: at } : {}) }).eq('id', id));
    await must(admin.from('company_stock_moves').update({ created_at: at }).eq('order_id', id));
  };
  await order(1, [[0, 4], [1, 3], [3, 2], [5, 2]], 'Как обычно, к открытию', 12, 'received');
  await order(0, [[0, 6], [2, 5], [5, 4], [9, 3]], '', 9, 'received');
  await order(2, [[0, 4], [1, 3], [3, 4], [6, 2]], '', 6, 'received');
  await order(1, [[0, 5], [2, 4], [6, 3], [8, 2]], 'Как обычно, к открытию', 5, 'received');
  await order(0, [[0, 5], [1, 5], [2, 4], [4, 6], [7, 4]], 'Разгрузка со двора', 1, 'shipped');
  await order(2, [[0, 6], [2, 4], [4, 5], [6, 3], [7, 2]], '', 1, 'confirmed');
  await order(1, [[0, 6], [2, 4], [4, 3], [6, 2]], 'Нужно до пятницы', 0, 'new');

  // один товар закончился у компании: в каталоге он виден, но заказать нельзя; у каждой компании по виду на исходе
  const sweets = companyOrgs[2];
  const soldOut = sweets.items.find((i) => i.name === 'Шоколад молочный 200 г')!;
  await must(rep.rpc('set_company_stock', { p_variant: soldOut.id, p_branch: sweets.main, p_qty: 0, p_comment: 'Ждём поставку' }));
  for (const [k, c] of companyOrgs.entries()) {
    const v = c.items[c.items.length - 1 - k];
    await must(rep.from('company_variants').update({ min_stock: Number(v.pack_qty) * 5 }).eq('id', v.id));
    await must(rep.rpc('set_company_stock', { p_variant: v.id, p_branch: c.main, p_qty: Number(v.pack_qty) * 3 }));
  }

  // пара товаров на критическом остатке: на них видно «Заказать всё, что заканчивается»
  for (const [name, min] of [['Сметана 20% 400 г', 12], ['Молоко 3,2% 1 л', 30], ['Вода питьевая 1,5 л', 200]] as const) {
    await must(db.from('products').update({ min_stock: min }).eq('org_id', org).eq('name', name));
  }

  await addDevUser();
  console.log(`Компании: ${COMPANIES.length} с филиалами, каталогами, остатками и 7 заказами. Вход компании: ${REP_EMAIL}, пароль тот же`);
  console.log(`Готово: «Демо-магазин», товаров ${products.length + 1}, продажи за ${DAYS} дней. Вход: ${env.DEMO_EMAIL}, пароль в .env.local`);
}

main().catch((e) => {
  console.error('Сидер прерван:', e.message);
  process.exit(1);
});
