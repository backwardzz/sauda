import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STOCK_BADGE, totals, useCompanyCatalog, variantState } from '../../lib/companyCatalog';
import { dateOnly, dateTime, money, moneyShort, plural, qty as fmtQty, round2, toDateInput } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useCompany } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { STOCK_REASON, type StockMoveRow, type Variant } from '../../lib/types';
import { fullName } from '../../lib/variants';
import { ColumnChart } from '../../ui/ColumnChart';
import { Icon } from '../../ui/Icon';
import { Confirm } from '../../ui/Modal';
import { NumCell } from '../../ui/NumCell';
import { ProductImage } from '../../ui/ProductImage';
import { toast } from '../../ui/toast';
import { ProductEditor } from './ProductEditor';

interface SaleLine {
  variant_id: string;
  qty: number;
  qty_shipped: number | null;
  price: number;
  orders: { id: string; number: number; status: string; shipped_at: string | null; store_org: string; store_org_name: string };
}

const DAYS = 30;

/** Карточка товара компании: виды с ценами и остатками, продажи, покупатели и движение склада. */
export function CompanyProduct() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { org, canManage, branches } = useCompany();
  const [mode, setMode] = useState<'edit' | 'copy' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useCompanyCatalog(org.id);
  const product = data.data?.products.find((p) => p.id === id);
  const variants = useMemo(() => data.data?.variants.get(id) ?? [], [data.data, id]);
  const stats = data.data?.stats ?? new Map();
  const stock = data.data?.stock ?? new Map<string, Record<string, number>>();
  const ids = variants.map((v) => v.id);

  const history = useQuery(async () => {
    if (!ids.length) return { lines: [] as SaleLine[], moves: [] as StockMoveRow[] };
    const [lines, moves] = await Promise.all([
      q<SaleLine[]>(db.from('order_items')
        .select('variant_id, qty, qty_shipped, price, orders!inner(id, number, status, shipped_at, store_org, store_org_name)')
        .in('variant_id', ids).limit(5000) as never),
      q<StockMoveRow[]>(db.from('company_stock_moves').select('*').in('variant_id', ids).order('created_at', { ascending: false }).limit(40)),
    ]);
    return { lines, moves };
  }, [ids.join(','), data.data]);

  const sold = useMemo(() => (history.data?.lines ?? []).filter((l) => ['shipped', 'received'].includes(l.orders.status)), [history.data]);
  const sum = totals(variants, stats);
  const shipped = (l: SaleLine) => Number(l.qty_shipped ?? l.qty);

  const chart = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const l of sold) {
      if (!l.orders.shipped_at) continue;
      const day = toDateInput(new Date(l.orders.shipped_at));
      byDay.set(day, round2((byDay.get(day) ?? 0) + shipped(l) * Number(l.price)));
    }
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (DAYS - 1 - i));
      return { label: dateOnly(d).slice(0, 5), title: dateOnly(d), value: byDay.get(toDateInput(d)) ?? 0 };
    });
  }, [sold]);

  const buyers = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; sum: number; orders: Set<string> }>();
    for (const l of sold) {
      const b = map.get(l.orders.store_org) ?? { name: l.orders.store_org_name, qty: 0, sum: 0, orders: new Set<string>() };
      b.qty += shipped(l);
      b.sum = round2(b.sum + shipped(l) * Number(l.price));
      b.orders.add(l.orders.id);
      map.set(l.orders.store_org, b);
    }
    return [...map.values()].sort((a, b) => b.sum - a.sum);
  }, [sold]);
  const orderCount = new Set(sold.map((l) => l.orders.id)).size;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    await fn();
    if (ok) toast.ok(ok);
    data.reload();
  };
  const patch = (v: Variant, fields: Partial<Pick<Variant, 'price' | 'active'>>, ok?: string) =>
    act(() => q(db.from('company_variants').update(fields).eq('id', v.id)), ok);
  const setStock = (v: Variant, branchId: string, n: number) =>
    act(() => q(db.rpc('set_company_stock', { p_variant: v.id, p_branch: branchId, p_qty: n })));

  const remove = async () => {
    setBusy(true);
    try {
      await q(db.rpc('archive_company_product', { p_product: id }));
      toast.ok('Товар убран из каталога');
      navigate('/catalog');
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  if (data.loading && !data.data) return <div className="empty">Загрузка…</div>;
  if (!product) return <div className="empty">Товар не найден. <Link to="/catalog">К каталогу</Link></div>;

  const branchName = (bid: string) => branches.find((b) => b.id === bid)?.name ?? 'Филиал';
  const variantLabel = (vid: string) => variants.find((v) => v.id === vid)?.label || '—';
  const categories = [...new Set((data.data?.products ?? []).map((p) => p.category).filter(Boolean))];

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/catalog')} aria-label="К каталогу"><Icon name="back" /></button>
        <h1>{product.name}</h1>
        {product.category && <span className="badge">{product.category}</span>}
        <span className={`badge ${STOCK_BADGE[sum.state].badge}`}>{STOCK_BADGE[sum.state].label}</span>
        <span className="spacer" />
        {canManage && (
          <>
            <button className="btn primary" onClick={() => setMode('edit')}><Icon name="edit" size={16} />Редактировать</button>
            <button className="btn" onClick={() => setMode('copy')} title="Новый товар с теми же видами и ценами"><Icon name="copy" size={16} />Дублировать</button>
            <button className="btn danger" onClick={() => setMode('remove')}><Icon name="trash" size={16} />Убрать</button>
          </>
        )}
      </div>

      <div className="product-top">
        <div className="card pad product-about">
          <ProductImage src={product.image_url || variants.find((v) => v.image_url)?.image_url || ''} alt={product.name} />
          <p className={product.description ? '' : 'muted'}>{product.description || 'Описания пока нет. Добавьте состав, срок годности или условия хранения — магазины видят описание в каталоге.'}</p>
          <span className="muted">В каталоге с {dateOnly(product.created_at)}</span>
        </div>
        <div className="stat-grid tight">
          <Stat label="На складе" value={sum.stock == null ? '—' : fmtQty(sum.stock)} hint={sum.stock == null ? 'остаток не учитывается' : `по ${branches.length} ${plural(branches.length, 'филиалу', 'филиалам', 'филиалам')}`} />
          <Stat label="В заказах" value={fmtQty(sum.reserved)} hint="заказано и ещё не отгружено" />
          <Stat label="Свободно" value={sum.free == null ? '—' : fmtQty(sum.free)} hint="можно заказать прямо сейчас" tone={sum.state === 'out' ? 'danger' : sum.state === 'low' ? 'warn' : undefined} />
          <Stat label="Продано всего" value={fmtQty(sum.sold)} hint={sum.lastSold ? `последняя отгрузка ${dateOnly(sum.lastSold)}` : 'отгрузок ещё не было'} />
          <Stat label={`За ${DAYS} дней`} value={fmtQty(sum.sold30)} hint="отгружено магазинам" />
          <Stat label="Выручка" value={moneyShort(sum.soldSum)} unit={org.currency} hint={`${orderCount} ${plural(orderCount, 'заказ', 'заказа', 'заказов')} · ${buyers.length} ${plural(buyers.length, 'магазин', 'магазина', 'магазинов')}`} />
        </div>
      </div>

      <div className="section-title">Виды товара</div>
      <div className="table-wrap">
        <table className="table variant-table">
          <thead>
            <tr>
              <th>Вид</th>
              <th>Штрихкод</th>
              <th className="right">Упаковка</th>
              <th className="right">Цена, {org.currency}</th>
              {branches.map((b) => <th key={b.id} className="right" title={`Остаток на складе: ${b.name}`}>{branches.length > 1 ? b.name : 'На складе'}</th>)}
              <th className="right" title="Заказано магазинами и ещё не отгружено">В заказах</th>
              <th className="right">Свободно</th>
              <th className="right">Продано</th>
              <th className="right">Выручка, {org.currency}</th>
              <th className="center">В продаже</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const s = stats.get(v.id);
              const state = variantState(v, s);
              const free = Number(s?.stock ?? 0) - Number(s?.reserved ?? 0);
              return (
                <tr key={v.id} className={!v.active ? 'row-off' : state === 'out' ? 'row-neg' : state === 'low' ? 'row-low' : ''}>
                  <td><b>{v.label || fullName(product.name, '')}</b></td>
                  <td className="num">{v.barcode}</td>
                  <td className="right">{Number(v.pack_qty) !== 1 ? `по ${fmtQty(v.pack_qty)} ${v.unit}` : v.unit}</td>
                  <td className="right">
                    {canManage ? <NumCell value={Number(v.price)} onSave={(n) => patch(v, { price: n })} aria-label={`Цена: ${fullName(product.name, v.label)}`} /> : money(v.price)}
                  </td>
                  {branches.map((b) => (
                    <td key={b.id} className="right">
                      {canManage
                        ? <NumCell value={v.track_stock ? stock.get(v.id)?.[b.id] ?? 0 : null} placeholder="∞" onSave={(n) => setStock(v, b.id, n)} aria-label={`Остаток, ${b.name}: ${fullName(product.name, v.label)}`} />
                        : v.track_stock ? fmtQty(stock.get(v.id)?.[b.id] ?? 0) : '∞'}
                    </td>
                  ))}
                  <td className="right">{Number(s?.reserved) ? fmtQty(s?.reserved) : ''}</td>
                  <td className="right">{v.track_stock ? <b>{fmtQty(free)}</b> : <span className="muted">без учёта</span>}</td>
                  <td className="right">{fmtQty(s?.sold_qty)}</td>
                  <td className="right">{money(s?.sold_sum)}</td>
                  <td className="center">
                    <input type="checkbox" checked={v.active} disabled={!canManage} aria-label={`В продаже: ${fullName(product.name, v.label)}`}
                      onChange={(e) => patch(v, { active: e.target.checked }, e.target.checked ? 'Вид снова в продаже' : 'Вид снят с продажи: магазины его не видят').catch(toast.error)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canManage && <p className="hint" style={{ marginTop: 8 }}>Цена и остаток правятся прямо в таблице: введите число и нажмите Enter. Пустой остаток «∞» — без учёта: вид всегда в наличии.</p>}

      <div className="dash-row" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Отгрузки по дням, {org.currency}</h2><span className="spacer" /><span className="muted">{DAYS} дней</span></div>
          {sold.length ? <ColumnChart points={chart} unit={org.currency} ariaLabel="Отгрузки товара по дням" /> : <div className="empty">Товар ещё не отгружали</div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Кто покупает</h2></div>
          {buyers.length === 0 && <div className="empty">{history.loading ? 'Загрузка…' : 'Покупателей пока нет'}</div>}
          {buyers.slice(0, 8).map((b) => (
            <div className="list-row" key={b.name}>
              <span className="grow">{b.name}</span>
              <span className="muted">{b.orders.size} {plural(b.orders.size, 'заказ', 'заказа', 'заказов')} · {fmtQty(b.qty)} шт</span>
              <b className="num" style={{ minWidth: 90, textAlign: 'right' }}>{money(b.sum)}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>Движение остатков</div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Дата</th><th>Вид</th><th>Филиал</th><th>Что произошло</th><th className="right">Изменение</th><th className="right">Остаток после</th></tr>
          </thead>
          <tbody>
            {(history.data?.moves ?? []).length === 0 ? (
              <tr><td colSpan={6} className="table-note">{history.loading ? 'Загрузка…' : 'Остатки ещё не менялись'}</td></tr>
            ) : history.data!.moves.map((m) => (
              <tr key={m.id}>
                <td>{dateTime(m.created_at)}</td>
                <td>{variantLabel(m.variant_id)}</td>
                <td>{branchName(m.branch_id)}</td>
                <td>{m.order_id ? <Link to={`/orders/${m.order_id}`}>{STOCK_REASON[m.reason]}</Link> : STOCK_REASON[m.reason]}{m.comment && <span className="muted"> · {m.comment}</span>}</td>
                <td className={`right ${Number(m.delta) < 0 ? 'error-text' : 'ok-text'}`}>{Number(m.delta) > 0 ? '+' : ''}{fmtQty(m.delta)}</td>
                <td className="right">{fmtQty(m.qty_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(mode === 'edit' || mode === 'copy') && (
        <ProductEditor product={product} variants={variants} stock={stock} duplicate={mode === 'copy'} categories={categories}
          onClose={() => setMode(null)} onSaved={(saved) => (saved === id ? data.reload() : navigate(`/catalog/${saved}`))} />
      )}
      {mode === 'remove' && (
        <Confirm title={`Убрать «${product.name}» из каталога`} danger busy={busy} confirmLabel="Убрать из каталога"
          text="Магазины перестанут видеть товар и все его виды. История заказов и продаж сохранится."
          onClose={() => setMode(null)} onConfirm={remove} />
      )}
    </>
  );
}

function Stat({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
