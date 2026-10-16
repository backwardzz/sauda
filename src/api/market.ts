// Закупки: витрина поставщиков, предложения, заказы.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { CompanyCard, Offer, Order, OrderItem, PriceAccess } from '../lib/types';
import { db, q } from '../lib/supabase';

export const listOffersByCompany = (storeId: string, companyId: string | undefined) =>
  q<Offer[]>(db.rpc('store_offers', { p_store: storeId, p_company: companyId }));

export const listOffersByBarcodes = (storeId: string, byBarcodes: string[] | undefined, part: string[]) =>
  q<Offer[]>(db.rpc('store_offers', { p_store: storeId, ...(byBarcodes ? { p_barcodes: part } : { p_variants: part }) }));

export const companyDirectory = () =>
  q<CompanyCard[]>(db.rpc('company_directory'));

export const priceAccess = (companyId: string, storeOrg: string) =>
  q<PriceAccess>(db.rpc('price_access', { p_company: companyId, p_store_org: storeOrg }));

export const requestPriceAccess = (companyId: string, storeOrg: string) =>
  q(db.rpc('request_price_access', { p_company: companyId, p_store_org: storeOrg }));

/** Заказы: торговая точка видит свои заказы поставщикам, поставщик — заказы магазинов. */
export const listOrders = (orgId: string, isCompany: boolean, storeId?: string) => {
  let query = db.from('orders').select('*').eq(isCompany ? 'supplier_org' : 'store_org', orgId);
  if (!isCompany && storeId) query = query.eq('store_id', storeId);
  return q<Order[]>(query.order('created_at', { ascending: false }).limit(500));
};

export const getOrder = (id: string) =>
  q<(Order & { order_items: OrderItem[] }) | null>(db.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle() as never);

export const listTrackedVariants = (ids: string[]) =>
  q<{ id: string }[]>(db.from('company_variants').select('id').in('id', ids).eq('track_stock', true));

export const listBranchStock = (branchId: string, ids: string[]) =>
  q<{ variant_id: string; qty: number }[]>(db.from('company_stock').select('variant_id, qty').eq('branch_id', branchId).in('variant_id', ids));

export const setOrderStatus = (orderId: string, status: string, extra: Record<string, unknown>) =>
  q(db.rpc('set_order_status', { p_order: orderId, p_status: status, ...extra }));

export const receiveOrder = (orderId: string) =>
  q<string>(db.rpc('receive_order', { p_order: orderId }));

export const setOrderBranch = (orderId: string, value: string) =>
  q(db.rpc('set_order_branch', { p_order: orderId, p_branch: value }));

export const listCompanyOrders = (orgId: string) =>
  q<Order[]>(db.from('orders').select('*').eq('supplier_org', orgId).order('created_at', { ascending: false }).limit(1000));

export const placeOrder = (storeId: string, companyId: string, comment: string, items: { variantId: string; qty: number }[]) =>
  q<string>(db.rpc('place_order', {
    p_store: storeId, p_supplier: companyId, p_comment: comment,
    p_items: items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
  }));
