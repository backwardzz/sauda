// Загрузка товарной базы из Excel в компанию демо-аккаунта на локальной базе.
// Повторный запуск с обновлённым файлом добавляет новые товары и обновляет существующие (поиск по штрихкоду).
//   npm run import                                   — samples/catalog.xlsx в компанию «Шалкар»
//   npm run import -- "C:\путь\к файлу.xlsx" --org "Название компании"
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { parseImport } from '../src/lib/importParse';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = env.VITE_SUPABASE_URL;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`Скрипт работает только с локальной базой, а в .env.local указано ${url}. В облако товары загружаются через «Импорт из Excel» на сайте.`);
}

const args = process.argv.slice(2);
const orgFlag = args.indexOf('--org');
const orgName = orgFlag >= 0 ? args[orgFlag + 1] : 'Шалкар';
const file = resolve(args.find((a, i) => !a.startsWith('--') && i !== orgFlag + 1) ?? 'samples/catalog.xlsx');
const CHUNK = 500;

async function main() {
  if (!existsSync(file)) throw new Error(`Файл не найден: ${file}`);
  const db = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD });
  if (signIn.error) throw new Error('Демо-аккаунт не найден: сначала выполните npm run seed');

  const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const { items, found } = parseImport(rows);
  console.log(`Файл: ${file}\nТоваров: ${items.length}. Столбцы: ${found.join(', ')}`);

  const memberships = await db.from('org_members').select('orgs(id, name)');
  if (memberships.error) throw new Error(memberships.error.message);
  const orgs = (memberships.data as unknown as { orgs: { id: string; name: string } }[]).map((m) => m.orgs);
  let org = orgs.find((o) => o.name === orgName)?.id;
  if (!org) {
    const created = await db.rpc('create_org', { p_name: orgName, p_store: orgName });
    if (created.error) throw new Error(created.error.message);
    org = created.data as string;
    console.log(`Создана компания «${orgName}»`);
  }

  const total = { created: 0, updated: 0, skipped: 0 };
  for (let i = 0; i < items.length; i += CHUNK) {
    const { data, error } = await db.rpc('import_products', { p_org: org, p_store: null, p_rows: items.slice(i, i + CHUNK) });
    if (error) throw new Error(`Строки ${i + 1}–${i + CHUNK}: ${error.message}`);
    total.created += data.created;
    total.updated += data.updated;
    total.skipped += data.skipped;
    process.stdout.write(`\r${Math.min(i + CHUNK, items.length)} из ${items.length}`);
  }
  const count = async (table: string, extra?: [string, string]) => {
    let query = db.from(table).select('id', { count: 'exact', head: true }).eq('org_id', org);
    if (extra) query = query.eq(extra[0], extra[1]);
    return (await query).count ?? 0;
  };
  console.log(
    `\nКомпания «${orgName}»: новых ${total.created}, обновлено ${total.updated}, пропущено ${total.skipped}. ` +
      `Всего товаров ${await count('products', ['archived', 'false'])}, категорий ${await count('categories')}, поставщиков ${await count('contractors', ['kind', 'supplier'])}.`,
  );
}

main().catch((e) => {
  console.error('\nИмпорт прерван:', e.message);
  process.exit(1);
});
