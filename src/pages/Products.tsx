import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dateOnly, marginPct, markupPct, money, parseNum } from '../lib/format';
import { useChanged, useDebounced, useQuery, useStored } from '../lib/hooks';
import { packText, percentText, sizeText } from '../lib/productAttrs';
import { categoryTree, useCategories, useContractors, useQuickGroups } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q, safeTerm } from '../lib/supabase';
import type { Category, Product } from '../lib/types';
import { exportXlsx } from '../lib/xlsx';
import { DataTable, Pager, type Column, type Sort } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Confirm, Modal } from '../ui/Modal';
import { toast } from '../ui/toast';
import { CategoryModal } from './CategoryModal';
import { ImportModal } from './ImportModal';

interface Filters {
  supplier: string;
  kind: '' | 'product' | 'service';
  unit: string;
  priceFrom: string;
  priceTo: string;
}

const NO_FILTERS: Filters = { supplier: '', kind: '', unit: '', priceFrom: '', priceTo: '' };
const SORT_COLUMN: Record<string, string> = {
  name: 'title', size: 'size_value', percent: 'percent', barcode: 'barcode', sku: 'sku', purchase: 'purchase_price', sale: 'sale_price', updated: 'updated_at',
};

type Bulk = 'category' | 'supplier' | 'quick' | 'delete';

export function Products() {
  const { org, store } = useWorkspace();
  const navigate = useNavigate();
  const categories = useCategories(org.id);
  const suppliers = useContractors(org.id, 'supplier');
  const quickGroups = useQuickGroups(org.id);

  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const [category, setCategory] = useState<string>('all');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useStored('sauda:products:pageSize', 50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<'action' | 'io' | null>(null);
  const [catModal, setCatModal] = useState<Category | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [busy, setBusy] = useState(false);
  const menus = useRef<HTMLDivElement>(null);

  if (useChanged([term, category, filters, pageSize]) && page !== 0) setPage(0);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!menus.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  // подкатегории показываются только у раскрытой категории: в большой базе их больше сотни
  const openRoot = (categories.data ?? []).find((c) => c.id === category)?.parent_id ?? category;
  const hasChildren = (id: string) => (categories.data ?? []).some((c) => c.parent_id === id);

  /** Фильтры списка: общие для страницы таблицы и для полной выгрузки. */
  const scoped = () => {
    let query = db.from('products').select('*', { count: 'exact' }).eq('org_id', org.id).eq('archived', false);
    // в названиях дробь пишется с запятой: «0.5» в поиске находит «0,5 л»
    const s = safeTerm(term).replace(/(d).(d)/g, '$1,$2');
    if (s) {
      // доп. код ищется только целиком: пустой набор в cs.{} совпал бы со всеми товарами
      const code = /^[\w-]+$/.test(s) ? `,extra_barcodes.cs.{${s}}` : '';
      query = query.or(`name.ilike.%${s}%,barcode.ilike.${s}%,sku.ilike.${s}%${code}`);
    }
    if (category === 'none') query = query.is('category_id', null);
    else if (category !== 'all') {
      const ids = [category, ...(categories.data ?? []).filter((c) => c.parent_id === category).map((c) => c.id)];
      query = query.in('category_id', ids);
    }
    if (filters.supplier) query = query.eq('supplier_id', filters.supplier);
    if (filters.kind) query = query.eq('kind', filters.kind);
    if (filters.unit) query = query.eq('unit', filters.unit);
    if (filters.priceFrom) query = query.gte('sale_price', parseNum(filters.priceFrom));
    if (filters.priceTo) query = query.lte('sale_price', parseNum(filters.priceTo));
    return query.order(SORT_COLUMN[sort.key] ?? 'name', { ascending: sort.dir === 'asc' }).order('id');
  };

  const list = useQuery(async () => {
    const { data, count, error } = await scoped().range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as Product[], total: count ?? 0 };
  }, [org.id, term, category, filters, sort, page, pageSize, categories.data]);

  const catName = (id: string | null) => (categories.data ?? []).find((c) => c.id === id)?.name ?? '';
  const supName = (id: string | null) => (suppliers.data ?? []).find((c) => c.id === id)?.name ?? '';

  const columns: Column<Product>[] = [
    {
      key: 'name', title: 'Название товара', sortable: true, fixed: true,
      render: (p) => (
        <Link to={`/products/${p.id}`} onClick={(e) => e.stopPropagation()}>
          {p.title}
          {p.kind === 'service' && <span className="badge" style={{ marginLeft: 8 }}>услуга</span>}
        </Link>
      ),
    },
    { key: 'size', title: 'Объём / вес', sortable: true, align: 'right', value: sizeText },
    { key: 'percent', title: '%', sortable: true, align: 'right', value: percentText },
    { key: 'pack', title: 'В упаковке', align: 'right', value: packText },
    { key: 'package', title: 'Упаковка', value: (p) => p.package ?? '' },
    { key: 'barcode', title: 'Штрихкод', sortable: true, render: (p) => <span className="num">{p.barcode}</span> },
    { key: 'sku', title: 'Артикул', sortable: true, value: (p) => p.sku },
    { key: 'extra', title: 'Доп. код', optional: true, value: (p) => p.extra_barcodes.join('; ') },
    { key: 'purchase', title: `Закуп. цена, ${org.currency}`, align: 'right', sortable: true, render: (p) => money(p.purchase_price) },
    { key: 'sale', title: `Прод. цена, ${org.currency}`, align: 'right', sortable: true, render: (p) => money(p.sale_price) },
    { key: 'unit', title: 'Ед. изм', value: (p) => p.unit },
    { key: 'markup', title: 'Наценка %', align: 'right', render: (p) => markupPct(p.purchase_price, p.sale_price) },
    { key: 'margin', title: 'Маржа %', align: 'right', render: (p) => marginPct(p.sale_price, p.sale_price - p.purchase_price) },
    { key: 'category', title: 'Категория', value: (p) => catName(p.category_id) },
    { key: 'supplier', title: 'Поставщик', value: (p) => supName(p.supplier_id) },
    { key: 'updated', title: 'Дата изм.', optional: true, sortable: true, render: (p) => dateOnly(p.updated_at) },
  ];

  const activeFilters = [
    filters.supplier && { key: 'supplier', label: `Поставщик: ${supName(filters.supplier)}` },
    filters.kind && { key: 'kind', label: filters.kind === 'service' ? 'Только услуги' : 'Только товары' },
    filters.unit && { key: 'unit', label: `Ед. изм: ${filters.unit}` },
    filters.priceFrom && { key: 'priceFrom', label: `Цена от ${filters.priceFrom}` },
    filters.priceTo && { key: 'priceTo', label: `Цена до ${filters.priceTo}` },
  ].filter(Boolean) as { key: keyof Filters; label: string }[];

  const exportAll = async () => {
    setMenu(null);
    try {
      const rows: Product[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await scoped().range(from, from + 999);
        if (error) throw error;
        rows.push(...((data ?? []) as Product[]));
        if (!data || data.length < 1000) break;
      }
      if (!rows.length) return toast.error('Нет товаров для выгрузки');
      await exportXlsx(`Товары ${org.name}`, 'Товары', rows.map((p) => ({
        // полное название: файл можно загрузить обратно, и база снова разложит его по колонкам
        'Название': p.name, 'Объём / вес': sizeText(p), 'Процент': percentText(p), 'В упаковке': packText(p),
        'Упаковка': p.package ?? '', 'Штрихкод': p.barcode, 'Доп. код': p.extra_barcodes.join('; '), 'Артикул': p.sku,
        'Ед. изм': p.unit, 'Закупочная цена': p.purchase_price, 'Продажная цена': p.sale_price,
        'Оптовая цена': p.wholesale_price, 'Категория': catName(p.category_id), 'Поставщик': supName(p.supplier_id),
      })));
    } catch (e) {
      toast.error(e);
    }
  };

  const applyBulk = async () => {
    if (!bulk) return;
    const ids = [...selected];
    const patch =
      bulk === 'delete' ? { archived: true, quick_group_id: null }
      : bulk === 'category' ? { category_id: bulkValue || null }
      : bulk === 'supplier' ? { supplier_id: bulkValue || null }
      : { quick_group_id: bulkValue || null };
    if (bulk === 'quick' && !bulkValue) return toast.error('Выберите группу быстрых товаров');
    setBusy(true);
    try {
      await q(db.from('products').update(patch).in('id', ids).eq('org_id', org.id));
      toast.ok(bulk === 'delete' ? `Удалено товаров: ${ids.length}` : `Изменено товаров: ${ids.length}`);
      setSelected(new Set());
      setBulk(null);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const openBulk = (b: Bulk) => {
    setMenu(null);
    setBulkValue('');
    setBulk(b);
  };

  return (
    <>
      <div className="page-head">
        <h1>Список товаров</h1>
        <span className="muted">Всего: {list.data?.total ?? '…'}</span>
      </div>

      <div className="toolbar" ref={menus}>
        <button className="btn primary" onClick={() => navigate('/products/new')}><Icon name="plus" size={16} />Товар</button>
        <button className="btn" onClick={() => navigate('/products/new?kind=service')}><Icon name="plus" size={16} />Услуга</button>
        <button className="btn" onClick={() => setCatModal('new')}><Icon name="plus" size={16} />Категория</button>
        <button className={`btn ${showFilters ? 'primary' : ''}`} onClick={() => setShowFilters((v) => !v)}>
          <Icon name="filter" size={16} />Фильтр
        </button>
        <input
          className="search"
          type="search"
          placeholder="Поиск по названию товара / штрихкоду"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="spacer" />
        <div className="popover-anchor">
          <button className="btn" disabled={selected.size === 0} onClick={() => setMenu(menu === 'action' ? null : 'action')}>
            <span className="badge accent">{selected.size}</span>Действие<Icon name="down" size={14} />
          </button>
          {menu === 'action' && (
            <div className="popover right">
              <button className="menu-item" onClick={() => openBulk('category')}><Icon name="tag" size={16} />Изменить категорию</button>
              <button className="menu-item" onClick={() => openBulk('supplier')}><Icon name="building" size={16} />Изменить поставщика</button>
              <button className="menu-item" onClick={() => openBulk('quick')}><Icon name="bolt" size={16} />Добавить в быстрые товары</button>
              <button className="menu-item danger" onClick={() => openBulk('delete')}><Icon name="trash" size={16} />Удалить</button>
            </div>
          )}
        </div>
        <div className="popover-anchor">
          <button className="btn" onClick={() => setMenu(menu === 'io' ? null : 'io')}>
            <Icon name="download" size={16} />Импорт / Экспорт<Icon name="down" size={14} />
          </button>
          {menu === 'io' && (
            <div className="popover right">
              <button className="menu-item" onClick={() => navigate('/catalog')}><Icon name="layers" size={16} />Из каталога товаров</button>
              <button className="menu-item" onClick={() => { setMenu(null); setImportOpen(true); }}><Icon name="upload" size={16} />Импорт из Excel</button>
              <button className="menu-item" onClick={exportAll}><Icon name="download" size={16} />Экспорт товаров</button>
            </div>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="card filter-grid">
          <label className="field">
            <span>Поставщик</span>
            <select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}>
              <option value="">Все</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Тип</span>
            <select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters['kind'] })}>
              <option value="">Товары и услуги</option>
              <option value="product">Товары</option>
              <option value="service">Услуги</option>
            </select>
          </label>
          <label className="field">
            <span>Ед. измерения</span>
            <select value={filters.unit} onChange={(e) => setFilters({ ...filters, unit: e.target.value })}>
              <option value="">Любая</option>
              {['шт', 'кг', 'л', 'м'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Продажная цена от</span>
            <input className="num-input" value={filters.priceFrom} onChange={(e) => setFilters({ ...filters, priceFrom: e.target.value })} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Продажная цена до</span>
            <input className="num-input" value={filters.priceTo} onChange={(e) => setFilters({ ...filters, priceTo: e.target.value })} inputMode="decimal" />
          </label>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="row wrap" style={{ marginBottom: 12 }}>
          {activeFilters.map((f) => (
            <span className="chip" key={f.key}>
              {f.label}
              <button onClick={() => setFilters({ ...filters, [f.key]: '' })} aria-label="Убрать фильтр"><Icon name="x" size={12} /></button>
            </span>
          ))}
          <button className="btn ghost small" onClick={() => setFilters(NO_FILTERS)}>Сбросить</button>
        </div>
      )}

      <div className="split">
        <div className="card side-list">
          <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Все товары</button>
          {tree.filter(({ cat, depth }) => depth === 0 || cat.parent_id === openRoot).map(({ cat, depth }) => (
            <div className="row" key={cat.id} style={{ gap: 0 }}>
              <button className={`grow ${depth ? 'side-sub' : ''} ${category === cat.id ? 'active' : ''}`} onClick={() => setCategory(cat.id)}>
                <span className="grow">{cat.name}</span>
                {depth === 0 && hasChildren(cat.id) && <Icon name={openRoot === cat.id ? 'up' : 'down'} size={14} />}
              </button>
              <button className="icon-btn small" style={{ width: 28 }} onClick={() => setCatModal(cat)} aria-label={`Изменить категорию ${cat.name}`}>
                <Icon name="edit" size={14} />
              </button>
            </div>
          ))}
          <button className={category === 'none' ? 'active' : ''} onClick={() => setCategory('none')}>Без категории</button>
        </div>

        <div>
          <DataTable
            id="products"
            columns={columns}
            rows={list.data?.rows ?? []}
            rowKey={(p) => p.id}
            loading={list.loading}
            error={list.error}
            empty={term || activeFilters.length || category !== 'all' ? 'Ничего не найдено' : 'Товаров пока нет. Добавьте первый, выберите из каталога товаров или загрузите список из Excel.'}
            sort={sort}
            onSort={setSort}
            selected={selected}
            onSelect={setSelected}
            onRowClick={(p) => navigate(`/products/${p.id}`)}
          />
          <Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} />
        </div>
      </div>

      {catModal && (
        <CategoryModal
          orgId={org.id}
          category={catModal === 'new' ? undefined : catModal}
          categories={categories.data ?? []}
          onClose={() => setCatModal(null)}
          onSaved={() => {
            setCatModal(null);
            categories.reload();
          }}
        />
      )}

      {importOpen && (
        <ImportModal
          orgId={org.id}
          storeId={store.id}
          storeName={store.name}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            categories.reload();
            suppliers.reload();
            list.reload();
          }}
        />
      )}

      {bulk === 'delete' && (
        <Confirm
          title="Удалить товары"
          text={`Выбрано товаров: ${selected.size}. Они исчезнут из списка и с кассы, история продаж сохранится.`}
          confirmLabel="Удалить"
          danger
          busy={busy}
          onConfirm={applyBulk}
          onClose={() => setBulk(null)}
        />
      )}
      {bulk && bulk !== 'delete' && (
        <Modal
          title={bulk === 'category' ? 'Изменить категорию' : bulk === 'supplier' ? 'Изменить поставщика' : 'Добавить в быстрые товары'}
          onClose={() => setBulk(null)}
          width={420}
          footer={
            <>
              <button className="btn" onClick={() => setBulk(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={applyBulk}>Применить к {selected.size}</button>
            </>
          }
        >
          <label className="field">
            <span>{bulk === 'category' ? 'Категория' : bulk === 'supplier' ? 'Поставщик' : 'Группа быстрых товаров'}</span>
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} autoFocus>
              <option value="">{bulk === 'quick' ? 'Выберите группу' : '— нет —'}</option>
              {bulk === 'category' && tree.map(({ cat, depth }) => <option key={cat.id} value={cat.id}>{depth ? '— ' : ''}{cat.name}</option>)}
              {bulk === 'supplier' && (suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {bulk === 'quick' && (quickGroups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          {bulk === 'quick' && !(quickGroups.data ?? []).length && (
            <p className="hint" style={{ marginTop: 8 }}>Групп пока нет: создайте их в разделе «Быстрые товары».</p>
          )}
        </Modal>
      )}
    </>
  );
}
