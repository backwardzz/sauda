// Сквозная проверка фискализации на локальной базе: касса → функция fiscal → Webkassa (или её двойник).
// Перед запуском: npx tsx scripts/webkassa-mock.ts и npx supabase functions serve fiscal --env-file supabase/functions/.env
// Создаёт тестового пользователя @test.local (его уберёт следующий npm test).
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const url = env.VITE_SUPABASE_URL;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`Только локальная база, а в .env.local ${url}`);

let failed = 0;
function check(name: string, ok: boolean, details?: unknown) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, details ?? '');
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must(p: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const db = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await must(db.auth.signUp({ email: `fiscal-${randomBytes(4).toString('hex')}@test.local`, password: randomBytes(12).toString('hex') }));
  const city = (await must(db.from('cities').select('id').eq('name', 'Алматы').single())).id;
  const org = await must(db.rpc('create_org', { p_name: 'Фискальный магазин', p_city: city }));
  const register = (await must(db.from('registers').select('id')))[0].id;
  const product = await must(db.from('products').insert({ org_id: org, name: 'Хлеб', barcode: '4870000000028', sale_price: 200 }).select().single());
  await must(db.rpc('set_register_fiscal', { p_register: register, p_cashbox: 'SWK00000001', p_login: 'cashier', p_password: 'pass', p_enabled: true }));
  await must(db.from('orgs').update({ vat_rate: 16 }).eq('id', org));

  const shift = await must(db.rpc('open_shift', { p_register: register, p_opening_cash: 0 }));
  const sale = await must(db.rpc('create_sale', { p_shift: shift, p_items: [{ product_id: product.id, qty: 2 }], p_paid_card: 100 }));
  await must(db.rpc('cash_op', { p_shift: shift, p_kind: 'in', p_amount: 500 }));

  const flush = await db.functions.invoke('fiscal', { body: { action: 'flush', register_id: register } });
  check('функция отправила чек и внесение', flush.data?.sent === 2 && flush.data?.failed === 0, flush.error ?? flush.data);
  const receipt = (await must(db.from('fiscal_receipts').select('*').eq('sale_id', sale.id)))[0];
  check('у чека фискальный номер и ссылка', receipt?.status === 'done' && !!receipt.fiscal_number && !!receipt.ticket_url, receipt);

  const again = await db.functions.invoke('fiscal', { body: { action: 'flush', register_id: register } });
  check('повторная отправка ничего не дублирует', again.data?.sent === 0, again.data);

  const early = await db.rpc('close_shift', { p_shift: shift, p_closing_cash: 700 });
  check('без Z-отчёта смена не закрывается', !!early.error?.message.includes('Z-отчёт'), early.error);
  const z = await db.functions.invoke('fiscal', { body: { action: 'z_report', shift_id: shift } });
  check('Z-отчёт снят', !z.error && z.data?.z?.ReportNumber === 1, z.error ?? z.data);
  const z2 = await db.functions.invoke('fiscal', { body: { action: 'z_report', shift_id: shift } });
  check('повторный Z-отчёт не запрашивается у Webkassa второй раз', !z2.error && z2.data?.z?.ReportNumber === 1, z2.error ?? z2.data);
  await must(db.rpc('close_shift', { p_shift: shift, p_closing_cash: 700 }));
  check('смена закрыта', true);

  const other = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await must(other.auth.signUp({ email: `fiscal-${randomBytes(4).toString('hex')}@test.local`, password: randomBytes(12).toString('hex') }));
  const foreign = await other.functions.invoke('fiscal', { body: { action: 'flush', register_id: register } });
  check('чужой пользователь не отправляет чеки чужой кассы', !!foreign.error);

  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Проверка прервана:', e.message);
  process.exit(1);
});
