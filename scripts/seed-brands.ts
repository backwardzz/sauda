// Демо-поставщики с известными марками для наглядности витрины: товары и штрихкоды берутся из
// samples/catalog.xlsx, картинки — из открытых баз Open Food Facts / Open Beauty Facts / Open Products Facts
// (лицензия CC BY-SA, в каталоге хранится только ссылка). Берутся только фото на белом фоне: скрипт скачивает
// каждое фото и проверяет края кадра. Товары без такого фото в каталог не попадают. Работает только с локальной базой.
//   npm run seed:brands            — создать или обновить 10 демо-поставщиков (вход rep@sauda.test)
//   npm run seed:brands -- --dry   — показать, что попадёт в каталоги, без записи в базу
// Ответы баз кешируются в samples/image-cache.json: повторный запуск в сеть почти не ходит.
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import { parseImport, type ImportRow } from '../src/lib/importParse';

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
}

const DEMO = 'Демо-каталог для примера, заказы не исполняются.';
const BRANDS: Brand[] = [
  { name: 'Coca-Cola', match: /coca|fanta|sprite|bonaqua|fuse ?tea|schweppes|piko/i, category: 'Напитки', pack: 6, min_order: 30000, delivery_note: 'Доставка пн, ср, пт', phone: '+7 700 000 01 01', description: `Coca-Cola, Fanta, Sprite, Fuse Tea, Piko, BonAqua. ${DEMO}` },
  { name: 'PepsiCo', match: /pepsi|lay'?s|cheetos|mirinda|7 ?up|adrenaline|lipton ice|aqua minerale|doritos/i, category: 'Напитки и снеки', pack: 6, min_order: 30000, delivery_note: 'Доставка вт, чт', phone: '+7 700 000 01 02', description: `Pepsi, Lay's, Cheetos, Mirinda, Adrenaline. ${DEMO}` },
  { name: 'Mars', match: /snickers|\bmars\b|twix|bounty|milky ?way|orbit|m&m|skittles|whiskas|kitekat|pedigree/i, category: 'Сладости', pack: 12, min_order: 25000, delivery_note: 'Доставка раз в неделю', phone: '+7 700 000 01 03', description: `Snickers, Mars, Twix, Bounty, Orbit, Whiskas. ${DEMO}` },
  { name: 'Nestlé', match: /nescafe|nesquik|kit ?kat|maggi|nestogen|nestle|gerber/i, category: 'Кофе, сладости, детское питание', pack: 6, min_order: 25000, delivery_note: 'Доставка вт, пт', phone: '+7 700 000 01 04', description: `Nescafé, Nesquik, KitKat, Maggi, Gerber. ${DEMO}` },
  { name: 'Mondelēz', match: /alpen gold|milka|oreo|\btuc\b|dirol|юбилейное|барни|halls|picnic/i, category: 'Сладости', pack: 12, min_order: 20000, delivery_note: 'Доставка раз в неделю', phone: '+7 700 000 01 05', description: `Alpen Gold, Milka, Oreo, Dirol, «Юбилейное». ${DEMO}` },
  { name: 'Ferrero', match: /kinder|raffaello|nutella|tic ?tac|ferrero/i, category: 'Сладости', pack: 6, min_order: 20000, delivery_note: 'Доставка раз в неделю', phone: '+7 700 000 01 06', description: `Kinder, Raffaello, Nutella, Tic Tac. ${DEMO}` },
  { name: 'Jacobs', match: /jacobs|carte noire/i, category: 'Кофе', pack: 6, min_order: 15000, delivery_note: 'Доставка по заявке', phone: '+7 700 000 01 07', description: `Кофе Jacobs и Carte Noire. ${DEMO}` },
  { name: 'Unilever', match: /lipton|calve|knorr|rexona|\bdove\b|domestos|\bclear\b|\baxe\b|\bcif\b/i, category: 'Чай, соусы, уход', pack: 6, min_order: 20000, delivery_note: 'Доставка ср', phone: '+7 700 000 01 08', description: `Lipton, Calvé, Knorr, Rexona, Dove, Domestos. ${DEMO}` },
  { name: 'Рахат', match: /рахат|rakhat/i, category: 'Сладости', pack: 10, min_order: 15000, delivery_note: 'Доставка пн, чт', phone: '+7 700 000 01 09', description: `Шоколад и конфеты «Рахат». ${DEMO}` },
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
const price = (r: ImportRow) => Math.max(5, Math.round(((r.sale_price ?? 0) * 0.8) / 5) * 5);

async function main() {
  if (!existsSync(FILE)) throw new Error(`Файл не найден: ${FILE}`);
  const wb = XLSX.read(readFileSync(FILE), { type: 'buffer' });
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const all = parseImport(sheet).items.filter((i) => factoryCode(i.barcode) && (i.sale_price ?? 0) > 0 && !/\d\s*тг/i.test(i.name));

  const catalogs: { brand: Brand; rows: { name: string; barcode: string; unit: string; price: number; category: string; pack_qty: number; image_url: string }[] }[] = [];
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
  for (const { brand, rows } of catalogs) {
    let org = mine.find((m) => m.orgs.kind === 'supplier' && m.orgs.name === brand.name)?.orgs.id;
    if (rows.length < 4) {
      // мало товаров с хорошими фото — нового поставщика не заводим, уже созданного не трогаем
      console.log(`${brand.name}: пропущен — товаров с фото на белом фоне меньше 4`);
      continue;
    }
    if (!org) org = (await must(rep.rpc('create_org', { p_name: brand.name, p_kind: 'supplier' }))) as string;
    await must(rep.from('orgs').update({
      description: brand.description, phone: brand.phone, min_order: brand.min_order, delivery_note: brand.delivery_note,
    }).eq('id', org));
    // каталог пересобирается целиком: товары, которых больше нет в подборке, уходят в архив
    await must(rep.from('supplier_products').update({ archived: true }).eq('org_id', org).not('barcode', 'in', `(${rows.map((r) => r.barcode).join(',')})`));
    await must(rep.rpc('import_supplier_products', { p_org: org, p_rows: rows }));
  }

  // вход для разработки (dev / admin1) видит новых поставщиков как владелец
  if (admin) {
    const dev = (await must(admin.from('profiles').select('id').eq('email', 'dev@sauda.test')))[0]?.id;
    const orgs = (await must(rep.from('org_members').select('org_id'))) as { org_id: string }[];
    if (dev) await must(admin.from('org_members').upsert(orgs.map((o) => ({ org_id: o.org_id, user_id: dev, role: 'owner' })), { onConflict: 'org_id,user_id' }));
  }
  console.log(`Готово: демо-поставщиков ${catalogs.filter((c) => c.rows.length >= 4).length}. Вход торгового представителя: ${REP_EMAIL}, пароль — DEMO_PASSWORD.`);
}

main().catch((e) => {
  console.error('\nПрервано:', e.message);
  process.exit(1);
});
