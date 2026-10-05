// Наполнение общего справочника товаров (таблица catalog_products) из Excel-выгрузки.
// В справочник попадают только название, штрихкод, единица и категория — без цен, поставщиков и остатков.
// Берутся товары с заводским штрихкодом: внутренние коды магазина (начинаются с 2) и весовые товары пропускаются.
//   npm run catalog                — samples/catalog.xlsx в локальную базу
//   npm run catalog -- --dry       — только показать, что попадёт в справочник и в пакеты
//   npm run catalog -- "C:\путь\к файлу.xlsx"
// Другая база (облако): переменные окружения CATALOG_URL и CATALOG_SERVICE_KEY (service_role-ключ проекта).
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { parseImport } from '../src/lib/importParse';
import { STARTER_PACKS } from '../src/lib/starter';
import { PACK_RULES } from './catalog-packs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = process.env.CATALOG_URL ?? env.VITE_SUPABASE_URL;
const key = process.env.CATALOG_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.CATALOG_URL && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`В .env.local указана не локальная база (${url}). Для облака задайте CATALOG_URL и CATALOG_SERVICE_KEY.`);
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'samples/catalog.xlsx');
const CHUNK = 500;

interface Row {
  name: string;
  barcode: string;
  unit: string;
  category: string;
  subcategory: string;
  starter_pack: string;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** EAN-8, UPC-12 или EAN-13, выданный производителем: коды на 2 магазины печатают сами. */
const factoryCode = (code: string) => /^(\d{8}|\d{12,13})$/.test(code) && !code.startsWith('2');
/** Цена в названии («Шпажки 25см 250тг») — пометка магазина, в общий справочник такое не годится. */
const hasPrice = (name: string) => /\d\s*(тг|тенге|₸)/i.test(name);

function build(): Row[] {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
  const sheet = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const { items } = parseImport(sheet);
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const i of items) {
    const name = i.name.replace(/\s+/g, ' ').trim();
    if (!factoryCode(i.barcode) || seen.has(i.barcode) || hasPrice(name) || name.length < 4) continue;
    seen.add(i.barcode);
    rows.push({
      name: cap(name),
      barcode: i.barcode,
      unit: i.unit ?? 'шт',
      category: cap((i.category ?? '').trim()),
      subcategory: cap((i.subcategory ?? '').trim()),
      starter_pack: '',
    });
  }

  for (const [pack, rules] of Object.entries(PACK_RULES)) {
    for (const rule of rules) {
      const found = rows
        .filter((r) => !r.starter_pack && rule.sub.test((r.subcategory || r.category).toLowerCase()) && rule.name.test(r.name))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      // берём равномерно по алфавиту, а не первые max: иначе весь лимит заняла бы одна марка
      const step = Math.max(1, found.length / rule.max);
      for (let i = 0; i < found.length && Math.round(i) < found.length; i += step) found[Math.round(i)].starter_pack = pack;
    }
  }
  return rows;
}

async function main() {
  if (!existsSync(file)) throw new Error(`Файл не найден: ${file}`);
  const rows = build();
  console.log(`Файл: ${file}\nВ справочник: ${rows.length} товаров, из них в пакетах: ${rows.filter((r) => r.starter_pack).length}`);
  for (const p of STARTER_PACKS) {
    const list = rows.filter((r) => r.starter_pack === p.key);
    console.log(`  ${p.title}: ${list.length}`);
    if (dry) console.log(`    ${list.map((r) => r.name).join('; ')}`);
  }
  if (dry) return;

  if (!key) throw new Error('Нужен служебный ключ: SUPABASE_SERVICE_ROLE_KEY в .env.local или CATALOG_SERVICE_KEY');
  const db = createClient(url, key, { auth: { persistSession: false } });
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from('catalog_products').upsert(rows.slice(i, i + CHUNK), { onConflict: 'barcode' });
    if (error) throw new Error(`Строки ${i + 1}–${i + CHUNK}: ${error.message}`);
    process.stdout.write(`\r${Math.min(i + CHUNK, rows.length)} из ${rows.length}`);
  }
  const { count } = await db.from('catalog_products').select('id', { count: 'exact', head: true });
  console.log(`\nГотово. В справочнике ${count} товаров (${url}).`);
}

main().catch((e) => {
  console.error('\nЗагрузка прервана:', e.message);
  process.exit(1);
});
