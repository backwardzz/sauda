// Кабинет поставщика: каталог, виды, склад по филиалам, филиалы, ключи API, доступ к ценам.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { Branch, Company, CompanyProduct, CompanyType, PriceAccessMode, PriceAccessStatus, StockMoveRow, Variant, VariantStats } from '../lib/types';
import type { GeoData } from '../lib/geo';
import { db, q } from '../lib/supabase';

export interface SaleLine {
  variant_id: string;
  qty: number;
  qty_shipped: number | null;
  price: number;
  orders: { id: string; number: number; status: string; shipped_at: string | null; store_org: string; store_org_name: string };
}

export interface PriceAccessRow {
  store_org: string;
  store_name: string;
  city: string;
  phone: string;
  status: PriceAccessStatus;
  requested_at: string;
  decided_at: string | null;
  orders: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface Zone {
  branch_id: string;
  region_id: number | null;
  city_id: number | null;
}

export const getCompany = (orgId: string) =>
  q<Company | null>(db.from('companies').select('*').eq('org_id', orgId).maybeSingle());

export const listBranches = (orgId: string) =>
  q<Branch[]>(db.from('company_branches').select('*').eq('org_id', orgId).order('is_main', { ascending: false }).order('created_at'));

export const listCompanyProducts = (orgId: string) =>
  q<CompanyProduct[]>(db.from('company_products').select('*').eq('org_id', orgId).eq('archived', false).order('name').limit(5000));

export const listVariants = (orgId: string) =>
  q<Omit<Variant, 'min_stock'>[]>(db.from('company_variants').select('*').eq('org_id', orgId).eq('archived', false).order('sort').order('price').limit(20000));

export const listVariantLimits = (orgId: string) =>
  q<{ variant_id: string; min_stock: number }[]>(db.from('company_variant_limits').select('variant_id, min_stock').eq('org_id', orgId).limit(20000));

export const listCompanyStock = (orgId: string) =>
  q<{ variant_id: string; branch_id: string; qty: number; price: number | null; listed: boolean }[]>(
  db.from('company_stock').select('variant_id, branch_id, qty, price, listed').eq('org_id', orgId).limit(50000));

export const companyStats = (orgId: string) =>
  q<VariantStats[]>(db.rpc('company_stats', { p_org: orgId }));

export const setProductImage = (url: string, productId: string) =>
  q(db.from('company_products').update({ image_url: url }).eq('id', productId));

export const listVariantSales = (ids: string[]) =>
  q<SaleLine[]>(db.from('order_items')
  .select('variant_id, qty, qty_shipped, price, orders!inner(id, number, status, shipped_at, store_org, store_org_name)')
  .in('variant_id', ids).limit(5000) as never);

export const listStockMoves = (ids: string[]) =>
  q<StockMoveRow[]>(db.from('company_stock_moves').select('*').in('variant_id', ids).order('created_at', { ascending: false }).limit(40));

export const updateVariant = (fields: Partial<Pick<Variant, "price" | "active">>, variantId: string) =>
  q(db.from('company_variants').update(fields).eq('id', variantId));

export const setCompanyStock = (variantId: string, branchId: string, qty: number) =>
  q(db.rpc('set_company_stock', { p_variant: variantId, p_branch: branchId, p_qty: qty }));

export const archiveProduct = (productId: string) =>
  q(db.rpc('archive_company_product', { p_product: productId }));

export const companyGeo = (orgId: string, from: string, to: string) =>
  q<GeoData>(db.rpc('company_geo', { p_org: orgId, p_from: from, p_to: to }));

export const priceAccessList = (orgId: string) =>
  q<PriceAccessRow[]>(db.rpc('price_access_list', { p_company: orgId }));

export const decidePriceAccess = (orgId: string, storeOrg: string, status: "approved" | "declined") =>
  q(db.rpc('decide_price_access', { p_company: orgId, p_store_org: storeOrg, p_status: status }));

export const setBranchListed = (variantId: string, branchId: string, checked: boolean) =>
  q(db.rpc('set_branch_listed', { p_variant: variantId, p_branch: branchId, p_listed: checked }));

export const setBranchPrice = (variantId: string, branchId: string, price: number) =>
  q(db.rpc('set_branch_price', { p_variant: variantId, p_branch: branchId, p_price: price }));

export const clearBranchPrice = (variantId: string, branchId: string) =>
  q(db.rpc('set_branch_price', { p_variant: variantId, p_branch: branchId, p_price: null }));

export const listApiKeys = (orgId: string) =>
  q<ApiKey[]>(db.from('company_api_keys').select('id, name, prefix, created_at, last_used_at, revoked_at')
  .eq('org_id', orgId).is('revoked_at', null).order('created_at'));

export const createApiKey = (orgId: string, name: string) =>
  q<string>(db.rpc('create_api_key', { p_org: orgId, p_name: name }));

export const revokeApiKey = (keyId: string) =>
  q(db.rpc('revoke_api_key', { p_key: keyId }));

export const listStockedBranches = (orgId: string) =>
  q<{ branch_id: string }[]>(db.from('company_stock').select('branch_id').eq('org_id', orgId).gt('qty', 0).limit(20000));

export const listBusyBranches = (orgId: string) =>
  q<{ branch_id: string | null }[]>(db.from('orders').select('branch_id').eq('supplier_org', orgId).in('status', ['new', 'confirmed']).limit(5000));

export const listBranchZones = (orgId: string) =>
  q<Zone[]>(db.from('company_branch_zones').select('branch_id, region_id, city_id').eq('org_id', orgId));

export const addBranch = (orgId: string, cityId: number | null, row: { name: string; address: string; phone: string; manager_name: string; work_hours: string; markup_pct: number; min_order: number | null; delivery_note: string; city_id?: number | undefined; }) =>
  q<Branch>(db.from('company_branches').insert({ org_id: orgId, city_id: cityId!, ...row }).select().single());

export const updateBranch = (row: { name: string; address: string; phone: string; manager_name: string; work_hours: string; markup_pct: number; min_order: number | null; delivery_note: string; city_id?: number | undefined; }, id: string) =>
  q(db.from('company_branches').update(row).eq('id', id));

export const setBranchZones = (branchId: string, regions: number[], cities: number[]) =>
  q(db.rpc('set_branch_zones', { p_branch: branchId, p_regions: regions, p_cities: cities }));

export const setMainBranch = (branchId: string) =>
  q(db.rpc('set_main_branch', { p_branch: branchId }));

export const deleteBranch = (id: string) =>
  q(db.rpc('delete_company_branch', { p_branch: id }));

export const importCompanyProducts = (orgId: string, branchId: string | null, rows: unknown[]) =>
  q<{ created: number; updated: number; products: number }>(db.rpc('import_company_products', { p_org: orgId, p_branch: branchId, p_rows: rows }));

export const importCompanyStock = (orgId: string, rows: unknown[]) =>
  q<{ updated: number; unchanged: number; not_found: string[] }>(db.rpc('import_company_stock', { p_org: orgId, p_rows: rows }));

/** Товар каталога вместе с видами одной операцией; возвращает id товара. */
export const saveCompanyProduct = (
  orgId: string,
  product: { id: string | null; name: string; category: string; description: string; imageUrl: string },
  variants: unknown[],
) =>
  q<string>(db.rpc('save_company_product', {
    p_org: orgId,
    p_product: { id: product.id, name: product.name, category: product.category, description: product.description, image_url: product.imageUrl },
    p_variants: variants,
  }));

export const updateCompanyProfile = (
  orgId: string,
  p: { type: CompanyType; description: string; website: string; minOrder: number; deliveryNote: string; paymentTerms: string; priceAccess: PriceAccessMode },
) =>
  q(db.from('companies').update({
    company_type: p.type, description: p.description, website: p.website,
    min_order: p.minOrder, delivery_note: p.deliveryNote, payment_terms: p.paymentTerms, price_access: p.priceAccess,
  }).eq('org_id', orgId));
