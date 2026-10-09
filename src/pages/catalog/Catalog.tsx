import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bestOffer, clampQty, loadOffers, useCarts } from '../../lib/cart';
import { money, parseNum, plural, qty as fmtQty } from '../../lib/format';
import { useChanged, useDebounced, useQuery, useStored } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { CatalogItem } from '../../lib/starter';
import type { Offer } from '../../lib/types';
import { Pager } from '../../ui/DataTable';
import { CompanyAvatar, VerifiedBadge } from '../../ui/CompanyAvatar';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

interface CategoryRow {
  category: string;
  subcategory: string;
  cnt: number;
}

type Row = CatalogItem & { company: string; offers: number; total: number };

interface BrandRow {
  /** пустая строка — товары без распознанного производителя («Другие») */
  company: string;
  cnt: number;
  mine: number;
  logo_url: string;
  verified: boolean;
}

/** Заглушка для аптек: справочника лекарств ещё нет. */
export function PharmacyStub({ title }: { title: string }) {
  return (
    <>
      <div className="page-head"><h1>{title}</h1><span className="badge warn">в разработке</span></div>
      <div className="card empty">
        <p><b>Справочник лекарственных средств готовится.</b></p>
        <p style={{ marginTop: 6 }}>
          Пока товары можно добавить вручную или загрузить из Excel в разделе <Link to="/products">«Список товаров»</Link>.
        </p>
      </div>
    </>
  );
}

/** Общий каталог: магазин находит товар, сразу видит цены компаний, заказывает и добавляет его в свой список. */
export function Catalog() {
  const { org } = useWorkspace();
  return org.business === 'pharmacy' ? <PharmacyStub title="Каталог товаров" /> : <CatalogList />;
}

function CatalogList() {
  const { org, store } = useWorkspace();
  const navigate = useNavigate();
  const cart = useCarts(store.id);
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  /** null — все товары, '' — без категории */
  const [category, setCategory] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  /** null — производитель не выбран: в категории показываются карточки производителей */
  const [brand, setBrand] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useStored('sauda:catalog:onlyNew', false);
  const [onlyOffers, setOnlyOffers] = useStored('sauda:catalog:onlyOffers', false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useStored('sauda:catalog:pageSize', 50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** штрихкод → выбранное предложение, если магазин предпочёл не самое дешёвое */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (useChanged([term, category, sub, brand, onlyNew, onlyOffers, pageSize]) && page !== 0) setPage(0);
  // при поиске и отборе «с ценами» ищем по всей категории, минуя карточки производителей
  const showBrands = category !== null && brand === null && !term && !onlyOffers;

  const cats = useQuery(() => q<CategoryRow[]>(db.rpc('catalog_categories', { p_org: org.id })), [org.id]);
  const brands = useQuery(
    // список нужен и внутри производителя: из него берутся аватарка и отметка для шапки
    async () => (category !== null ? q<BrandRow[]>(db.rpc('catalog_company_list', { p_org: org.id, p_category: category, p_subcategory: sub })) : []),
    [org.id, category, sub],
  );
  const list = useQuery(
    async () => (showBrands ? [] : q<Row[]>(db.rpc('catalog_search', {
      p_org: org.id, p_term: term, p_category: category, p_subcategory: sub, p_only_new: onlyNew,
      p_limit: pageSize, p_offset: page * pageSize, p_company: term ? null : brand, p_only_offers: onlyOffers,
    }))),
    [org.id, term, category, sub, brand, onlyNew, onlyOffers, page, pageSize, showBrands],
  );
  const rows = useMemo(() => list.data ?? [], [list.data]);
  // цены компаний на товары страницы: по штрихкоду
  const offers = useQuery(
    () => loadOffers(store.id, { barcodes: rows.filter((r) => Number(r.offers) > 0).map((r) => r.barcode) }),
    [store.id, rows],
  );
  const byBarcode = useMemo(() => {
    const map = new Map<string, Offer[]>();
    for (const o of offers.data ?? []) map.set(o.barcode, [...(map.get(o.barcode) ?? []), o]);
    return map;
  }, [offers.data]);

  const current = brand === null ? null
    : brands.data?.find((c) => c.company === brand) ?? { company: brand, cnt: 0, mine: 0, logo_url: '', verified: false };

  const tree = useMemo(() => {
    const roots = new Map<string, { total: number; subs: CategoryRow[] }>();
    for (const r of cats.data ?? []) {
      const root = roots.get(r.category) ?? { total: 0, subs: [] };
      root.total += Number(r.cnt);
      if (r.subcategory) root.subs.push(r);
      roots.set(r.category, root);
    }
    // товары без категории — в конце списка
    return [...roots].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru')));
  }, [cats.data]);
  const totalAll = tree.reduce((s, [, r]) => s + r.total, 0);

  const total = Number(rows[0]?.total ?? 0);
  const free = rows.filter((r) => !r.mine);
  const allPicked = free.length > 0 && free.every((r) => picked.has(r.id));
  const offerOf = (r: Row) => {
    const own = byBarcode.get(r.barcode) ?? [];
    return own.find((o) => o.variant_id === chosen[r.barcode]) ?? bestOffer(own);
  };

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const togglePage = () => {
    const next = new Set(picked);
    free.forEach((r) => (allPicked ? next.delete(r.id) : next.add(r.id)));
    setPicked(next);
  };

  const add = async (ids: string[]) => {
    setBusy(true);
    try {
      // закупочная цена берётся из выбранного предложения компании, если товар сейчас на странице
      const prices = rows.filter((r) => ids.includes(r.id)).flatMap((r) => {
        const o = offerOf(r);
        return o ? [{ id: r.id, purchase_price: Number(o.price) }] : [];
      });
      const res = await q<{ created: number; skipped: number }>(db.rpc('add_catalog_products', { p_org: org.id, p_ids: ids, p_prices: prices }));
      toast.ok(
        `Добавлено товаров: ${res.created}` + (res.skipped ? `, уже были: ${res.skipped}` : '') +
          (prices.length ? '. Закупочная цена взята у компании, розничную укажите в карточке товара.' : '. Цены укажите при приёмке или в карточке товара.'),
      );
      // отметки, поставленные пока шёл запрос, сохраняются
      setPicked((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const select = (c: string | null, s: string | null = null) => {
    setCategory(c);
    setSub(s);
    setBrand(null);
  };

  const bar = picked.size > 0 || cart.count > 0;

  return (
    <div className={bar ? 'with-cartbar' : ''}>
      <div className="page-head">
        <h1>Каталог товаров</h1>
        <span className="muted">{totalAll || '…'} товаров со штрихкодами. Где есть цена компании — заказывайте сразу, остальное добавляйте в свой список.</span>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Название или штрихкод"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <label className="check-row">
          <input type="checkbox" checked={onlyOffers} onChange={(e) => setOnlyOffers(e.target.checked)} />
          Только с ценами компаний
        </label>
        <label className="check-row">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Скрыть те, что у меня уже есть
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => navigate('/market')}><Icon name="building" size={16} />Компании</button>
        <button className="btn primary" onClick={() => navigate('/catalog/starter')}>
          <Icon name="bolt" size={16} />У меня новый магазин
        </button>
      </div>

      <div className="split">
        <div className="card side-list">
          <button className={category === null ? 'active' : ''} onClick={() => select(null)}>
            <span className="grow">Все товары</span><span className="side-count">{totalAll || ''}</span>
          </button>
          {tree.map(([name, root]) => (
            <div key={name}>
              <button className={category === name && sub === null ? 'active' : ''} onClick={() => select(name)}>
                <span className="grow">{name || 'Без категории'}</span>
                <span className="side-count">{root.total}</span>
              </button>
              {category === name && root.subs.map((s) => (
                <button key={s.subcategory} className={`side-sub ${sub === s.subcategory ? 'active' : ''}`} onClick={() => select(name, s.subcategory)}>
                  <span className="grow">{s.subcategory}</span>
                  <span className="side-count">{s.cnt}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {showBrands ? (
          brands.error ? <div className="card empty error-text">{brands.error}</div>
          : brands.loading && !brands.data?.length ? <div className="card empty">Загрузка…</div>
          : !brands.data?.length ? <div className="card empty">В этой категории пока нет товаров</div>
          : (
            <div className="company-grid">
              {brands.data.map((c) => (
                <button className="card company-card" key={c.company || '—'} onClick={() => setBrand(c.company)}>
                  <CompanyAvatar name={c.company} logo={c.logo_url} />
                  <span className="company-info">
                    <b>{c.company || 'Другие производители'}</b>
                    <span className="muted">
                      {c.cnt} {plural(Number(c.cnt), 'товар', 'товара', 'товаров')}{Number(c.mine) > 0 && ` · у вас ${c.mine}`}
                    </span>
                    {c.verified && <VerifiedBadge />}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
        <div>
          {current && !term && (
            <div className="company-head">
              <button className="icon-btn" onClick={() => setBrand(null)} aria-label="Ко всем производителям"><Icon name="back" /></button>
              <CompanyAvatar name={current.company} logo={current.logo_url} size={40} />
              <div className="grow">
                <h2>{current.company || 'Другие производители'}</h2>
                {current.verified && <VerifiedBadge />}
              </div>
              <span className="muted">{[category || 'Без категории', sub].filter(Boolean).join(' · ')}</span>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="cell-check">
                    <input type="checkbox" checked={allPicked} disabled={!free.length} onChange={togglePage} aria-label="Выбрать все на странице" />
                  </th>
                  <th>Название товара</th>
                  <th>Категория</th>
                  <th>Цена у компании</th>
                  <th className="center" style={{ width: 150 }}>Заказать</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {list.error ? (
                  <tr><td colSpan={6} className="table-note error-text">{list.error}</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-note">
                      {list.loading ? 'Загрузка…' : onlyOffers && !term && category === null ? 'Компании пока не выставили цены на товары каталога' : term || category !== null || onlyNew || onlyOffers ? 'Ничего не найдено' : 'Справочник пока пуст'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const own = byBarcode.get(r.barcode) ?? [];
                    const o = offerOf(r);
                    const n = o ? cart.qty(o.company_id, o.variant_id) : 0;
                    const pack = Number(o?.pack_qty ?? 1);
                    const out = !!o && o.free != null && Number(o.free) <= 0;
                    const set = (v: number) => o && cart.setQty(o.company_id, o.variant_id, clampQty(v, o));
                    return (
                      <tr key={r.id} className={picked.has(r.id) || n > 0 ? 'selected' : ''}>
                        <td className="cell-check">
                          <input type="checkbox" checked={r.mine || picked.has(r.id)} disabled={r.mine} onChange={() => toggle(r.id)} aria-label={`Выбрать: ${r.name}`} />
                        </td>
                        <td>
                          <div>{r.name}</div>
                          <div className="muted num" style={{ fontSize: 12.5 }}>{r.barcode} · {r.unit}</div>
                        </td>
                        <td className="muted">{[r.category, r.subcategory].filter(Boolean).join(' · ')}</td>
                        <td>
                          {!o ? (Number(r.offers) > 0 && offers.loading ? <span className="muted">…</span> : <span className="muted">нет предложений</span>) : (
                            <div className="offer-cell">
                              <b className="num">{money(o.price)} {org.currency}</b>
                              {own.length > 1 ? (
                                <select value={o.variant_id} onChange={(e) => setChosen({ ...chosen, [r.barcode]: e.target.value })} aria-label={`Компания: ${r.name}`}>
                                  {own.map((x) => <option key={x.variant_id} value={x.variant_id}>{x.company_name} — {money(x.price)}</option>)}
                                </select>
                              ) : <Link to={`/market/${o.company_id}`}>{o.company_name}</Link>}
                              <span className="muted">
                                {pack !== 1 && `по ${fmtQty(pack)} ${o.unit} · `}
                                {out ? <span className="error-text">нет в наличии</span> : o.free == null ? 'в наличии' : `в наличии ${fmtQty(o.free)}`}
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          {o && !out && (
                            <div className="qty-box">
                              <button onClick={() => set(n - pack)} disabled={n <= 0} aria-label={`Меньше: ${r.name}`}>−</button>
                              <input value={n || ''} placeholder="0" inputMode="decimal" aria-label={`Количество: ${r.name}`} onChange={(e) => set(parseNum(e.target.value))} />
                              <button onClick={() => set(n + pack)} disabled={o.free != null && n >= Number(o.free)} aria-label={`Больше: ${r.name}`}>+</button>
                            </div>
                          )}
                        </td>
                        <td className="right">
                          {r.mine ? (
                            <span className="badge ok"><Icon name="check" size={13} />уже у вас</span>
                          ) : (
                            <button className="btn small" disabled={busy} onClick={() => add([r.id])} title="Добавить в свой список товаров">
                              <Icon name="plus" size={14} />В мои товары
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
        </div>
        )}
      </div>

      {bar && (
        <div className="cartbar">
          {picked.size > 0 && (
            <>
              <div>
                <b>Выбрано товаров: {picked.size}</b>
                <div className="muted">Добавятся в «Список товаров» с категориями</div>
              </div>
              <button className="btn ghost" onClick={() => setPicked(new Set())}>Сбросить</button>
              <button className="btn primary" disabled={busy} onClick={() => add([...picked])}>Добавить в мои товары</button>
            </>
          )}
          <span className="spacer" />
          {cart.count > 0 && (
            <>
              <div>
                <b>В корзине: {cart.count} {plural(cart.count, 'товар', 'товара', 'товаров')}</b>
                <div className="muted">Товар, которого у вас ещё нет, заведётся сам при приёмке</div>
              </div>
              <button className="btn primary large" onClick={() => navigate('/cart')}><Icon name="cart" size={16} />Перейти в корзину</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
