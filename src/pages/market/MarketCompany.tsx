import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { clampQty, loadOffers, suggestQty, useCart } from '../../lib/cart';
import { money, parseNum, plural, qty as fmtQty, round2 } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { COMPANY_TYPE, type CompanyCard, type Offer, type StockRow } from '../../lib/types';
import { fullName } from '../../lib/variants';
import { CompanyAvatar, VerifiedBadge } from '../../ui/CompanyAvatar';
import { Icon } from '../../ui/Icon';
import { ProductImage } from '../../ui/ProductImage';
import { toast } from '../../ui/toast';

type Mine = Pick<StockRow, 'barcode' | 'qty' | 'min_stock' | 'low' | 'unit'>;

/** Каталог одной компании глазами магазина: товары с видами, свои остатки рядом и корзина заказа. */
export function MarketCompany() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { org, store } = useWorkspace();
  const { cart, setQty, replace, clear } = useCart(store.id, id);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [onlyCart, setOnlyCart] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const company = useQuery(async () => (await q<CompanyCard[]>(db.rpc('company_directory'))).find((c) => c.id === id) ?? null, [id]);
  const catalog = useQuery(() => loadOffers(store.id, { company: id }), [id, store.id]);
  // остатки магазина по тем же штрихкодам: видно, что заканчивается и чего в магазине ещё нет
  const mine = useQuery(async () => {
    const codes = (catalog.data ?? []).map((p) => p.barcode).filter((c) => /^[\w-]+$/.test(c));
    const map = new Map<string, Mine>();
    for (let i = 0; i < codes.length; i += 200) {
      const rows = await q<Mine[]>(
        db.from('product_stock').select('barcode, qty, min_stock, low, unit').eq('store_id', store.id).eq('archived', false).in('barcode', codes.slice(i, i + 200)),
      );
      rows.forEach((r) => map.set(r.barcode, r));
    }
    return map;
  }, [catalog.data, store.id]);

  const offers = useMemo(() => catalog.data ?? [], [catalog.data]);
  const stock = mine.data ?? new Map<string, Mine>();
  const categories = useMemo(() => [...new Set(offers.map((p) => p.category).filter(Boolean))], [offers]);
  const canOrder = (o: Offer) => o.free == null || Number(o.free) > 0;
  const term = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const shown = offers.filter((o) =>
      (!term || fullName(o.product_name, o.label).toLowerCase().includes(term) || o.barcode.includes(term)) &&
      (!category || o.category === category) &&
      (!onlyLow || stock.get(o.barcode)?.low) &&
      (!onlyCart || cart[o.variant_id] > 0));
    const map = new Map<string, Offer[]>();
    for (const o of shown) map.set(o.product_id, [...(map.get(o.product_id) ?? []), o]);
    return [...map.values()];
  }, [offers, term, category, onlyLow, onlyCart, stock, cart]);

  const lines = offers.filter((o) => cart[o.variant_id] > 0);
  const total = round2(lines.reduce((s, o) => s + cart[o.variant_id] * Number(o.price), 0));
  const c = company.data;
  const minOrder = Number(c?.min_order ?? 0);
  const lowCount = offers.filter((o) => canOrder(o) && stock.get(o.barcode)?.low).length;
  const branch = offers[0];

  const addLow = () => {
    const next = { ...cart };
    let added = 0;
    for (const o of offers) {
      const m = stock.get(o.barcode);
      if (!canOrder(o) || !m?.low || m.min_stock == null || next[o.variant_id] > 0) continue;
      const n = clampQty(suggestQty(Number(m.qty), Number(m.min_stock), Number(o.pack_qty)) || Number(o.pack_qty), o);
      if (n <= 0) continue;
      next[o.variant_id] = n;
      added++;
    }
    replace(next);
    toast.ok(added ? `Добавлено товаров: ${added}. Количество — до двойного критического остатка.` : 'Всё заканчивающееся уже в корзине');
  };

  const submit = async () => {
    setBusy(true);
    try {
      const orderId = await q<string>(
        db.rpc('place_order', {
          p_store: store.id, p_supplier: id, p_comment: comment.trim(),
          p_items: lines.map((o) => ({ variant_id: o.variant_id, qty: cart[o.variant_id] })),
        }),
      );
      clear();
      toast.ok('Заказ отправлен компании');
      navigate(`/orders/${orderId}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
      catalog.reload();
    }
  };

  if (company.loading && !c) return <div className="empty">Загрузка…</div>;
  if (!c) return <div className="empty">Компания не найдена</div>;

  return (
    <div className="with-cartbar">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/market')} aria-label="К списку компаний"><Icon name="back" /></button>
        <CompanyAvatar name={c.name} logo={c.logo_url} size={40} />
        <h1>{c.name}</h1>
        <span className="badge accent">{COMPANY_TYPE[c.company_type]}</span>
        {c.verified && <VerifiedBadge />}
      </div>

      <div className="card company-about">
        {c.description && <p className="wide">{c.description}</p>}
        <span><Icon name="pin" size={15} />{c.cities.join(', ') || 'город не указан'}</span>
        {c.phone && <span><Icon name="phone" size={15} /><a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a></span>}
        {minOrder > 0 && <span><Icon name="cash" size={15} />заказ от {money(minOrder)} {org.currency}</span>}
        {c.delivery_note && <span><Icon name="truck" size={15} />{c.delivery_note}</span>}
        {c.payment_terms && <span><Icon name="card" size={15} />{c.payment_terms}</span>}
        {branch?.branch_name && (
          <span className={branch.local ? 'ok-text' : ''}>
            <Icon name="warehouse" size={15} />Ваш заказ соберёт: {branch.branch_name}{branch.local ? ' — в вашем городе' : ''}
          </span>
        )}
      </div>

      <div className="toolbar">
        <input className="search" type="search" placeholder="Название или штрихкод" value={search} onChange={(e) => setSearch(e.target.value)} />
        {categories.length > 1 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
            <option value="">Все категории</option>
            {categories.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <label className="check-row"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />Заканчивается у меня{lowCount ? ` · ${lowCount}` : ''}</label>
        <label className="check-row"><input type="checkbox" checked={onlyCart} onChange={(e) => setOnlyCart(e.target.checked)} />В корзине</label>
        <span className="spacer" />
        <button className="btn" disabled={!lowCount} onClick={addLow}>
          <Icon name="bolt" size={16} />Заказать всё, что заканчивается
        </button>
      </div>

      {catalog.error ? <div className="card empty error-text">{catalog.error}</div>
        : groups.length === 0 ? <div className="card empty">{catalog.loading ? 'Загрузка…' : offers.length ? 'Ничего не найдено' : 'Компания ещё не добавила товары'}</div>
        : (
          <div className="offer-list">
            {groups.map((list) => {
              const p = list[0];
              return (
                <div className={`card offer-card ${list.some((o) => cart[o.variant_id] > 0) ? 'active' : ''}`} key={p.product_id}>
                  <ProductImage src={p.image_url} alt={p.product_name} />
                  <div className="grow">
                    <div className="row wrap">
                      <h3>{p.product_name}</h3>
                      {p.category && <span className="badge">{p.category}</span>}
                      {list.length > 1 && <span className="muted">{list.length} {plural(list.length, 'вид', 'вида', 'видов')}</span>}
                    </div>
                    {p.description && <p className="muted offer-desc">{p.description}</p>}
                    <div className="offer-variants">
                      {list.map((o) => {
                        const m = stock.get(o.barcode);
                        const n = cart[o.variant_id] ?? 0;
                        const pack = Number(o.pack_qty);
                        const title = fullName(o.product_name, o.label);
                        return (
                          <div className={`offer-row ${n > 0 ? 'selected' : ''}`} key={o.variant_id}>
                            <div className="offer-label">
                              <b>{o.label || o.unit}</b>
                              <span className="muted num">{o.barcode}{pack !== 1 && ` · по ${fmtQty(pack)} ${o.unit}`}</span>
                            </div>
                            <div className="offer-mine">
                              {mine.loading ? null : !m ? <span className="badge">нет в базе</span>
                                : <span className={`badge ${m.low ? 'warn' : ''}`}>у вас {fmtQty(m.qty)} {m.unit}</span>}
                            </div>
                            <div className="offer-stock">
                              {o.free == null ? <span className="muted">в наличии</span>
                                : Number(o.free) > 0 ? <span className="muted">в наличии {fmtQty(o.free)}</span>
                                : <span className="badge danger">нет в наличии</span>}
                            </div>
                            <b className="num offer-price">{money(o.price)} <span className="stat-unit">{org.currency}</span></b>
                            {canOrder(o) ? (
                              <div className="qty-box">
                                <button onClick={() => setQty(o.variant_id, clampQty(n - pack, o))} disabled={n <= 0} aria-label={`Меньше: ${title}`}>−</button>
                                <input value={n || ''} placeholder="0" inputMode="decimal" aria-label={`Количество: ${title}`}
                                  onChange={(e) => setQty(o.variant_id, clampQty(parseNum(e.target.value), o))} />
                                <button onClick={() => setQty(o.variant_id, clampQty(n + pack, o))} disabled={o.free != null && n >= Number(o.free)} aria-label={`Больше: ${title}`}>+</button>
                              </div>
                            ) : <div className="qty-box" />}
                            <span className="num offer-sum">{n > 0 ? money(n * Number(o.price)) : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {offers.some((o) => o.image_url.includes('facts.org')) && (
        <p className="hint" style={{ marginTop: 10 }}>
          Фото товаров: Open Food Facts и родственные открытые базы, лицензия CC BY-SA.
        </p>
      )}

      {lines.length > 0 && (
        <div className="cartbar">
          <div>
            <b>В заказе: {lines.length}</b>
            <div className={total < minOrder ? 'error-text' : 'muted'}>
              {total < minOrder ? `До минимального заказа не хватает ${money(minOrder - total)} ${org.currency}` : store.name}
            </div>
          </div>
          <input className="grow" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий компании: когда привезти, кого спросить" />
          <button className="btn ghost" onClick={clear}>Очистить</button>
          <Link className="btn" to="/cart">Вся корзина</Link>
          <div className="pos-total-sum" style={{ fontSize: 22 }}>{money(total)} <span className="stat-unit">{org.currency}</span></div>
          <button className="btn primary large" disabled={busy || total < minOrder} onClick={submit}>Оформить заказ</button>
        </div>
      )}
    </div>
  );
}
