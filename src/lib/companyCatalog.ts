import { useQuery } from './hooks';
import { db, q } from './supabase';
import type { CompanyProduct, Variant, VariantStats } from './types';

export interface CompanyCatalog {
  products: CompanyProduct[];
  /** Виды по товарам, в порядке, заданном в карточке товара. */
  variants: Map<string, Variant[]>;
  /** Вид → филиал → остаток. */
  stock: Map<string, Record<string, number>>;
  stats: Map<string, VariantStats>;
}

/** Каталог компании целиком: товары, виды, остатки по филиалам и продажи. */
export function useCompanyCatalog(orgId: string) {
  return useQuery<CompanyCatalog>(async () => {
    const [products, variants, stock, stats] = await Promise.all([
      q<CompanyProduct[]>(db.from('company_products').select('*').eq('org_id', orgId).eq('archived', false).order('name').limit(5000)),
      q<Variant[]>(db.from('company_variants').select('*').eq('org_id', orgId).eq('archived', false).order('sort').order('price').limit(20000)),
      q<{ variant_id: string; branch_id: string; qty: number }[]>(db.from('company_stock').select('variant_id, branch_id, qty').eq('org_id', orgId).limit(50000)),
      q<VariantStats[]>(db.rpc('company_stats', { p_org: orgId })),
    ]);
    const byProduct = new Map<string, Variant[]>();
    for (const v of variants) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);
    const byVariant = new Map<string, Record<string, number>>();
    for (const s of stock) byVariant.set(s.variant_id, { ...(byVariant.get(s.variant_id) ?? {}), [s.branch_id]: Number(s.qty) });
    return { products, variants: byProduct, stock: byVariant, stats: new Map(stats.map((s) => [s.variant_id, s])) };
  }, [orgId]);
}

export type StockState = 'untracked' | 'ok' | 'low' | 'out';

export interface Totals {
  /** Сумма остатков видов с учётом; null — ни у одного вида остаток не учитывается. */
  stock: number | null;
  reserved: number;
  /** Свободно: остаток минус резерв; null — без учёта. */
  free: number | null;
  sold: number;
  sold30: number;
  soldSum: number;
  lastSold: string | null;
  state: StockState;
}

/** Состояние склада одного вида: «заканчивается» — когда свободного не больше порога. */
export function variantState(v: Variant, s: VariantStats | undefined): StockState {
  if (!v.track_stock) return 'untracked';
  const free = Number(s?.stock ?? 0) - Number(s?.reserved ?? 0);
  if (free <= 0) return 'out';
  return v.min_stock != null && free <= Number(v.min_stock) ? 'low' : 'ok';
}

/** Сводка по набору видов: по товару или по всему каталогу. */
export function totals(variants: Variant[], stats: Map<string, VariantStats>): Totals {
  const t: Totals = { stock: null, reserved: 0, free: null, sold: 0, sold30: 0, soldSum: 0, lastSold: null, state: 'untracked' };
  const states = new Set<StockState>();
  for (const v of variants) {
    const s = stats.get(v.id);
    if (v.active) states.add(variantState(v, s));
    if (v.track_stock) {
      t.stock = (t.stock ?? 0) + Number(s?.stock ?? 0);
      t.free = (t.free ?? 0) + Number(s?.stock ?? 0) - Number(s?.reserved ?? 0);
    }
    t.reserved += Number(s?.reserved ?? 0);
    t.sold += Number(s?.sold_qty ?? 0);
    t.sold30 += Number(s?.sold_qty_30 ?? 0);
    t.soldSum += Number(s?.sold_sum ?? 0);
    if (s?.last_sold_at && (!t.lastSold || s.last_sold_at > t.lastSold)) t.lastSold = s.last_sold_at;
  }
  // товар «закончился», только если закончились все виды в продаже; «заканчивается» — если хоть один
  t.state = states.size === 0 ? 'untracked'
    : [...states].every((s) => s === 'out') ? 'out'
    : states.has('low') || states.has('out') ? 'low'
    : states.has('ok') ? 'ok' : 'untracked';
  return t;
}

export const STOCK_BADGE: Record<StockState, { label: string; badge: string }> = {
  untracked: { label: 'без учёта остатка', badge: '' },
  ok: { label: 'в наличии', badge: 'ok' },
  low: { label: 'заканчивается', badge: 'warn' },
  out: { label: 'нет в наличии', badge: 'danger' },
};
