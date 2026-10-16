// Товары торговой точки: карточки, категории, быстрые товары, остатки, общий каталог.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { Category, PackUnit, Product, QuickGroup, SizeUnit, StockMove, StockRow, Unit } from '../lib/types';
import type { CatalogItem, StarterItem } from '../lib/starter';
import { db, q } from '../lib/supabase';

export interface StockTotals {
  positions: number;
  purchase_sum: number;
  sale_sum: number;
}

export interface StockPageTotals {
  positions: number;
  qty: number;
  purchase_sum: number;
  sale_sum: number;
}

export interface CategoryRow {
  category: string;
  subcategory: string;
  cnt: number;
}

export interface BrandRow {
  /** пустая строка — товары без распознанного производителя («Другие») */
  company: string;
  cnt: number;
  mine: number;
  logo_url: string;
  verified: boolean;
}

export type CatalogRow = CatalogItem & { company: string; offers: number; total: number };

export const listCategories = (orgId: string) =>
  q<Category[]>(db.from('categories').select('*').eq('org_id', orgId).order('name'));

export const listQuickGroups = (orgId: string) =>
  q<QuickGroup[]>(db.from('quick_groups').select('*').eq('org_id', orgId).order('sort').order('name'));

export const stockTotals = (storeId: string) =>
  q<StockTotals[]>(db.rpc('stock_totals', { p_store: storeId }));

export const listLowStock = (storeId: string) =>
  q<StockRow[]>(db.from('product_stock').select('*').eq('store_id', storeId).eq('archived', false).eq('low', true).order('qty').limit(8));

export const countProducts = (orgId: string) =>
  db.from('products').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('archived', false);

export const updateCategory = (row: { org_id: string; name: string; markup_pct: number; parent_id: string | null; }, id: string) =>
  q<Category>(db.from('categories').update(row).eq('id', id).select().single());

export const addCategory = (row: { org_id: string; name: string; markup_pct: number; parent_id: string | null; }) =>
  q<Category>(db.from('categories').insert(row).select().single());

export const deleteCategory = (id: string) =>
  q(db.from('categories').delete().eq('id', id));

export const productsPageQuery = (orgId: string) =>
  db.from('products').select('*', { count: 'exact' }).eq('org_id', orgId).eq('archived', false);

export const updateProducts = (patch: { archived: boolean; quick_group_id: null; category_id?: undefined; supplier_id?: undefined; } | { category_id: string | null; archived?: undefined; quick_group_id?: undefined; supplier_id?: undefined; } | { supplier_id: string | null; archived?: undefined; quick_group_id?: undefined; category_id?: undefined; } | { quick_group_id: string | null; archived?: undefined; category_id?: undefined; supplier_id?: undefined; }, ids: string[], orgId: string) =>
  q(db.from('products').update(patch).in('id', ids).eq('org_id', orgId));

export const activeProductsQuery = (orgId: string) =>
  db.from('products').select('*').eq('org_id', orgId).eq('archived', false);

export const findProducts = (orgId: string, term: string, limit: number) =>
  q<Product[]>(
    db.from('products').select('*').eq('org_id', orgId).eq('archived', false)
      .or(`name.ilike.%${term}%,barcode.ilike.${term}%,sku.ilike.${term}%`)
      .order('name').limit(limit),
  );

export const getProduct = (id: string, orgId: string) =>
  q<Product>(db.from('products').select('*').eq('id', id).eq('org_id', orgId).single());

export const listProductStock = (productId: string) =>
  q<{ store_id: string; qty: number }[]>(db.from('stock').select('store_id, qty').eq('product_id', productId));

export const listStockMoves = (productId: string, storeId: string) =>
  q<StockMove[]>(
    db.from('stock_moves').select('id, delta, qty_after, reason, ref_number, created_at')
      .eq('product_id', productId).eq('store_id', storeId).order('id', { ascending: false }).limit(200),
  );

export const updateProduct = (row: { unit: Unit; barcode: string; extra_barcodes: string[]; sku: string; min_stock: number | null; purchase_price: number; sale_price: number; wholesale_price: number; category_id: string | null; supplier_id: string | null; quick_group_id: string | null; quick_name: string; title: string; size_value: number | null; size_unit: SizeUnit | null; percent: number | null; pack_qty: number | null; pack_unit: PackUnit | null; package: string | null; org_id: string; kind: "product" | "service"; name: string; }, id: string) =>
  q(db.from('products').update(row).eq('id', id));

export const addProduct = (row: { unit: Unit; barcode: string; extra_barcodes: string[]; sku: string; min_stock: number | null; purchase_price: number; sale_price: number; wholesale_price: number; category_id: string | null; supplier_id: string | null; quick_group_id: string | null; quick_name: string; title: string; size_value: number | null; size_unit: SizeUnit | null; percent: number | null; pack_qty: number | null; pack_unit: PackUnit | null; package: string | null; org_id: string; kind: "product" | "service"; name: string; }) =>
  q(db.from('products').insert(row));

export const archiveProduct = (id: string) =>
  q(db.from('products').update({ archived: true, quick_group_id: null }).eq('id', id));

export const stockPageQuery = (storeId: string) =>
  db.from('product_stock').select('*', { count: 'exact' }).eq('store_id', storeId).eq('archived', false);

export const stockPageTotals = (storeId: string) =>
  q<StockPageTotals[]>(db.rpc('stock_totals', { p_store: storeId }));

export const listQuickProducts = (orgId: string, groupId: string) =>
  q<Product[]>(
    db.from('products').select('*').eq('org_id', orgId).eq('quick_group_id', groupId)
      .eq('archived', false).order('quick_sort').order('name'),
  );

export const addQuickGroup = (orgId: string, name: string, sort: number) =>
  q<QuickGroup>(
    db.from('quick_groups').insert({ org_id: orgId, name: name.trim(), sort: sort }).select().single(),
  );

export const renameQuickGroup = (name: string, id: string) =>
  q(db.from('quick_groups').update({ name: name.trim() }).eq('id', id));

export const deleteQuickGroup = (id: string) =>
  q(db.from('quick_groups').delete().eq('id', id));

export const setQuickGroupSort = (sort: number, id: string) =>
  q(db.from('quick_groups').update({ sort }).eq('id', id));

export const setQuickSort = (quick_sort: number, id: string) =>
  q(db.from('products').update({ quick_sort }).eq('id', id));

export const removeFromQuickGroup = (productId: string) =>
  q(db.from('products').update({ quick_group_id: null }).eq('id', productId));

export const saveQuickName = (quickName: string, id: string) =>
  q(db.from('products').update({ quick_name: quickName.trim() }).eq('id', id));

export const listAllQuickProducts = (orgId: string) =>
  q<Product[]>(
    db.from('products').select('*').eq('org_id', orgId).eq('archived', false).not('quick_group_id', 'is', null)
      .order('quick_sort').order('name').limit(1000),
  );

export const catalogCategories = (orgId: string) =>
  q<CategoryRow[]>(db.rpc('catalog_categories', { p_org: orgId }));

export const catalogCompanyList = (orgId: string, category: string, sub: string | null) =>
  q<BrandRow[]>(db.rpc('catalog_company_list', { p_org: orgId, p_category: category, p_subcategory: sub }));

export const catalogSearch = (orgId: string, term: string, category: string | null, sub: string | null, onlyNew: boolean, pageSize: number, page: number, brand: string | null, onlyOffers: boolean) =>
  q<CatalogRow[]>(db.rpc('catalog_search', {
    p_org: orgId, p_term: term, p_category: category, p_subcategory: sub, p_only_new: onlyNew,
    p_limit: pageSize, p_offset: page * pageSize, p_company: term ? null : brand, p_only_offers: onlyOffers,
  }));

export const addCatalogProducts = (orgId: string, ids: string[], prices: { id: string; purchase_price: number; sale_price?: number }[]) =>
  q<{ created: number; skipped: number }>(db.rpc('add_catalog_products', { p_org: orgId, p_ids: ids, p_prices: prices }));

export const starterProducts = (orgId: string) =>
  q<StarterItem[]>(db.rpc('starter_products', { p_org: orgId }));

export const findCatalogProduct = (code: string) =>
  q<{ name: string; unit: Unit; category: string; subcategory: string } | null>(
    db.from('catalog_products').select('name, unit, category, subcategory').eq('barcode', code).maybeSingle(),
  );

export const catalogCategoryNames = (orgId: string) =>
  q<{ category: string; subcategory: string }[]>(db.rpc('catalog_categories', { p_org: orgId }));

/** Загрузка товаров из файла или накладной: новые создаются, найденные по штрихкоду обновляются. */
export const importProducts = (orgId: string, storeId: string | null, rows: unknown[]) =>
  q<{ created: number; updated: number; skipped: number }>(db.rpc('import_products', { p_org: orgId, p_store: storeId, p_rows: rows }));

export const addToQuickGroup = (productId: string, groupId: string, sort: number) =>
  q(db.from('products').update({ quick_group_id: groupId, quick_sort: sort }).eq('id', productId));

export const listProductsByIds = (ids: string[]) =>
  q<Product[]>(db.from('products').select('*').in('id', ids));

/** Свои остатки по штрихкодам: рядом с предложениями поставщика видно, сколько товара уже есть. */
export const listStockByBarcodes = (storeId: string, barcodes: string[]) =>
  q<Pick<StockRow, 'barcode' | 'qty' | 'min_stock' | 'low' | 'unit'>[]>(
    db.from('product_stock').select('barcode, qty, min_stock, low, unit').eq('store_id', storeId).eq('archived', false).in('barcode', barcodes),
  );
