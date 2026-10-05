import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STOCK_BADGE, useCompanyCatalog, variantState, type StockState } from '../../lib/companyCatalog';
import { money, moneyShort, qty as fmtQty, round2 } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { CompanyProduct, Variant } from '../../lib/types';
import { fullName } from '../../lib/variants';
import { exportXlsx } from '../../lib/xlsx';
import { Icon } from '../../ui/Icon';
import { NumCell } from '../../ui/NumCell';
import { ProductImage } from '../../ui/ProductImage';
import { toast } from '../../ui/toast';

type Filter = 'all' | StockState;

const FILTERS: [Filter, string][] = [['all', 'Все'], ['low', 'Заканчиваются'], ['out', 'Нет в наличии'], ['untracked', 'Без учёта']];

/** Склад компании: остатки всех видов по филиалам, правятся прямо в таблице. */
export function CompanyStock() {
  const { org, canManage, branches } = useCompany();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const data = useCompanyCatalog(org.id);
  const stats = data.data?.stats ?? new Map();
  const stock = data.data?.stock ?? new Map<string, Record<string, number>>();

  const rows = useMemo(() => {
    const out: { product: CompanyProduct; v: Variant; state: StockState; total: number; reserved: number }[] = [];
    for (const p of data.data?.products ?? []) {
      for (const v of data.data?.variants.get(p.id) ?? []) {
        const s = stats.get(v.id);
        out.push({ product: p, v, state: variantState(v, s), total: Number(s?.stock ?? 0), reserved: Number(s?.reserved ?? 0) });
      }
    }
    return out;
  }, [data.data, stats]);

  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (filter === 'all' || r.state === filter) &&
    (!term || fullName(r.product.name, r.v.label).toLowerCase().includes(term) || r.v.barcode.includes(term) || r.product.category.toLowerCase().includes(term)));
  const count = (f: Filter) => rows.filter((r) => r.state === f).length;
  const tracked = rows.filter((r) => r.v.track_stock);
  const worth = round2(tracked.reduce((s, r) => s + r.total * Number(r.v.price), 0));

  const setStock = async (v: Variant, branchId: string, n: number) => {
    await q(db.rpc('set_company_stock', { p_variant: v.id, p_branch: branchId, p_qty: n }));
    data.reload();
  };

  const download = () => {
    if (!rows.length) return toast.error('В каталоге пока нет товаров');
    exportXlsx(`Остатки ${org.name}`, 'Остатки', rows.map((r) => ({
      'Товар': r.product.name, 'Вид': r.v.label, 'Штрихкод': r.v.barcode, 'Категория': r.product.category,
      ...Object.fromEntries(branches.map((b) => [b.name, r.v.track_stock ? stock.get(r.v.id)?.[b.id] ?? 0 : ''])),
      'Всего': r.v.track_stock ? r.total : '', 'В заказах': r.reserved, 'Свободно': r.v.track_stock ? r.total - r.reserved : '', 'Цена': Number(r.v.price),
    }))).catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>Склад</h1>
        <span className="muted">Остатки по филиалам. Отгрузка заказа списывает товар сама.</span>
      </div>
      <div className="stat-grid">
        <div className="stat"><div className="stat-label">Видов с учётом остатка</div><div className="stat-value">{tracked.length}<span className="stat-unit">из {rows.length}</span></div></div>
        <div className="stat"><div className="stat-label">На складе по ценам продажи</div><div className="stat-value">{moneyShort(worth)}<span className="stat-unit">{org.currency}</span></div></div>
        <button className={`stat stat-btn ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}>
          <div className="stat-label">Заканчиваются</div><div className="stat-value">{count('low')}</div>
        </button>
        <button className={`stat stat-btn ${filter === 'out' ? 'active' : ''}`} onClick={() => setFilter(filter === 'out' ? 'all' : 'out')}>
          <div className="stat-label">Нет в наличии</div><div className="stat-value">{count('out')}</div>
        </button>
      </div>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Товар, вид или штрихкод" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="segmented">
          {FILTERS.map(([f, label]) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{label}</button>)}
        </div>
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      <div className="table-wrap">
        <table className="table variant-table">
          <thead>
            <tr>
              <th>Товар и вид</th>
              <th>Штрихкод</th>
              <th className="right">Цена, {org.currency}</th>
              {branches.map((b) => <th key={b.id} className="right">{b.name}</th>)}
              {branches.length > 1 && <th className="right">Всего</th>}
              <th className="right" title="Заказано магазинами и ещё не отгружено">В заказах</th>
              <th className="right">Свободно</th>
              <th>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {data.error ? (
              <tr><td colSpan={7 + branches.length} className="table-note error-text">{data.error}</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={7 + branches.length} className="table-note">{data.loading && !data.data ? 'Загрузка…' : rows.length ? 'Ничего не найдено' : 'В каталоге пока нет товаров'}</td></tr>
            ) : shown.map(({ product: p, v, state, total, reserved }) => (
              <tr key={v.id} className={!v.active ? 'row-off' : state === 'out' ? 'row-neg' : state === 'low' ? 'row-low' : ''}>
                <td>
                  <div className="row clickable" onClick={() => navigate(`/catalog/${p.id}`)}>
                    <ProductImage src={v.image_url || p.image_url} alt="" className="small" />
                    <div>
                      <a>{p.name}</a>{v.label && <b> · {v.label}</b>}
                      <div className="muted" style={{ fontSize: 12.5 }}>{p.category}{!v.active && ' · снят с продажи'}</div>
                    </div>
                  </div>
                </td>
                <td className="num">{v.barcode}</td>
                <td className="right">{money(v.price)}</td>
                {branches.map((b) => (
                  <td key={b.id} className="right">
                    {canManage
                      ? <NumCell value={v.track_stock ? stock.get(v.id)?.[b.id] ?? 0 : null} placeholder="∞" onSave={(n) => setStock(v, b.id, n)} aria-label={`Остаток, ${b.name}: ${fullName(p.name, v.label)}`} />
                      : v.track_stock ? fmtQty(stock.get(v.id)?.[b.id] ?? 0) : '∞'}
                  </td>
                ))}
                {branches.length > 1 && <td className="right">{v.track_stock ? fmtQty(total) : ''}</td>}
                <td className="right">{reserved ? fmtQty(reserved) : ''}</td>
                <td className="right">{v.track_stock ? <b>{fmtQty(total - reserved)}</b> : ''}</td>
                <td><span className={`badge ${STOCK_BADGE[state].badge}`}>{STOCK_BADGE[state].label}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Введите остаток и нажмите Enter — с первой цифры для вида включается учёт. Порог «заканчивается» задаётся в карточке товара.
      </p>
    </>
  );
}
