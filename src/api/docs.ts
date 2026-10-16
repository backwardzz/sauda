// Складские документы: приёмка, списание, перемещение, инвентаризация, платежи поставщикам.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { DocKind, StockDoc } from '../lib/types';
import { db, q } from '../lib/supabase';
import { round2, round3 } from '../lib/format';

export interface Payment {
  id: string;
  amount: number;
  comment: string;
  created_at: string;
  created_by: string | null;
}

export const listRecentSupplies = (orgId: string, storeId: string) =>
  q<(StockDoc & { contractors: { name: string } | null })[]>(
    db.from('stock_docs').select('*, contractors(name)').eq('org_id', orgId).eq('store_id', storeId).eq('kind', 'supply')
      .eq('status', 'posted').order('created_at', { ascending: false }).limit(4) as never,
  );

export const stockDocLines = (docId: string, from: number) =>
  db.rpc('stock_doc_lines', { p_doc: docId }).range(from, from + 999);

/** Документы одного вида: черновики — все, проведённые — за период. Перемещение видно и отправителю, и получателю. */
export const listStockDocs = async (orgId: string, storeId: string, kind: DocKind, from: string, to: string) => {
  const scoped = () => {
    const base = db.from('stock_docs').select('*').eq('org_id', orgId).eq('kind', kind);
    return kind === 'transfer' ? base.or(`store_id.eq.${storeId},to_store_id.eq.${storeId}`) : base.eq('store_id', storeId);
  };
  const [drafts, posted] = await Promise.all([
    q<StockDoc[]>(scoped().eq('status', 'draft').order('created_at', { ascending: false }).limit(200)),
    q<StockDoc[]>(scoped().eq('status', 'posted').gte('created_at', from).lt('created_at', to)
      .order('created_at', { ascending: false }).limit(500)),
  ]);
  return [...drafts, ...posted];
};

export const createStockDoc = (storeId: string, kind: DocKind) =>
  q<string>(db.rpc('create_stock_doc', { p_store: storeId, p_kind: kind }));

export const getStockDoc = (id: string, orgId: string) =>
  q<StockDoc | null>(db.from('stock_docs').select('*').eq('id', id).eq('org_id', orgId).maybeSingle());

export const listDocPayments = (docId: string) =>
  q<Payment[]>(db.from('doc_payments').select('*').eq('doc_id', docId).order('created_at'));

export const setStockDocItem = (docId: string, productId: string, qty: number | null, price: number | undefined, salePrice: number | null | undefined) =>
  q(db.rpc('set_stock_doc_item', { p_doc: docId, p_product: productId, p_qty: qty, p_price: price ?? null, p_sale_price: salePrice ?? null }));

export const getStockQty = (storeId: string, productId: string) =>
  q<{ qty: number } | null>(
    db.from('stock').select('qty').eq('store_id', storeId).eq('product_id', productId).maybeSingle(),
  );

export const postStockDoc = (docId: string, kind: DocKind, zeroMissing: boolean) =>
  q(db.rpc('post_stock_doc_draft', { p_doc: docId, p_zero_missing: kind === 'inventory' && zeroMissing }));

export const deleteStockDoc = (docId: string) =>
  q(db.rpc('delete_stock_doc', { p_doc: docId }));

export const paySupply = (docId: string, amount: number, comment: string) =>
  q(db.rpc('pay_supply', { p_doc: docId, p_amount: amount, p_comment: comment.trim() }));

export const createSupplyDoc = (storeId: string, comment: string, supplierId: string) =>
  q<string>(db.rpc('create_stock_doc', { p_store: storeId, p_kind: 'supply', p_comment: comment, p_supplier: supplierId }));

export const addSupplyLine = (docId: string, productId: string, qty: number, price: number) =>
  q(db.rpc('set_stock_doc_item', { p_doc: docId, p_product: productId, p_qty: round3(qty), p_price: round2(price / qty) }));

export const updateStockDoc = (docId: string, comment: string, supplierId: string | null, toStoreId: string | null) =>
  q(db.rpc('update_stock_doc', { p_doc: docId, p_comment: comment, p_supplier: supplierId, p_to_store: toStoreId }));
