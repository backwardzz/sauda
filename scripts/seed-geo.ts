// Демо-данные для «Аналитики» компании: магазины в разных городах и их заказы у демо-компаний.
// Без них все заказы идут из одного города и смотреть в аналитике нечего. Работает только с локальной базой.
// Остальные демо-данные не трогает; повторный запуск пересоздаёт только свои магазины.
//   npm run seed:geo     — после npm run seed (нужны демо-компании)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = env.VITE_SUPABASE_URL;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`Демо-магазины создаются только в локальной базе, а в .env.local указано ${url}`);
}

const REP_EMAIL = 'rep@sauda.test';
const CLIENTS_EMAIL = 'clients@sauda.test';
const client = () => createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const db = client();
const rep = client();
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(p: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

// один и тот же набор при каждом запуске: цифры в аналитике не скачут
let seed = 20261008;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

/** Магазин, город и «аппетит»: доля компаний, у которых он заказывает. Магазины с нулём — города без заказов. */
const STORES: [name: string, city: string, appetite: number][] = [
  ['Магазин «Арай»', 'Алматы', 0.9], ['Минимаркет «Достык»', 'Алматы', 0.6], ['Продукты у дома', 'Алматы', 0.4],
  ['Магазин «Сарыарка»', 'Астана', 0.8], ['Маркет «Есиль»', 'Астана', 0.5],
  ['Магазин «Береке»', 'Шымкент', 0.7], ['Дукен «Нур»', 'Шымкент', 0.3],
  ['Магазин «Шахтёр»', 'Караганда', 0.7], ['Продукты «Темир»', 'Темиртау', 0.3],
  ['Магазин «Жетысу»', 'Конаев', 0.6], ['Магазин «Алтай»', 'Семей', 0.4],
  ['Маркет «Каспий»', 'Актау', 0.3], ['Магазин «Иртыш»', 'Павлодар', 0],
  ['Магазин «Тобол»', 'Костанай', 0], ['Магазин «Жайык»', 'Атырау', 0],
];

async function main() {
  if ((await db.auth.signInWithPassword({ email: CLIENTS_EMAIL, password: env.DEMO_PASSWORD })).error) {
    const up = await db.auth.signUp({ email: CLIENTS_EMAIL, password: env.DEMO_PASSWORD, options: { data: { full_name: 'Демо-магазины' } } });
    if (up.error) throw up.error;
  }
  if ((await rep.auth.signInWithPassword({ email: REP_EMAIL, password: env.DEMO_PASSWORD })).error) {
    throw new Error('Нет демо-компаний: сначала npm run seed');
  }

  const old = (await must(db.from('org_members').select('org_id'))) as { org_id: string }[];
  for (const o of old) await must(admin.from('orgs').delete().eq('id', o.org_id));

  const cities = (await must(db.from('cities').select('id, name'))) as { id: number; name: string }[];
  const companies = (await must(rep.from('org_members').select('org_id, orgs!inner(name, kind)').eq('orgs.kind', 'company'))) as { org_id: string }[];
  const catalogs = new Map<string, { id: string; pack_qty: number }[]>();
  for (const c of companies) {
    catalogs.set(c.org_id, await must(rep.from('company_variants').select('id, pack_qty').eq('org_id', c.org_id).eq('active', true).eq('archived', false).order('barcode')));
  }

  let stores = 0;
  let orders = 0;
  let skipped = 0;
  for (const [name, cityName, appetite] of STORES) {
    const city = cities.find((c) => c.name === cityName);
    if (!city) {
      console.log(`Города «${cityName}» нет в справочнике — магазин «${name}» пропущен`);
      continue;
    }
    const org = (await must(db.rpc('create_org', {
      p_name: name, p_store: name, p_city: city.id,
      p_profile: { phone: `+7 700 100 ${String(10 + stores).padStart(2, '0')} 00`, email: CLIENTS_EMAIL, contact_name: 'Демо-магазины' },
    }))) as string;
    const store = (await must(db.from('stores').select('id').eq('org_id', org).single())).id as string;
    stores++;

    for (const c of companies) {
      const items = catalogs.get(c.org_id) ?? [];
      if (items.length === 0 || rnd() >= appetite) continue;
      // у каждого магазина свой набор товаров: в одних городах товар берут, в других — нет
      const taste = items.filter(() => rnd() < 0.45);
      for (let n = int(1, 3); n > 0 && taste.length > 0; n--) {
        const picks = taste.filter(() => rnd() < 0.6).slice(0, 6);
        if (picks.length === 0) continue;
        const placed = await db.rpc('place_order', {
          p_store: store, p_supplier: c.org_id, p_comment: '',
          p_items: picks.map((v) => ({ variant_id: v.id, qty: Number(v.pack_qty) * int(1, 3) })),
        });
        // не хватило остатка в филиале или не набран минимальный заказ — для демо просто пропускаем
        if (placed.error) {
          skipped++;
          continue;
        }
        const id = placed.data as string;
        const daysAgo = int(1, 80);
        const at = new Date(Date.now() - daysAgo * 86400_000).toISOString();
        const shipped = daysAgo > 3
          && !(await rep.rpc('set_order_status', { p_order: id, p_status: 'confirmed' })).error
          && !(await rep.rpc('set_order_status', { p_order: id, p_status: 'shipped' })).error;
        await must(admin.from('orders').update({ created_at: at, ...(shipped ? { confirmed_at: at, shipped_at: at } : {}) }).eq('id', id));
        await must(admin.from('company_stock_moves').update({ created_at: at }).eq('order_id', id));
        orders++;
      }
    }
  }
  console.log(`Готово: магазинов ${stores}, заказов ${orders}${skipped ? `, не оформлено из-за остатков или минимальной суммы: ${skipped}` : ''}. Вход магазинов: ${CLIENTS_EMAIL}, пароль тот же`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
