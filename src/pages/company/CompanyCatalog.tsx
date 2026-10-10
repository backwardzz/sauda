import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STOCK_BADGE, totals, useCompanyCatalog } from '../../lib/companyCatalog';
import { money, moneyShort, plural, qty as fmtQty } from '../../lib/format';
import { useQuery, useStored } from '../../lib/hooks';
import { parseImport } from '../../lib/importParse';
import { useCompany } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Variant } from '../../lib/types';
import { fullName, priceRange, splitName } from '../../lib/variants';
import { exportXlsx, readXlsx } from '../../lib/xlsx';
import { Icon } from '../../ui/Icon';
import { ProductImage } from '../../ui/ProductImage';
import { toast } from '../../ui/toast';
import { ProductEditor } from './ProductEditor';

type Filter = 'all' | 'active' | 'low' | 'out' | 'hidden';

const FILTERS: [Filter, string][] = [
  ['all', 'Все'], ['active', 'В продаже'], ['low', 'Заканчиваются'], ['out', 'Нет в наличии'], ['hidden', 'Сняты с продажи'],
];

/** Каталог компании: товары по категориям, внутри товара — его виды. */
export function CompanyCatalog() {
  const { org, canEditCatalog: canManage, branches } = useCompany();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  /** null — все категории, '' — без категории */
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useStored<Filter>('sauda:company:filter', 'all');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stockBranch, setStockBranch] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const data = useCompanyCatalog(org.id);
  // категории общего каталога площадки: подсказки, чтобы у компаний они назывались одинаково
  const shared = useQuery(
    () => q<{ category: string; subcategory: string }[]>(db.rpc('catalog_categories', { p_org: org.id })).catch(() => []),
    [org.id],
  );

  const products = useMemo(() => data.data?.products ?? [], [data.data]);

  const list = useMemo(
    () => products.map((p) => {
      const own: Variant[] = data.data?.variants.get(p.id) ?? [];
      return { product: p, variants: own, sum: totals(own, data.data?.stats ?? new Map()) };
    }),
    [products, data.data],
  );
  const variantCount = list.reduce((n, i) => n + i.variants.length, 0);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru')));
  }, [products]);
  const categoryHints = useMemo(
    () => [...new Set([...categories.map(([c]) => c), ...(shared.data ?? []).flatMap((c) => [c.subcategory, c.category])].filter(Boolean))],
    [categories, shared.data],
  );

  const term = search.trim().toLowerCase();
  const fits = (f: Filter, i: (typeof list)[number]) =>
    f === 'all' ? true
    : f === 'hidden' ? i.variants.some((v) => !v.active)
    : f === 'active' ? i.variants.some((v) => v.active)
    : i.sum.state === f;
  const shown = list.filter((i) =>
    (category === null || i.product.category === category) && fits(filter, i) &&
    (!term || i.product.name.toLowerCase().includes(term) || i.product.category.toLowerCase().includes(term) ||
      i.variants.some((v) => v.barcode.includes(term) || v.label.toLowerCase().includes(term))));
  const countOf = (f: Filter) => list.filter((i) => fits(f, i)).length;

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const { items } = parseImport(await readXlsx(f));
      const total = { created: 0, updated: 0, products: 0 };
      for (let i = 0; i < items.length; i += 500) {
        const res = await q<typeof total>(db.rpc('import_company_products', {
          p_org: org.id, p_branch: stockBranch || null,
          p_rows: items.slice(i, i + 500).map((r) => {
            // «Товар» и «Вид» из нашей же выгрузки берутся как есть; обычный прайс раскладывается по размеру в названии
            const parts = r.product ? { product: r.product, label: r.label ?? '' } : splitName(r.name);
            return {
              ...parts, barcode: r.barcode, unit: r.unit, category: r.subcategory ?? r.category,
              // цена для магазинов: продажная из файла, а если её нет — закупочная
              price: r.sale_price ?? r.price ?? r.purchase_price, pack_qty: r.pack_qty, stock: r.qty,
            };
          }),
        }));
        total.created += res.created;
        total.updated += res.updated;
        total.products += res.products;
      }
      toast.ok(`Каталог обновлён: новых видов ${total.created}, изменено ${total.updated}, новых товаров ${total.products}`);
      data.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const download = () => {
    const rows = list.flatMap((i) => i.variants.map((v) => ({
      'Название': fullName(i.product.name, v.label), 'Товар': i.product.name, 'Вид': v.label, 'Штрихкод': v.barcode, 'Ед. изм': v.unit,
      'Продажная цена': Number(v.price), 'Категория': i.product.category, 'В упаковке': Number(v.pack_qty),
      'Остаток': v.track_stock ? Number(data.data?.stats.get(v.id)?.stock ?? 0) : '',
    })));
    if (!rows.length) return toast.error('В каталоге пока нет товаров');
    exportXlsx(`Каталог ${org.name}`, 'Каталог', rows).catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>Каталог</h1>
        <span className="muted">
          {products.length} {plural(products.length, 'товар', 'товара', 'товаров')}, {variantCount} {plural(variantCount, 'вид', 'вида', 'видов')}.
          Магазины видят то, что в продаже.
        </span>
      </div>
      <div className="toolbar">
        {canManage && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Товар</button>}
        <input className="search" type="search" placeholder="Название, вид или штрихкод" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="segmented">
          {FILTERS.map(([f, label]) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {label}{f !== 'all' && f !== 'active' && countOf(f) > 0 && <span className="seg-count">{countOf(f)}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {canManage && (
          <>
            <input ref={file} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => importFile(e.target.files?.[0])} />
            {branches.length > 1 && (
              <select value={stockBranch} onChange={(e) => setStockBranch(e.target.value)} aria-label="Склад для остатков из файла" title="На какой склад ставить остатки из файла">
                <option value="">Остатки из файла — в главный филиал</option>
                {branches.filter((b) => !b.is_main).map((b) => <option key={b.id} value={b.id}>Остатки из файла — {b.name}</option>)}
              </select>
            )}
            <button className="btn" disabled={busy} onClick={() => file.current?.click()}
              title="Столбцы: Название, Штрихкод, Ед. изм, Продажная цена, Категория, В упаковке, Остаток. Размер в названии станет видом товара.">
              <Icon name="upload" size={16} />Загрузить прайс
            </button>
          </>
        )}
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      <div className="split">
        <div className="card side-list">
          <button className={category === null ? 'active' : ''} onClick={() => setCategory(null)}>
            <span className="grow">Все товары</span><span className="side-count">{products.length || ''}</span>
          </button>
          {categories.map(([name, cnt]) => (
            <button key={name} className={category === name ? 'active' : ''} onClick={() => setCategory(name)}>
              <span className="grow">{name || 'Без категории'}</span><span className="side-count">{cnt}</span>
            </button>
          ))}
        </div>

        {data.error ? <div className="card empty error-text">{data.error}</div>
          : data.loading && !data.data ? <div className="card empty">Загрузка…</div>
          : shown.length === 0 ? (
            <div className="card empty">
              {products.length === 0
                ? <><p><b>Каталог пуст.</b></p><p style={{ marginTop: 6 }}>Добавьте товар кнопкой «Товар» или загрузите прайс из Excel — виды товаров соберутся сами.</p></>
                : 'Ничего не найдено'}
            </div>
          ) : (
            <div className="product-grid wide">
              {shown.map(({ product: p, variants: own, sum }) => {
                const range = priceRange(own);
                return (
                  <button className="card product-card clickable" key={p.id} onClick={() => navigate(`/catalog/${p.id}`)}>
                    <ProductImage src={p.image_url || own.find((v) => v.image_url)?.image_url || ''} alt="" />
                    <div className="product-name" title={p.name}>{p.name}</div>
                    <div className="variant-chips">
                      {own.slice(0, 4).map((v) => <span key={v.id} className={`badge ${v.active ? '' : 'off'}`}>{v.label || v.unit}</span>)}
                      {own.length > 4 && <span className="badge">+{own.length - 4}</span>}
                    </div>
                    <div className="row">
                      <b className="num product-price">
                        {range ? (range[0] === range[1] ? money(range[0]) : `${moneyShort(range[0])} – ${moneyShort(range[1])}`) : '—'}
                        <span className="stat-unit">{org.currency}</span>
                      </b>
                    </div>
                    <div className="row wrap product-foot">
                      <span className={`badge ${STOCK_BADGE[sum.state].badge}`}>
                        {sum.state === 'untracked' ? STOCK_BADGE.untracked.label : sum.state === 'out' ? STOCK_BADGE.out.label : `на складе ${fmtQty(sum.stock)}`}
                      </span>
                      {sum.reserved > 0 && <span className="badge accent" title="Заказано магазинами и ещё не отгружено">в заказах {fmtQty(sum.reserved)}</span>}
                      <span className="muted" title="Отгружено магазинам за всё время">продано {fmtQty(sum.sold)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </div>

      {adding && <ProductEditor categories={categoryHints} onClose={() => setAdding(false)} onSaved={() => data.reload()} />}
    </>
  );
}
