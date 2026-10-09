// Серверная функция фискализации: отправляет чеки кассы в Webkassa.
//   { action: 'flush', register_id }  — все неотправленные чеки кассы по порядку
//   { action: 'z_report', shift_id }  — дослать чеки и снять Z-отчёт (после этого смену можно закрыть)
// Вызывает касса Sauda от имени кассира; учётные данные Webkassa читаются только здесь, через service_role.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { checkRequest, moneyRequest, unwrap, WEBKASSA_TEST_URL, type SaleForCheck, type WebkassaReply } from './webkassa.ts';

const BASE = Deno.env.get('WEBKASSA_URL') || WEBKASSA_TEST_URL;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Receipt {
  id: string;
  org_id: string;
  kind: 'sale' | 'return' | 'cash_in' | 'cash_out' | 'z_report';
  sale_id: string | null;
  cash_op_id: string | null;
  attempts: number;
}
interface Credentials {
  cashbox: string;
  login: string;
  password: string;
  enabled: boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function call<T>(method: string, body: unknown): Promise<{ data: T } | { error: string; code?: number }> {
  try {
    const res = await fetch(BASE + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { error: `Webkassa ответила ${res.status}` };
    return unwrap((await res.json()) as WebkassaReply<T>);
  } catch {
    return { error: 'Нет связи с Webkassa' };
  }
}

async function token(c: Credentials): Promise<string> {
  const r = await call<{ Token: string }>('Authorize', { Login: c.login, Password: c.password });
  if ('error' in r) throw new Error(`Вход в Webkassa: ${r.error}`);
  return r.data.Token;
}

async function saleForCheck(admin: SupabaseClient, saleId: string): Promise<SaleForCheck> {
  const { data, error } = await admin
    .from('sales')
    .select('id, kind, total, paid_cash, paid_card, sale_items(name, barcode, unit, qty, price, discount, total)')
    .eq('id', saleId)
    .single();
  if (error) throw error;
  return { ...data, items: data.sale_items } as unknown as SaleForCheck;
}

/** Отправка одного чека. Ошибка не прерывает очередь: чек помечается failed и уйдёт при следующей попытке. */
async function send(admin: SupabaseClient, tok: string, c: Credentials, vat: number | null, r: Receipt) {
  let reply;
  if (r.sale_id) {
    reply = await call<{ CheckNumber: string; TicketUrl?: string; OfflineMode?: boolean }>(
      'Check',
      checkRequest(tok, c.cashbox, await saleForCheck(admin, r.sale_id), vat),
    );
  } else {
    const { data: op, error } = await admin.from('cash_ops').select('id, kind, amount').eq('id', r.cash_op_id!).single();
    if (error) throw error;
    reply = await call<{ OfflineMode?: boolean }>('MoneyOperation', moneyRequest(tok, c.cashbox, op.kind, op.amount, op.id));
  }
  const done = 'data' in reply;
  const data = done ? (reply.data as { CheckNumber?: string; TicketUrl?: string; OfflineMode?: boolean }) : null;
  await admin
    .from('fiscal_receipts')
    .update({
      status: done ? 'done' : 'failed',
      attempts: r.attempts + 1,
      last_error: done ? null : reply.error,
      fiscal_number: data?.CheckNumber ?? null,
      ticket_url: data?.TicketUrl ?? null,
      offline: !!data?.OfflineMode,
      response: data,
      done_at: done ? new Date().toISOString() : null,
    })
    .eq('id', r.id);
  return done;
}

async function flush(admin: SupabaseClient, registerId: string, c: Credentials, vat: number | null) {
  const { data: queue, error } = await admin
    .from('fiscal_receipts')
    .select('id, org_id, kind, sale_id, cash_op_id, attempts')
    .eq('register_id', registerId)
    .neq('status', 'done')
    .neq('kind', 'z_report')
    .order('created_at');
  if (error) throw error;
  if (!queue.length) return { sent: 0, failed: 0 };
  const tok = await token(c);
  let sent = 0;
  for (const r of queue as Receipt[]) {
    // по порядку: если Webkassa недоступна, следующие чеки не обгоняют застрявший
    if (!(await send(admin, tok, c, vat, r))) return { sent, failed: queue.length - sent };
    sent++;
  }
  return { sent, failed: 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = (await req.json()) as { action: string; register_id?: string; shift_id?: string };

    // доступ проверяет база: кассир видит только кассы и смены своей организации
    let registerId = body.register_id;
    let shiftId: string | undefined;
    if (body.action === 'z_report') {
      const { data: shift } = await user.from('shifts').select('id, register_id, closed_at').eq('id', body.shift_id ?? '').maybeSingle();
      if (!shift) return json({ error: 'Нет доступа' }, 403);
      if (shift.closed_at) return json({ error: 'Смена уже закрыта' }, 400);
      registerId = shift.register_id;
      shiftId = shift.id;
    }
    const { data: reg } = await user.from('registers').select('id, org_id, orgs(vat_rate)').eq('id', registerId ?? '').maybeSingle();
    if (!reg) return json({ error: 'Нет доступа' }, 403);
    const vat = (reg.orgs as unknown as { vat_rate: number | null } | null)?.vat_rate ?? null;

    const { data: cred } = await admin.rpc('fiscal_credentials', { p_register: reg.id });
    const c = cred as Credentials | null;
    if (!c?.enabled) return json({ error: 'Фискализация на этой кассе не включена' }, 400);

    const result = await flush(admin, reg.id, c, vat);
    if (body.action !== 'z_report') return json(result);
    if (result.failed) return json({ ...result, error: 'Не все чеки отправлены в Webkassa' }, 502);

    // повторное закрытие после сбоя: отчёт уже снят, второй раз Webkassa его не даст
    const { data: zDone } = await admin.from('fiscal_receipts').select('id, response')
      .eq('shift_id', shiftId!).eq('kind', 'z_report').eq('status', 'done').maybeSingle();
    if (zDone) return json({ ...result, z: zDone.response });

    // смена без фискальных операций в Webkassa не открывалась: Z-отчёт снимать нечего
    const { count } = await admin.from('fiscal_receipts').select('id', { count: 'exact', head: true })
      .eq('shift_id', shiftId!).neq('kind', 'z_report');
    const z = count
      ? await call<{ ReportNumber: number }>('ZReport', { Token: await token(c), CashboxUniqueNumber: c.cashbox })
      : { data: { skipped: true } };
    const done = 'data' in z;
    await admin.from('fiscal_receipts').insert({
      org_id: reg.org_id,
      register_id: reg.id,
      shift_id: shiftId,
      kind: 'z_report',
      status: done ? 'done' : 'failed',
      attempts: 1,
      last_error: done ? null : z.error,
      response: done ? z.data : null,
      done_at: done ? new Date().toISOString() : null,
    });
    return done ? json({ ...result, z: z.data }) : json({ ...result, error: `Z-отчёт: ${z.error}` }, 502);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
