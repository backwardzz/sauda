// Касса: смены, чеки, возвраты покупателей, кассы и их фискализация.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { FiscalReceipt, Register, RegisterFiscal, Sale, SaleItem, Shift } from '../lib/types';
import { db, q } from '../lib/supabase';
import { parseNum } from '../lib/format';

export interface CanceledItem {
  id: string;
  cashier_id: string | null;
  name: string;
  qty_from: number;
  qty_to: number;
  created_at: string;
  registers: { name: string } | null;
}

export const listRegisters = (orgId: string) =>
  q<Register[]>(db.from('registers').select('*').eq('org_id', orgId).order('created_at'));

export const listSaleReturns = (saleId: string) =>
  q<Pick<Sale, 'id' | 'number' | 'total' | 'created_at'>[]>(
    db.from('sales').select('id, number, total, created_at').eq('parent_id', saleId).order('created_at'),
  );

export const listSaleFiscalReceipts = (saleId: string) =>
  q<FiscalReceipt[]>(db.from('fiscal_receipts').select('*').eq('sale_id', saleId));

export const listOpenShifts = (orgId: string, storeId: string) =>
  q<Shift[]>(db.from('shifts').select('*').eq('org_id', orgId).eq('store_id', storeId).is('closed_at', null));

export const listRecentSales = (orgId: string, storeId: string) =>
  q<Sale[]>(db.from('sales').select('*').eq('org_id', orgId).eq('store_id', storeId).order('created_at', { ascending: false }).limit(8));

/** Страница списка чеков или возвратов. По номеру чек ищется за всё время, иначе — за период. */
export const listSalesPage = async <T>(
  orgId: string, storeId: string, kind: 'sale' | 'return',
  filter: { number: number } | { from: string; to: string }, page: number, pageSize: number,
) => {
  let query = db.from('sales')
    .select('*, registers(name), contractors(name), parent:sales!parent_id(number)', { count: 'exact' })
    .eq('org_id', orgId).eq('store_id', storeId).eq('kind', kind);
  query = 'number' in filter ? query.eq('number', filter.number) : query.gte('created_at', filter.from).lt('created_at', filter.to);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as T[], total: count ?? 0 };
};

export const listCanceledItems = (orgId: string, storeId: string, from: string, to: string) =>
  q<CanceledItem[]>(
    db.from('canceled_items').select('id, cashier_id, name, qty_from, qty_to, created_at, registers(name)')
      .eq('org_id', orgId).eq('store_id', storeId).gte('created_at', from).lt('created_at', to)
      .order('created_at', { ascending: false }).limit(1000) as never,
  );

export const listShiftSales = (shiftId: string) =>
  q<Sale[]>(db.from('sales').select('*').eq('shift_id', shiftId).order('created_at'));

export const listOpenShiftsOfOrg = (orgId: string) =>
  q<Pick<Shift, 'register_id' | 'opened_at' | 'number'>[]>(
    db.from('shifts').select('register_id, opened_at, number').eq('org_id', orgId).is('closed_at', null),
  );

export const listRegisterFiscal = (orgId: string) =>
  q<RegisterFiscal[]>(db.from('register_fiscal').select('register_id, enabled, cashbox, login').eq('org_id', orgId));

export const addRegister = (row: { name: string; org_id: string; store_id: string; active: boolean; receipt_header: string; receipt_footer: string; }) =>
  q(db.from('registers').insert(row));

export const updateRegister = (row: { name: string; org_id: string; store_id: string; active: boolean; receipt_header: string; receipt_footer: string; }, id: string) =>
  q(db.from('registers').update(row).eq('id', id));

export const setRegisterFiscal = (id: string, cashbox: string, login: string, password: string, enabled: boolean) =>
  q(db.rpc('set_register_fiscal', {
    p_register: id, p_cashbox: cashbox, p_login: login, p_password: password, p_enabled: enabled,
  }));

export const deleteRegister = (id: string) =>
  q(db.from('registers').delete().eq('id', id));

export const deleteRegisterFiscal = (id: string) =>
  q(db.rpc('delete_register_fiscal', { p_register: id }));

export const addFirstRegister = (orgId: string, storeId: string) =>
  q(db.from('registers').insert({ org_id: orgId, store_id: storeId, name: 'Касса 1' }));

export const listReturnedItems = (saleItems: SaleItem[]) =>
  q<{ parent_item_id: string; qty: number }[]>(
    db.from('sale_items').select('parent_item_id, qty').in('parent_item_id', saleItems.map((i) => i.id)),
  );

export const createReturn = (shiftId: string, saleId: string, items: { item_id: string; qty: number; }[], toCard: boolean, total: number) =>
  q<{ id: string; number: number; total: number }>(
    db.rpc('create_return', { p_shift: shiftId, p_sale: saleId, p_items: items, p_refund_card: toCard ? total : 0 }),
  );

export const openShift = (registerId: string, cash: string) =>
  q(db.rpc('open_shift', { p_register: registerId, p_opening_cash: parseNum(cash) }));

export const cashOp = (shiftId: string, kind: "in" | "out", amount: string, comment: string) =>
  q(db.rpc('cash_op', { p_shift: shiftId, p_kind: kind, p_amount: parseNum(amount), p_comment: comment.trim() }));

export const listShiftTotals = (shiftId: string) =>
  q<Pick<Sale, 'kind' | 'total' | 'paid_cash' | 'paid_card'>[]>(db.from('sales').select('kind, total, paid_cash, paid_card').eq('shift_id', shiftId));

export const listCashOps = (shiftId: string) =>
  q<{ kind: 'in' | 'out'; amount: number }[]>(db.from('cash_ops').select('kind, amount').eq('shift_id', shiftId));

export const closeShift = (shiftId: string, actual: string, expected: number) =>
  q(db.rpc('close_shift', { p_shift: shiftId, p_closing_cash: actual.trim() === '' ? expected : parseNum(actual) }));

export const getOpenShift = (registerId: string) =>
  q<Shift[]>(db.from('shifts').select('*').eq('register_id', registerId).is('closed_at', null).limit(1));

export const getRegisterFiscal = (registerId: string) =>
  q<{ enabled: boolean }[]>(db.from('register_fiscal').select('enabled').eq('register_id', registerId));

export const pendingFiscalQuery = (shiftId: string) =>
  db.from('fiscal_receipts').select('id', { count: 'exact', head: true })
  .eq('shift_id', shiftId).neq('status', 'done').neq('kind', 'z_report');

export const recordCancel = (registerId: string, productId: string, productName: string, from: number, to: number) =>
  db.rpc('log_cancel', { p_register: registerId, p_product: productId, p_name: productName, p_qty_from: from, p_qty_to: to });

export const createSale = (sale: { p_shift: string; p_items: { product_id: string; qty: number; price: number; discount: number; }[]; p_paid_card: number; p_customer: string | null; }, clientId: string) =>
  q<{ id: string; number: number; total: number }>(
    db.rpc('create_sale', { ...sale, p_client_id: clientId }),
  );

export interface SaleFull extends Sale {
  sale_items: SaleItem[];
  registers: { name: string; receipt_header: string; receipt_footer: string } | null;
  contractors: { name: string } | null;
  stores: { name: string; address: string } | null;
}

const SALE_SELECT = '*, sale_items(*), registers(name, receipt_header, receipt_footer), contractors(name), stores(name, address)';

export const getSale = (saleId: string) =>
  q<SaleFull>(db.from('sales').select(SALE_SELECT).eq('id', saleId).single() as never);

/** Чек продажи для возврата покупателя: по ссылке из списка или по номеру, набранному кассиром. */
export const findSaleForReturn = (orgId: string, by: { id: string } | { number: number }) => {
  const base = db.from('sales').select(SALE_SELECT).eq('org_id', orgId).eq('kind', 'sale');
  return q<SaleFull | null>(('id' in by ? base.eq('id', by.id) : base.eq('number', by.number)).maybeSingle() as never);
};
