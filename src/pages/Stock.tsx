import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { money, qty } from '../lib/format';
import { useChanged, useDebounced, useQuery, useStored } from '../lib/hooks';
import { categoryTree, useCategories } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q, safeTerm } from '../lib/supabase';
import type { StockRow } from '../lib/types';
import { exportXlsx } from '../lib/xlsx';
import { DataTable, Pager, type Column, type Sort } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';

type Mode = 'in-stock' | 'all' | 'low' | 'negative';

const SORT_COLUMN: Record<string, string> = {
  name: 'name', qty: 'qty', purchase: 'purchase_price', sale: 'sale_price', purchaseSum: 'purchase_sum', saleSum: 'sale_sum',
};

interface Totals {
  positions: number;
  qty: number;
  purchase_sum: number;
  sale_sum: number;
}

export function Stock() {
  const { org, store } = useWorkspace();
  const categories = useCategories(org.id);
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const [mode, setMode] = useState<Mode>('in-stock');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'qty', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useStored('sauda:stock:pageSize', 50);

  if (useChanged([term, mode, category, store.id, pageSize]) && page !== 0) setPage(0);
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);

  const scoped = () => {
    let query = db.from('product_stock').select('*', { count: 'exact' }).eq('store_id', store.id).eq('archived', false);
    const s = safeTerm(term);
    if (s) query = query.or(`name.ilike.%${s}%,barcode.ilike.${s}%`);
    if (mode === 'in-stock') query = query.neq('qty', 0);
    if (mode === 'low') query = query.eq('low', true);
    if (mode === 'negative') query = query.lt('qty', 0);
    if (category) {
      const ids = [category, ...(categories.data ?? []).filter((c) => c.parent_id === category).map((c) => c.id)];
      query = query.in('category_id', ids);
    }
    return query.order(SORT_COLUMN[sort.key] ?? 'name', { ascending: sort.dir === 'asc' }).order('id');
  };

  const list = useQuery(async () => {
    const { data, count, error } = await scoped().range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as StockRow[], total: count ?? 0 };
  }, [store.id, term, mode, category, sort, page, pageSize, categories.data]);

  const totals = useQuery(
    async () => (await q<Totals[]>(db.rpc('stock_totals', { p_store: store.id })))[0],
    [store.id],
  );

  const columns: Column<StockRow>[] = [
    { key: 'name', title: 'Название товара', sortable: true, fixed: true, render: (r) => <Link to={`/products/${r.id}`}>{r.name}</Link> },
    { key: 'barcode', title: 'Штрихкод', render: (r) => <span className="num">{r.barcode}</span> },
    { key: 'sku', title: 'Артикул', optional: true, value: (r) => r.sku },
    {
      key: 'qty', title: 'Кол-во', align: 'right', sortable: true,
      render: (r) => (
        <>
          {qty(r.qty)} {r.unit}
          {r.low && r.qty >= 0 && <span className="badge warn" style={{ marginLeft: 8 }}>мало</span>}
        </>
      ),
    },
    { key: 'min', title: 'Крит. остаток', align: 'right', optional: true, render: (r) => (r.min_stock == null ? '' : qty(r.min_stock)) },
    { key: 'purchase', title: 'Закупочная цена', align: 'right', sortable: true, render: (r) => money(r.purchase_price) },
    { key: 'sale', title: 'Продажная цена', align: 'right', sortable: true, render: (r) => money(r.sale_price) },
    { key: 'purchaseSum', title: 'Сумма по закупочной', align: 'right', sortable: true, render: (r) => money(r.purchase_sum) },
    { key: 'saleSum', title: 'Сумма по продажной', align: 'right', sortable: true, render: (r) => money(r.sale_sum) },
  ];

  const download = async () => {
    try {
      const rows: StockRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await scoped().range(from, from + 999);
        if (error) throw error;
        rows.push(...((data ?? []) as StockRow[]));
        if (!data || data.length < 1000) break;
      }
      if (!rows.length) return toast.error('Нет данных для выгрузки');
      await exportXlsx(`Склад ${store.name}`, 'Склад', rows.map((r) => ({
        'Название товара': r.name, 'Штрихкод': r.barcode, 'Кол-во': r.qty, 'Ед. изм': r.unit,
        'Закупочная цена': r.purchase_price, 'Продажная цена': r.sale_price,
        'Сумма по закупочной': r.purchase_sum, 'Сумма по продажной': r.sale_sum,
      })));
    } catch (e) {
      toast.error(e);
    }
  };

  const t = totals.data;

  return (
    <>
      <div className="page-head">
        <h1>Склад</h1>
        <span className="muted">{store.name}</span>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Позиций с остатком</div>
          <div className="stat-value">{t ? qty(t.positions) : '…'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Сумма по закупочной</div>
          <div className="stat-value">{t ? money(t.purchase_sum) : '…'}<span className="stat-unit">{org.currency}</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">Сумма по продажной</div>
          <div className="stat-value">{t ? money(t.sale_sum) : '…'}<span className="stat-unit">{org.currency}</span></div>
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented">
          <button className={mode === 'in-stock' ? 'active' : ''} onClick={() => setMode('in-stock')}>С остатком</button>
          <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>Все, включая нулевые</button>
          <button className={mode === 'low' ? 'active' : ''} onClick={() => setMode('low')}>Критические</button>
          <button className={mode === 'negative' ? 'active' : ''} onClick={() => setMode('negative')}>Минусовые</button>
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
          <option value="">Все категории</option>
          {tree.map(({ cat, depth }) => <option key={cat.id} value={cat.id}>{depth ? '— ' : ''}{cat.name}</option>)}
        </select>
        <input className="search" type="search" placeholder="Поиск по названию товара / штрихкоду" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      <DataTable
        id="stock"
        columns={columns}
        rows={list.data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        empty={mode === 'in-stock' && !term ? 'На складе пусто. Оприходуйте товары, чтобы появились остатки.' : 'Ничего не найдено'}
        sort={sort}
        onSort={setSort}
        rowClass={(r) => (r.qty < 0 ? 'row-neg' : r.low ? 'row-low' : undefined)}
      />
      <Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}
