// Отчёты: продажи, смены, кассиры, скидки, прибыли и убытки.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { Sale } from '../lib/types';
import { db, q } from '../lib/supabase';

export interface SalesRow {
  key: string;
  label: string;
  barcode: string;
  unit: string;
  qty_sold: number;
  qty_returned: number;
  sales_sum: number;
  returns_sum: number;
  discount: number;
  revenue: number;
  cost: number;
  profit: number;
  receipts: number;
}

export interface ShiftRow {
  id: string;
  number: number;
  register_name: string;
  cashier_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  sales_cash: number;
  sales_card: number;
  returns_cash: number;
  returns_card: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  closing_cash: number | null;
  cost: number;
  profit: number;
  receipts: number;
}

export interface CashierRow {
  cashier_id: string | null;
  cashier_name: string;
  sales_sum: number;
  card_sum: number;
  cash_sum: number;
  returns_sum: number;
  total: number;
  receipts: number;
}

export interface Pnl {
  sales_cash: number;
  sales_card: number;
  returns_sum: number;
  discount: number;
  cost_sold: number;
  cost_returned: number;
  writeoffs: number;
  /** Излишки минус недостача по проведённым инвентаризациям. */
  inventory: number;
  receipts: number;
}

export const reportSales = (args: { p_org: string; p_from: string; p_to: string; p_store: string | null; }) =>
  q<SalesRow[]>(db.rpc('report_sales', { ...args, p_group: 'day' }));

export const reportSalesBy = (args: { p_org: string; p_from: string; p_to: string; p_store: string | null; }, group: "category" | "supplier" | "customer" | "product") =>
  q<SalesRow[]>(db.rpc('report_sales', { ...args, p_group: group }));

/** Чеки за период, свежие сверху. */
export const listSalesInRange = (orgId: string, from: string, to: string, storeId?: string | null) => {
  let query = db.from('sales').select('*').eq('org_id', orgId).gte('created_at', from).lt('created_at', to);
  if (storeId) query = query.eq('store_id', storeId);
  return q<Sale[]>(query.order('created_at', { ascending: false }).limit(2000));
};

export const reportShifts = (args: { p_org: string; p_from: string; p_to: string; p_store: string | null; }) =>
  q<ShiftRow[]>(db.rpc('report_shifts', args));

export const reportCashiers = (args: { p_org: string; p_from: string; p_to: string; p_store: string | null; }) =>
  q<CashierRow[]>(db.rpc('report_cashiers', args));

/** Позиции чеков, проданные со скидкой, за период. */
export const listDiscountedItems = <T>(orgId: string, from: string, to: string, storeId?: string | null) => {
  let query = db.from('sale_items')
    .select('id, name, barcode, unit, qty, price, discount, total, sales!inner(created_at, number, kind, store_id)')
    .eq('org_id', orgId).gt('discount', 0).eq('sales.kind', 'sale')
    .gte('sales.created_at', from).lt('sales.created_at', to);
  if (storeId) query = query.eq('sales.store_id', storeId);
  return q<T[]>(query.limit(2000) as never);
};

export const reportPnl = (args: { p_org: string; p_from: string; p_to: string; p_store: string | null; }) =>
  q<Pnl[]>(db.rpc('report_pnl', args));

export const reportSalesByProduct = (args: { p_org: string; p_from: string; p_to: string; p_store: string | null; }) =>
  q<SalesRow[]>(db.rpc('report_sales', { ...args, p_group: 'product' }));
