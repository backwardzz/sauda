// Демо-компании с известными марками для наглядности витрины: товары и штрихкоды берутся из
// samples/catalog.xlsx, картинки — из открытых баз Open Food Facts / Open Beauty Facts / Open Products Facts
// (лицензия CC BY-SA, в каталоге хранится только ссылка). Берутся только фото на белом фоне: скрипт скачивает
// каждое фото и проверяет края кадра. Товары без такого фото в каталог не попадают. Работает только с локальной базой.
// Размер в названии становится видом товара: «Coca cola 0.5л» и «Coca cola 1л» — один товар с двумя видами.
// Кроме марок создаётся оптовая база с ценами на все товары пакетов «У меня новый магазин».
//   npm run seed:brands            — создать или обновить демо-компании (вход rep@sauda.test)
//   npm run seed:brands -- --dry   — показать, что попадёт в каталоги, без записи в базу
// Ответы баз кешируются в samples/image-cache.json: повторный запуск в сеть почти не ходит.
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import { parseImport, type ImportRow } from '../src/lib/importParse';
import { splitName } from '../src/lib/variants';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = env.VITE_SUPABASE_URL;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`Демо-поставщики создаются только в локальной базе, а в .env.local указано ${url}`);
}
const dry = process.argv.includes('--dry');
const REP_EMAIL = 'rep@sauda.test';
const FILE = 'samples/catalog.xlsx';
const CACHE = 'samples/image-cache.json';
const MAX_ITEMS = 36;
/** Сколько товаров марки проверяем на картинку. */
const MAX_LOOKUPS = 160;

interface Brand {
  name: string;
  description: string;
  match: RegExp;
  category: string;
  pack: number;
  min_order: number;
  delivery_note: string;
  phone: string;
  /** филиалы кроме главного офиса в Алматы */
  cities?: string[];
}

const DEMO = 'Демо-каталог для примера, заказы не исполняются.';
const BRANDS: Brand[] = [
  { name: 'Coca-Cola', match: /coca|fanta|sprite|bonaqua|fuse ?tea|schweppes|piko/i, category: 'Напитки', pack: 6, min_order: 30000, delivery_note: 'Доставка пн, ср, пт', phone: '+7 700 000 01 01', cities: ['Астана', 'Шымкент', 'Караганда'], description: `Coca-Cola, Fanta, Sprite, Fuse Tea, Piko, BonAqua. ${DEMO}` },
  { name: 'PepsiCo', match: /pepsi|lay'?s|cheetos|mirinda|7 ?up|adrenaline|lipton ice|aqua minerale|doritos/i, category: 'Напитки и снеки', pack: 6, min_order: 30000, delivery_note: 'Доставка вт, чт', phone: '+7 700 000 01 02', cities: ['Астана', 'Актобе'], description: `Pepsi, Lay's, Cheetos, Mirinda, Adrenaline. ${DEMO}` },
  { name: 'Mars', match: /snickers|\bmars\b|twix|bounty|milky ?way|orbit|m&m|skittles|whiskas|kitekat|pedigree/i, category: 'Сладости', pack: 12, min_order: 25000, delivery_note: 'Доставка раз в неделю', phone: '+7 700 000 01 03', description: `Snickers, Mars, Twix, Bounty, Orbit, Whiskas. ${DEMO}` },
  { name: 'Nestlé', match: /nescafe|nesquik|kit ?kat|maggi|nestogen|nestle|gerber/i, category: 'Кофе, сладости, детское питание', pack: 6, min_order: 25000, delivery_note: 'Доставка вт, пт', phone: '+7 700 000 01 04', description: `Nescafé, Nesquik, KitKat, Maggi, Gerber. ${DEMO}` },
  { name: 'Mondelēz', match: /alpen gold|milka|oreo|\btuc\b|dirol|юбилейное|барни|halls|picnic/i, category: 'Сладости', pack: 12, min_order: 20000, delivery_note: 'Доставка раз в неделю', phone: '+7 700 000 01 05', description: `Alpen Gold, Milka, Oreo, Dirol, «Юбилейное». ${DEMO}` },
  { name: 'Ferrero', match: /kinder|raffaello|nutella|tic ?tac|ferrero/i, category: 'Сладости', pack: 6, min_order: 20000, delivery_note: 'Доставка раз в неделю', phone: '+7 700 000 01 06', description: `Kinder, Raffaello, Nutella, Tic Tac. ${DEMO}` },
  { name: 'Jacobs', match: /jacobs|carte noire/i, category: 'Кофе', pack: 6, min_order: 15000, delivery_note: 'Доставка по заявке', phone: '+7 700 000 01 07', description: `Кофе Jacobs и Carte Noire. ${DEMO}` },
  { name: 'Unilever', match: /lipton|calve|knorr|rexona|\bdove\b|domestos|\bclear\b|\baxe\b|\bcif\b/i, category: 'Чай, соусы, уход', pack: 6, min_order: 20000, delivery_note: 'Доставка ср', phone: '+7 700 000 01 08', description: `Lipton, Calvé, Knorr, Rexona, Dove, Domestos. ${DEMO}` },
  { name: 'Рахат', match: /рахат|rakhat/i, category: 'Сладости', pack: 10, min_order: 15000, delivery_note: 'Доставка пн, чт', phone: '+7 700 000 01 09', cities: ['Астана'], description: `Шоколад и конфеты «Рахат». ${DEMO}` },
  { name: 'Tassay', match: /tassay/i, category: 'Вода и напитки', pack: 6, min_order: 10000, delivery_note: 'Доставка ежедневно', phone: '+7 700 000 01 10', description: `Вода и напитки Tassay. ${DEMO}` },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(p: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

interface Cache {
  /** штрихкод → ссылки на фото лицевой стороны (по языкам упаковки) */
  fronts: Record<string, string[]>;
  /** ссылка на фото → доля белого по краям кадра (0…1) */
  white: Record<string, number>;
}
const loaded = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const cache: Cache = loaded.fronts ? loaded : { fronts: {}, white: {} };
const SOURCES = ['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openproductsfacts.org'];
const UA = { 'User-Agent': 'SaudaDemoSeed/0.1 (local development)' };
/** Фото считается снятым на белом фоне, если по краям кадра столько белого. */
const WHITE_MIN = 0.85;
let requests = 0;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Все выбранные в базе фото лицевой стороны товара. */
async function fronts(barcode: string): Promise<string[]> {
  if (barcode in cache.fronts) return cache.fronts[barcode];
  let list: string[] = [];
  for (const host of SOURCES) {
    // базы просят не больше 100 запросов в минуту
    await pause(700);
    requests++;
    try {
      const res = await fetch(`https://${host}/api/v2/product/${barcode}.json?fields=selected_images`, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const json = (await res.json()) as { product?: { selected_images?: { front?: { display?: Record<string, string> } } } };
      const display = json.product?.selected_images?.front?.display;
      if (display) {
        list = [...new Set(Object.values(display))].filter((u) => u.startsWith('https://')).slice(0, 8);
        break;
      }
    } catch {
      return []; // сеть недоступна: ответ не кешируем
    }
  }
  cache.fronts[barcode] = list;
  return list;
}

/** Доля почти белых пикселей в рамке шириной 8% по краям кадра: у студийного фото на белом фоне близка к 1. */
async function whiteness(src: string): Promise<number> {
  if (src in cache.white) return cache.white[src];
  let score = 0;
  try {
    await pause(150);
    const res = await fetch(src, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const size = 50;
      const px = await sharp(Buffer.from(await res.arrayBuffer())).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer();
      const edge = 4;
      let white = 0;
      let total = 0;
      let inner = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 3;
          const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
          const isWhite = Math.min(r, g, b) > 232 && Math.max(r, g, b) - Math.min(r, g, b) < 18;
          if (x < edge || y < edge || x >= size - edge || y >= size - edge) {
            total++;
            if (isWhite) white++;
          } else if (!isWhite) inner++;
        }
      }
      // пустой белый кадр без товара не подходит
      score = inner > (size - 2 * edge) ** 2 * 0.15 ? white / total : 0;
    }
  } catch {
    return 0;
  }
  cache.white[src] = score;
  return score;
}

/** Лучшее фото товара на белом фоне; пустая строка — такого фото нет. */
async function image(barcode: string): Promise<string> {
  let best = '';
  let bestScore = 0;
  for (const src of await fronts(barcode)) {
    const score = await whiteness(src);
    if (score > bestScore) [best, bestScore] = [src, score];
    if (score >= 0.97) break;
  }
  return bestScore >= WHITE_MIN ? best : '';
}

const factoryCode = (code: string) => /^(\d{8}|\d{12,13})$/.test(code) && !code.startsWith('2');
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Цена для магазинов — условная: розничная цена минус наценка, округлённая до 5. */
const price = (r: ImportRow, share = 0.8) => Math.max(5, Math.round(((r.sale_price ?? 0) * share) / 5) * 5);
/** Фото из кеша прошлых запусков: без обращений в сеть. */
const cachedImage = (barcode: string) =>
  (cache.fronts[barcode] ?? []).map((src) => [src, cache.white[src] ?? 0] as const).sort((a, b) => b[1] - a[1]).find(([, score]) => score >= WHITE_MIN)?.[0] ?? '';

// детерминированный генератор: остатки одинаковы при каждом запуске
let state = 20261011;
const int = (a: number, b: number) => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return a + Math.floor((state / 4294967296) * (b - a + 1));
};

type Row = { name: string; barcode: string; unit: string; price: number; category: string; pack_qty: number; image_url: string };
/** Оптовая база: цены на все товары пакетов «У меня новый магазин», чтобы новый магазин мог сразу заказать. */
const WHOLESALE = {
  name: 'ТОО «Оптовая база Алатау»',
  description: `Продукты, напитки, бытовая химия и товары первой необходимости одной поставкой. ${DEMO}`,
  phone: '+7 700 000 02 00', address: 'ул. Северное кольцо, 12', min_order: 20000,
  delivery_note: 'Доставка ежедневно, заказ до 18:00 накануне', payment_terms: 'Наличными или переводом при получении',
  cities: ['Астана', 'Шымкент', 'Караганда', 'Актобе'],
};

async function main() {
  if (!existsSync(FILE)) throw new Error(`Файл не найден: ${FILE}`);
  const wb = XLSX.read(readFileSync(FILE), { type: 'buffer' });
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  // цена 10 000 000 в выгрузке — заглушка «цена не задана»: такие товары в демо-каталоги не идут
  const all = parseImport(sheet).items.filter((i) => factoryCode(i.barcode) && (i.sale_price ?? 0) > 0 && (i.sale_price ?? 0) < 1_000_000 && !/\d\s*тг/i.test(i.name));

  const catalogs: { brand: Brand; rows: Row[] }[] = [];
  const taken = new Set<string>();
  for (const brand of BRANDS) {
    const candidates = all.filter((i) => brand.match.test(i.name) && !taken.has(i.barcode)).slice(0, MAX_LOOKUPS);
    const rows = [];
    for (const [n, i] of candidates.entries()) {
      process.stdout.write(`\r${brand.name}: ${n + 1} из ${candidates.length}   `);
      rows.push({
        name: cap(i.name.replace(/\s+/g, ' ').trim()), barcode: i.barcode, unit: i.unit ?? 'шт', price: price(i),
        category: cap(i.subcategory ?? i.category ?? brand.category), pack_qty: brand.pack, image_url: await image(i.barcode),
      });
    }
    writeFileSync(CACHE, JSON.stringify(cache));
    // в каталог попадают только товары с фото на белом фоне: витрина выглядит единообразно
    const picked = rows.filter((r) => r.image_url).slice(0, MAX_ITEMS);
    picked.forEach((r) => taken.add(r.barcode));
    catalogs.push({ brand, rows: picked });
    console.log(`\r${brand.name}: товаров с фото на белом фоне ${picked.length} (проверено ${candidates.length})`);
  }
  console.log(`Запросов к базам картинок: ${requests}`);
  if (dry) return;

  const rep = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  if ((await rep.auth.signInWithPassword({ email: REP_EMAIL, password: env.DEMO_PASSWORD })).error) {
    const up = await rep.auth.signUp({ email: REP_EMAIL, password: env.DEMO_PASSWORD, options: { data: { full_name: 'Данияр Торговый' } } });
    if (up.error) throw up.error;
  }
  const mine = (await must(rep.from('org_members').select('orgs(id, name, kind)'))) as { orgs: { id: string; name: string; kind: string } }[];
  const admin = env.SUPABASE_SERVICE_ROLE_KEY ? createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
  const cities = (await must(rep.from('cities').select('id, name'))) as { id: number; name: string }[];
  const city = (name: string) => cities.find((c) => c.name === name)!.id;

  /** Компания с профилем, филиалами и каталогом: создаётся или обновляется по названию. */
  const publish = async (
    c: { name: string; description: string; phone: string; address?: string; min_order: number; delivery_note: string; payment_terms?: string; cities?: string[] },
    type: 'manufacturer' | 'wholesaler', rows: Row[],
  ) => {
    let org = mine.find((m) => m.orgs.kind === 'company' && m.orgs.name === c.name)?.orgs.id;
    if (!org) {
      org = (await must(rep.rpc('create_org', {
        p_name: c.name, p_kind: 'company', p_city: city('Алматы'),
        p_profile: { phone: c.phone, address: c.address ?? '', company_type: type, description: c.description, email: REP_EMAIL, contact_name: 'Данияр Торговый' },
      }))) as string;
    }
    await must(rep.from('companies').update({
      company_type: type, description: c.description, min_order: c.min_order, delivery_note: c.delivery_note, payment_terms: c.payment_terms ?? 'Оплата при получении',
    }).eq('org_id', org));

    let branches = (await must(rep.from('company_branches').select('id, city_id, is_main').eq('org_id', org))) as { id: string; city_id: number; is_main: boolean }[];
    for (const name of c.cities ?? []) {
      if (branches.some((b) => b.city_id === city(name))) continue;
      await must(rep.from('company_branches').insert({ org_id: org, city_id: city(name), name: `Филиал в городе ${name}`, phone: c.phone, work_hours: 'пн–сб, 9:00–18:00' }));
    }
    branches = (await must(rep.from('company_branches').select('id, city_id, is_main').eq('org_id', org))) as typeof branches;

    // каталог пересобирается целиком: виды, которых больше нет в подборке, уходят в архив вместе с опустевшими товарами
    const keep = new Set(rows.map((r) => r.barcode));
    const live = (await must(rep.from('company_variants').select('id, barcode').eq('org_id', org).eq('archived', false).limit(20000))) as { id: string; barcode: string }[];
    const gone = live.filter((v) => !keep.has(v.barcode)).map((v) => v.id);
    for (let i = 0; i < gone.length; i += 100) await must(rep.from('company_variants').update({ archived: true }).in('id', gone.slice(i, i + 100)));
    for (let i = 0; i < rows.length; i += 200) {
      await must(rep.rpc('import_company_products', {
        p_org: org,
        p_rows: rows.slice(i, i + 200).map((r) => ({
          ...splitName(r.name), barcode: r.barcode, unit: r.unit, price: r.price, category: r.category, pack_qty: r.pack_qty, image_url: r.image_url,
          stock: r.pack_qty * int(15, 80),
        })),
      }));
    }
    // в остальных филиалах — часть ассортимента с запасом поменьше
    const variants = (await must(rep.from('company_variants').select('id, pack_qty').eq('org_id', org).eq('archived', false).order('barcode'))) as { id: string; pack_qty: number }[];
    for (const b of branches.filter((x) => !x.is_main)) {
      for (const v of variants.filter((_, k) => k % 4 !== 3)) {
        await must(rep.rpc('set_company_stock', { p_variant: v.id, p_branch: b.id, p_qty: Number(v.pack_qty) * int(3, 20) }));
      }
    }
    return variants.length;
  };

  for (const { brand, rows } of catalogs) {
    if (rows.length < 4) {
      // мало товаров с хорошими фото — новую компанию не заводим, уже созданную не трогаем
      console.log(`${brand.name}: пропущен — товаров с фото на белом фоне меньше 4`);
      continue;
    }
    await publish(brand, 'manufacturer', rows);
  }

  // оптовая база: всё, что входит в пакеты «У меня новый магазин», по цене чуть выше, чем у производителя
  const starter = (await must(rep.from('catalog_products').select('name, barcode, unit, category, subcategory').neq('starter_pack', '').limit(5000))) as
    { name: string; barcode: string; unit: string; category: string; subcategory: string }[];
  const byCode = new Map(all.map((i) => [i.barcode, i]));
  const wholesale: Row[] = starter.flatMap((c) => {
    const src = byCode.get(c.barcode);
    return src ? [{ name: c.name, barcode: c.barcode, unit: c.unit, price: price(src, 0.85), category: cap(c.subcategory || c.category), pack_qty: c.unit === 'шт' ? 6 : 1, image_url: cachedImage(c.barcode) }] : [];
  });
  const wholesaleCount = wholesale.length ? await publish(WHOLESALE, 'wholesaler', wholesale) : 0;

  // вход для разработки (dev / admin1) видит новые компании как владелец
  if (admin) {
    const dev = (await must(admin.from('profiles').select('id').eq('email', 'dev@sauda.test')))[0]?.id;
    // запрос возвращает строки всех участников компаний: без повторов, иначе upsert заденет одну строку дважды
    const orgs = [...new Set(((await must(rep.from('org_members').select('org_id'))) as { org_id: string }[]).map((o) => o.org_id))];
    if (dev) await must(admin.from('org_members').upsert(orgs.map((org_id) => ({ org_id, user_id: dev, role: 'owner' })), { onConflict: 'org_id,user_id' }));
  }
  console.log(`Готово: компаний с марками ${catalogs.filter((c) => c.rows.length >= 4).length}, оптовая база — ${wholesaleCount} видов товаров. Вход компании: ${REP_EMAIL}, пароль — DEMO_PASSWORD.`);
}

main().catch((e) => {
  console.error('\nПрервано:', e.message);
  process.exit(1);
});
