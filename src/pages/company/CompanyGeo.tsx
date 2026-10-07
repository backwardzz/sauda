import { Fragment, useMemo, useState } from 'react';
import { useCities } from '../../lib/cities';
import { useCompanyCatalog } from '../../lib/companyCatalog';
import { moneyShort, plural, qty as fmtQty } from '../../lib/format';
import { byProduct, byRegion, matrix, type Area, type GeoData, type GeoTotal } from '../../lib/geo';
import { useQuery } from '../../lib/hooks';
import { KZ_SHAPES, KZ_VIEWBOX } from '../../lib/kzMap';
import { useCompany } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { Icon } from '../../ui/Icon';
import { lastDays, PeriodPicker, periodRange } from '../../ui/Period';

type Metric = 'sum' | 'qty';

const storesWord =(n: number) => plural(n, 'магазин', 'магазина', 'магазинов');

/** Где заказывают товары компании: области и города, товары на выбранной территории и таблица «товар × область». */
export function CompanyGeo() {
  const { org } = useCompany();
  const cities = useCities();
  const catalog = useCompanyCatalog(org.id);
  const [period, setPeriod] = useState(lastDays(90));
  const [metric, setMetric] = useState<Metric>('sum');
  const [category, setCategory] = useState('');
  const [area, setArea] = useState<Area>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [showMissing, setShowMissing] = useState(false);
  const [bottom, setBottom] = useState<'table' | 'map'>('table');

  const range = periodRange(period);
  const geo = useQuery(
    () => q<GeoData>(db.rpc('company_geo', { p_org: org.id, p_from: range.from, p_to: range.to })),
    [org.id, range.from, range.to],
  );

  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data]);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [products]);
  const shown = useMemo(() => products.filter((p) => !category || p.category === category), [products, category]);
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Товар не из каталога';

  const view = useMemo(() => {
    const data = geo.data ?? { sales: [], market: [] };
    const ids = new Set(shown.map((p) => p.id));
    // выбран товар — география только по нему; иначе по всем товарам выбранной категории
    const regions = byRegion(data, cities, product ? new Set([product]) : category ? ids : null);
    const perProduct = byProduct(data, cities, area);
    const all = byRegion(data, cities, category ? ids : null);
    return { regions, perProduct, all, cells: matrix(data, cities) };
  }, [geo.data, cities, shown, category, product, area]);

  const value = (t: { sum: number; qty: number }) => (metric === 'sum' ? t.sum : t.qty);
  const show = (n: number) => (metric === 'sum' ? moneyShort(n) : fmtQty(n));
  const unit = metric === 'sum' ? org.currency : '';

  const total = view.all.reduce((s, r) => ({ sum: s.sum + r.sum, qty: s.qty + r.qty }), { sum: 0, qty: 0 });
  const allCities = view.all.flatMap((r) => r.cities).filter((c) => c.id >= 0);
  const storesTotal = view.all.reduce((s, r) => s + r.stores, 0);
  const buyersTotal = new Set((geo.data?.sales ?? []).filter((s) => !category || shown.some((p) => p.id === s.product_id)).map((s) => s.store_org)).size;

  const regionMax = Math.max(1, ...view.regions.map(value));
  const areaName = !area ? 'вся площадка'
    : area.kind === 'region' ? view.all.find((r) => r.id === area.id)?.name ?? ''
      : allCities.find((c) => c.id === area.id)?.name ?? 'Город не указан';

  const productRows = shown
    .map((p) => ({ p, t: view.perProduct.get(p.id) }))
    .filter((r): r is { p: typeof r.p; t: GeoTotal } => !!r.t)
    .sort((a, b) => value(b.t) - value(a.t));
  const missing = shown.filter((p) => !view.perProduct.has(p.id));
  const productMax = Math.max(1, ...productRows.map((r) => value(r.t)));

  // столбцы таблицы — области, где есть магазины площадки или заказы
  const columns = [...view.all].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
  const matrixRows = shown
    .map((p) => ({ p, sum: columns.reduce((s, r) => s + value(view.cells.get(`${p.id}:${r.id}`) ?? { sum: 0, qty: 0 }), 0) }))
    .sort((a, b) => b.sum - a.sum || a.p.name.localeCompare(b.p.name, 'ru'));
  const cellMax = Math.max(1, ...matrixRows.flatMap(({ p }) => columns.map((r) => value(view.cells.get(`${p.id}:${r.id}`) ?? { sum: 0, qty: 0 }))));

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const pickArea = (a: NonNullable<Area>) => setArea(area?.kind === a.kind && area.id === a.id ? null : a);
  const isArea = (kind: 'region' | 'city', id: number) => area?.kind === kind && area.id === id;
  const loading = geo.loading && !geo.data;
  const empty = !loading && total.sum === 0;

  return (
    <>
      <div className="page-head">
        <h1>Аналитика</h1>
        <span className="muted">Где заказывают ваши товары, а где есть магазины, но заказов нет</span>
      </div>

      <div className="toolbar">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="segmented">
          <button className={metric === 'sum' ? 'active' : ''} onClick={() => setMetric('sum')}>Сумма</button>
          <button className={metric === 'qty' ? 'active' : ''} onClick={() => setMetric('qty')}>Количество</button>
        </div>
        {categories.length > 0 && (
          <select value={category} onChange={(e) => { setCategory(e.target.value); setProduct(null); }} aria-label="Категория">
            <option value="">Все категории</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {(area || product) && (
          <button className="btn" onClick={() => { setArea(null); setProduct(null); }}><Icon name="x" size={15} />Сбросить выбор</button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Заказано за период</div>
          <div className="stat-value">{show(value(total))}{unit && <span className="stat-unit">{unit}</span>}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Города с заказами</div>
          <div className="stat-value">{allCities.filter((c) => c.sum > 0).length}<span className="stat-unit">из {allCities.length}</span></div>
          <div className="stat-hint">где на площадке есть магазины</div>
        </div>
        <div className="stat">
          <div className="stat-label">Магазины с заказами</div>
          <div className="stat-value">{buyersTotal}<span className="stat-unit">из {Math.max(storesTotal, buyersTotal)}</span></div>
          <div className="stat-hint">на всей площадке</div>
        </div>
        <div className="stat">
          <div className="stat-label">Товары с заказами</div>
          <div className="stat-value">{shown.filter((p) => byProductAny(view.cells, p.id, columns.map((c) => c.id))).length}<span className="stat-unit">из {shown.length}</span></div>
          <div className="stat-hint">{category || 'во всём каталоге'}</div>
        </div>
      </div>

      {empty && (
        <div className="card banner">
          <Icon name="alert" />
          <span className="grow">За выбранный период заказов не было. Ниже — города, где на площадке уже есть магазины: это ваш возможный рынок.</span>
        </div>
      )}

      <div className="dash-row geo-row">
        <div className="card">
          <div className="card-head">
            <h2>География</h2>
            <span className="muted">{product ? productName(product) : category || 'все товары'}</span>
          </div>
          {view.regions.length === 0 && <div className="empty">{loading ? 'Загрузка…' : 'На площадке пока нет магазинов с указанным городом'}</div>}
          {view.regions.map((r) => (
            <Fragment key={r.id}>
              <GeoRow
                name={shortRegion(r.name)} total={r} max={regionMax} metric={metric} show={show}
                active={isArea('region', r.id)} onPick={() => pickArea({ kind: 'region', id: r.id })}
                expanded={open.has(r.id)} onToggle={r.cities.length > 1 || r.cities[0]?.name !== r.name ? () => toggle(r.id) : undefined}
              />
              {open.has(r.id) && r.cities.map((c) => (
                <GeoRow
                  key={c.id} name={c.name} total={c} max={regionMax} metric={metric} show={show} nested
                  active={isArea('city', c.id)} onPick={() => pickArea({ kind: 'city', id: c.id })}
                />
              ))}
            </Fragment>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Товары</h2>
            <span className="muted">{areaName}</span>
          </div>
          {productRows.length === 0 && <div className="empty">{loading || (catalog.loading && !catalog.data) ? 'Загрузка…' : 'Здесь ваши товары ещё не заказывали'}</div>}
          {productRows.map(({ p, t }) => (
            <button key={p.id} className={`geo-line ${product === p.id ? 'active' : ''}`} onClick={() => setProduct(product === p.id ? null : p.id)}
              title={`${p.name}: ${show(value(t))} ${unit} · заказывали ${t.buyers} ${storesWord(t.buyers)}`}>
              <span className="geo-name">{p.name}</span>
              <span className="geo-bar"><i style={{ width: `${Math.max(2, (value(t) / productMax) * 100)}%` }} /></span>
              <b className="num geo-value">{show(value(t))}</b>
              <span className="muted geo-note">{t.buyers} {storesWord(t.buyers)}</span>
            </button>
          ))}
          {missing.length > 0 && (
            <>
              <button className="geo-more" onClick={() => setShowMissing((v) => !v)}>
                <Icon name={showMissing ? 'up' : 'down'} size={14} />
                Не заказывают здесь: {missing.length} {plural(missing.length, 'товар', 'товара', 'товаров')}
              </button>
              {showMissing && missing.map((p) => (
                <button key={p.id} className={`geo-line ${product === p.id ? 'active' : ''}`} onClick={() => setProduct(product === p.id ? null : p.id)}>
                  <span className="geo-name">{p.name}</span>
                  <span className="badge">нет заказов</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="card geo-matrix-card">
        <div className="card-head">
          <h2>Товары по областям</h2>
          <span className="muted">{metric === 'sum' ? `сумма заказов, ${org.currency}` : 'количество'} · чем насыщеннее цвет, тем больше</span>
          <span className="spacer" />
          <span className="muted geo-legend"><i className="geo-dot" />магазины есть, заказов нет</span>
          <div className="segmented">
            <button className={bottom === 'table' ? 'active' : ''} onClick={() => setBottom('table')}>Таблица</button>
            <button className={bottom === 'map' ? 'active' : ''} onClick={() => setBottom('map')}>Карта</button>
          </div>
        </div>
        {bottom === 'map' ? (
          <div className="geo-map-box">
            <div className="muted geo-map-title">{product ? productName(product) : category || 'Все товары'}</div>
            <svg className="geo-map" viewBox={KZ_VIEWBOX} role="group" aria-label="Карта Казахстана по областям">
              {/* два прохода: сначала все контуры, потом все подписи — иначе соседняя область закрывает чужую подпись */}
              {[false, true].flatMap((labels) => KZ_SHAPES.map((s) => {
                const r = view.regions.find((x) => x.name === s.name);
                const v = r ? value(r) : 0;
                const share = v / regionMax;
                const tip = `${s.name}: ${!r ? 'магазинов на площадке нет' : v > 0 ? `${show(v)} ${unit} · заказывают ${r.buyers} из ${r.stores} ${storesWord(r.stores)}` : `заказов нет, магазинов на площадке — ${r.stores}`}`;
                const fill = v > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(14 + share * 76)}%, var(--surface))` : undefined;
                const cls = `geo-shape ${r ? '' : 'off'} ${share > 0.55 ? 'dark' : ''} ${r && isArea('region', r.id) ? 'active' : ''} ${s.city ? 'city' : ''}`;
                if (!labels) {
                  return (
                    <g key={s.name} className={cls} onClick={() => r && pickArea({ kind: 'region', id: r.id })}>
                      <title>{tip}</title>
                      {/* города республиканского значения на карте слишком малы: рисуются кружком поверх области */}
                      {s.city ? <circle cx={s.x} cy={s.y} r={11} style={{ fill }} /> : <path d={s.d} style={{ fill }} />}
                    </g>
                  );
                }
                const tx = s.city ? s.x + 15 : s.x;
                const anchor = s.city ? 'start' : 'middle';
                return (
                  <g key={`${s.name}-label`} className={cls}>
                    <text x={tx} y={s.city ? s.y - 2 : s.y - (v > 0 ? 5 : 0)} textAnchor={anchor} className="geo-shape-name">{shortRegion(s.name)}</text>
                    {v > 0 && <text x={tx} y={s.y + 11} textAnchor={anchor} className="geo-shape-value">{show(v)}</text>}
                    {r && v === 0 && <circle cx={s.x} cy={s.city ? s.y : s.y + 10} r={3.5} className="geo-shape-dot" />}
                  </g>
                );
              }))}
            </svg>
            <div className="muted geo-map-note">Бледные серые области — на площадке там пока нет магазинов. Границы областей: simplemaps.com</div>
          </div>
        ) : columns.length === 0 || matrixRows.length === 0 ? (
          <div className="empty">{loading ? 'Загрузка…' : 'Пока нечего показать'}</div>
        ) : (
          <div className="geo-matrix-wrap">
            <table className="geo-matrix">
              <thead>
                <tr>
                  <th>Товар</th>
                  {columns.map((r) => (
                    <th key={r.id} className={isArea('region', r.id) ? 'active' : ''} title={`${r.name}: магазинов на площадке — ${r.stores}`}>
                      <button onClick={() => pickArea({ kind: 'region', id: r.id })}>{shortRegion(r.name)}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixRows.map(({ p }) => (
                  <tr key={p.id} className={product === p.id ? 'active' : ''}>
                    <th><button onClick={() => setProduct(product === p.id ? null : p.id)}>{p.name}</button></th>
                    {columns.map((r) => {
                      const c = view.cells.get(`${p.id}:${r.id}`);
                      const v = c ? value(c) : 0;
                      const share = v / cellMax;
                      return (
                        <td key={r.id}
                          className={share > 0.55 ? 'dark' : ''}
                          style={v > 0 ? { background: `color-mix(in srgb, var(--accent) ${Math.round(12 + share * 78)}%, var(--surface))` } : undefined}
                          title={`${p.name} · ${r.name}: ${v > 0 ? `${show(v)} ${unit}` : r.stores > 0 ? `заказов нет, магазинов на площадке — ${r.stores}` : 'магазинов нет'}`}
                          onClick={() => { setProduct(p.id); setArea({ kind: 'region', id: r.id }); }}>
                          {v > 0 ? show(v) : r.stores > 0 ? <i className="geo-dot" /> : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** Есть ли у товара заказы хотя бы в одной области. */
function byProductAny(cells: Map<string, { sum: number }>, productId: string, regionIds: number[]): boolean {
  return regionIds.some((r) => (cells.get(`${productId}:${r}`)?.sum ?? 0) > 0);
}

/** «Алматинская область» → «Алматинская»: в шапке таблицы слово «область» только занимает место. */
const shortRegion = (name: string) => name.replace(/\s+область$/, '');

function GeoRow({ name, total, max, metric, show, active, onPick, expanded, onToggle, nested }: {
  name: string; total: GeoTotal; max: number; metric: Metric; show: (n: number) => string;
  active: boolean; onPick: () => void; expanded?: boolean; onToggle?: () => void; nested?: boolean;
}) {
  const v = metric === 'sum' ? total.sum : total.qty;
  return (
    <div className={`geo-line ${active ? 'active' : ''} ${nested ? 'nested' : ''}`}>
      {!nested && (
        <button className="icon-btn small geo-toggle" onClick={onToggle} disabled={!onToggle} aria-label={expanded ? `Свернуть: ${name}` : `Показать города: ${name}`}>
          {onToggle && <Icon name={expanded ? 'up' : 'down'} size={14} />}
        </button>
      )}
      <button className="geo-pick" onClick={onPick} title={`${name}: заказывают ${total.buyers} из ${total.stores} ${storesWord(total.stores)} площадки`}>
        <span className="geo-name">{name}</span>
        {v > 0
          ? <span className="geo-bar"><i style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></span>
          : <span className="geo-bar none"><span className="badge warn">нет заказов</span></span>}
        <b className="num geo-value">{v > 0 ? show(v) : ''}</b>
        <span className="muted geo-note">{total.buyers} из {total.stores} {storesWord(total.stores)}</span>
      </button>
    </div>
  );
}
