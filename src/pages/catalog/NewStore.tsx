import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bestOffer, clampQty, loadOffers, readCart, writeCart } from '../../lib/cart';
import { money, parseNum, plural, qty as fmtQty, round2 } from '../../lib/format';
import { useQuery, useStored } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { STARTER_PACKS, type StarterItem } from '../../lib/starter';
import type { Offer } from '../../lib/types';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { PharmacyStub } from './Catalog';

/** «У меня новый магазин»: пакеты ходовых товаров с ценами компаний — добавить в свой список и сразу заказать. */
export function NewStore() {
  const { org } = useWorkspace();
  return org.business === 'pharmacy' ? <PharmacyStub title="У меня новая аптека" /> : <StarterPacks />;
}

/** Розничная цена по наценке, с округлением вверх до 5: ценник без мелочи. */
const retail = (price: number, markup: number) => Math.ceil((price * (1 + markup / 100)) / 5 - 1e-9) * 5;

function StarterPacks() {
  const { org, store } = useWorkspace();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [markup, setMarkup] = useStored('sauda:starter:markup', '30');
  /** товар → сколько заказать; без записи — одна упаковка */
  const [qty, setQty] = useState<Record<string, number>>({});
  /** товар → розничная цена, если её поправили вручную */
  const [sale, setSale] = useState<Record<string, string>>({});
  /** штрихкод → выбранное предложение, если оно не самое выгодное */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const items = useQuery(() => q<StarterItem[]>(db.rpc('starter_products', { p_org: org.id })), [org.id]);
  const offers = useQuery(
    async () => (items.data ? loadOffers(store.id, { barcodes: items.data.map((i) => i.barcode) }) : []),
    [store.id, items.data],
  );
  const byBarcode = useMemo(() => {
    const map = new Map<string, Offer[]>();
    for (const o of offers.data ?? []) map.set(o.barcode, [...(map.get(o.barcode) ?? []), o]);
    return map;
  }, [offers.data]);

  const packs = useMemo(
    () => STARTER_PACKS
      .map((p) => ({ ...p, items: (items.data ?? []).filter((i) => i.starter_pack === p.key) }))
      .filter((p) => p.items.length),
    [items.data],
  );

  // при первом открытии отмечены все пакеты, кроме необязательных (табак, алкоголь); первый пакет раскрыт
  if (!picked && items.data) {
    const data = items.data;
    const optional = new Set(STARTER_PACKS.filter((p) => p.optional).map((p) => p.key));
    setPicked(new Set(data.filter((i) => !i.mine && !optional.has(i.starter_pack)).map((i) => i.id)));
    setOpen(STARTER_PACKS.find((p) => data.some((i) => i.starter_pack === p.key))?.key ?? null);
  }

  const chosenSet = picked ?? new Set<string>();
  const pct = Math.max(parseNum(markup), 0);
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(chosenSet);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setPicked(next);
  };

  const offerOf = (i: StarterItem) => {
    const own = byBarcode.get(i.barcode) ?? [];
    return own.find((o) => o.variant_id === chosen[i.barcode]) ?? bestOffer(own);
  };
  const canOrder = (o: Offer | undefined): o is Offer => !!o && (o.free == null || Number(o.free) > 0);
  /** Товар участвует: отмечен для добавления или уже есть в магазине. */
  const on = (i: StarterItem) => i.mine || chosenSet.has(i.id);
  const qtyOf = (i: StarterItem, o: Offer | undefined) =>
    !canOrder(o) || !on(i) ? 0 : clampQty(qty[i.id] ?? (i.mine ? 0 : Number(o.pack_qty)), o);
  const saleOf = (i: StarterItem, o: Offer | undefined) => (sale[i.id] !== undefined ? sale[i.id] : o ? String(retail(Number(o.price), pct)) : '');

  const summary = useMemo(() => {
    let sum = 0;
    let lines = 0;
    const companies = new Set<string>();
    for (const i of items.data ?? []) {
      const o = offerOf(i);
      const n = qtyOf(i, o);
      if (!o || n <= 0) continue;
      sum += n * Number(o.price);
      lines++;
      companies.add(o.company_id);
    }
    return { sum: round2(sum), lines, companies: companies.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data, byBarcode, chosen, qty, picked]);

  const submit = async (toCart: boolean) => {
    setBusy(true);
    try {
      const all = items.data ?? [];
      const fresh = all.filter((i) => !i.mine && chosenSet.has(i.id));
      const res = fresh.length
        ? await q<{ created: number; skipped: number }>(db.rpc('add_catalog_products', {
            p_org: org.id, p_ids: fresh.map((i) => i.id),
            p_prices: fresh.flatMap((i) => {
              const o = offerOf(i);
              return o ? [{ id: i.id, purchase_price: Number(o.price), sale_price: Math.max(parseNum(saleOf(i, o)), 0) }] : [];
            }),
          }))
        : { created: 0, skipped: 0 };

      if (toCart) {
        const carts = new Map<string, Record<string, number>>();
        for (const i of all) {
          const o = offerOf(i);
          const n = qtyOf(i, o);
          if (!o || n <= 0) continue;
          carts.set(o.company_id, { ...(carts.get(o.company_id) ?? readCart(store.id, o.company_id)), [o.variant_id]: n });
        }
        carts.forEach((cart, companyId) => writeCart(store.id, companyId, cart));
      }
      toast.ok(`Добавлено товаров: ${res.created}` + (toCart ? '. Проверьте корзину и отправьте заказы.' : '. Закупочные и розничные цены уже проставлены.'));
      navigate(toCart ? '/cart' : '/products');
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const newCount = (items.data ?? []).filter((i) => !i.mine && chosenSet.has(i.id)).length;

  return (
    <div className="with-cartbar">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/catalog')} aria-label="К каталогу товаров"><Icon name="back" /></button>
        <h1>У меня новый магазин</h1>
      </div>
      <p className="muted" style={{ marginBottom: 14, maxWidth: 820 }}>
        Готовые пакеты ходовых товаров: названия, штрихкоды и категории уже заполнены, цены — от компаний площадки.
        Снимите отметку с того, чем не торгуете, поправьте количество и розничную цену — и товары можно сразу заказать.
        Остальное найдётся в <a onClick={() => navigate('/catalog')} style={{ cursor: 'pointer' }}>каталоге</a>.
      </p>

      <div className="toolbar">
        <label className="row">
          <span className="muted">Наценка на розничную цену, %</span>
          <input className="num-input" style={{ width: 80 }} value={markup} inputMode="decimal" aria-label="Наценка, %"
            onChange={(e) => setMarkup(e.target.value)} />
        </label>
        <span className="hint">Розничная цена = цена компании + наценка, с округлением до 5 {org.currency}. Каждую цену можно поправить в строке.</span>
      </div>

      {items.error ? (
        <div className="card empty error-text">{items.error}</div>
      ) : items.loading && !items.data ? (
        <div className="card empty">Загрузка…</div>
      ) : packs.length === 0 ? (
        <div className="card empty">Пакеты товаров ещё не подготовлены</div>
      ) : (
        <div className="stack">
          {packs.map((p) => {
            const free = p.items.filter((i) => !i.mine);
            const sel = free.filter((i) => chosenSet.has(i.id)).length;
            const mine = p.items.length - free.length;
            const priced = p.items.filter((i) => offerOf(i)).length;
            const packSum = round2(p.items.reduce((s, i) => {
              const o = offerOf(i);
              return s + qtyOf(i, o) * Number(o?.price ?? 0);
            }, 0));
            const expanded = open === p.key;
            return (
              <div className={`card pack-card ${sel ? 'active' : ''}`} key={p.key}>
                <div className="pack-head">
                  <input
                    type="checkbox"
                    checked={sel > 0 && sel === free.length}
                    ref={(el) => { if (el) el.indeterminate = sel > 0 && sel < free.length; }}
                    disabled={!free.length}
                    onChange={(e) => toggle(free.map((i) => i.id), e.target.checked)}
                    aria-label={`Пакет: ${p.title}`}
                  />
                  <button className="pack-title grow" onClick={() => setOpen(expanded ? null : p.key)} aria-expanded={expanded}>
                    <b>{p.title}</b>
                    <span className="hint">{p.hint}</span>
                  </button>
                  <span className="muted pack-meta">
                    {free.length ? `выбрано ${sel} из ${free.length}` : 'все товары уже у вас'}
                    {mine > 0 && free.length > 0 && ` · ${mine} уже у вас`}
                    {' · '}с ценой: {offers.loading && !offers.data ? '…' : priced}
                  </span>
                  {packSum > 0 && <b className="num">{money(packSum)} {org.currency}</b>}
                  <button className="btn ghost small" onClick={() => setOpen(expanded ? null : p.key)} aria-expanded={expanded}>
                    {expanded ? 'Свернуть' : 'Товары и цены'}<Icon name={expanded ? 'up' : 'down'} size={14} />
                  </button>
                </div>
                {expanded && (
                  <div className="table-wrap flush">
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="cell-check" />
                          <th>Товар</th>
                          <th>Компания</th>
                          <th className="right">Цена, {org.currency}</th>
                          <th className="center" style={{ width: 150 }}>Заказать</th>
                          <th className="right" style={{ width: 130 }}>Розничная, {org.currency}</th>
                          <th className="right" style={{ width: 110 }}>Сумма, {org.currency}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((i) => {
                          const own = byBarcode.get(i.barcode) ?? [];
                          const o = offerOf(i);
                          const active = on(i);
                          const n = qtyOf(i, o);
                          const pack = Number(o?.pack_qty ?? 1);
                          const set = (v: number) => setQty({ ...qty, [i.id]: o ? clampQty(v, o) : 0 });
                          return (
                            <tr key={i.id} className={!active ? 'row-off' : n > 0 ? 'selected' : ''}>
                              <td className="cell-check">
                                <input type="checkbox" checked={active} disabled={i.mine} onChange={(e) => toggle([i.id], e.target.checked)} aria-label={`Выбрать: ${i.name}`} />
                              </td>
                              <td>
                                {i.name}
                                {i.mine && <span className="badge ok" style={{ marginLeft: 8 }}>уже у вас</span>}
                              </td>
                              <td>
                                {!o ? <span className="muted">{offers.loading && !offers.data ? '…' : 'нет предложений'}</span>
                                  : own.length > 1 ? (
                                    <select value={o.variant_id} disabled={!active} onChange={(e) => setChosen({ ...chosen, [i.barcode]: e.target.value })} aria-label={`Компания: ${i.name}`}>
                                      {own.map((x) => <option key={x.variant_id} value={x.variant_id}>{x.company_name} — {money(x.price)}</option>)}
                                    </select>
                                  ) : o.company_name}
                                {o && (
                                  <div className="muted" style={{ fontSize: 12.5 }}>
                                    {pack !== 1 && `по ${fmtQty(pack)} ${o.unit} · `}
                                    {!canOrder(o) ? <span className="error-text">нет в наличии</span> : o.free == null ? 'в наличии' : `в наличии ${fmtQty(o.free)}`}
                                  </div>
                                )}
                              </td>
                              <td className="right">{o ? <b>{money(o.price)}</b> : ''}</td>
                              <td>
                                {canOrder(o) && (
                                  <div className="qty-box">
                                    <button disabled={!active || n <= 0} onClick={() => set(n - pack)} aria-label={`Меньше: ${i.name}`}>−</button>
                                    <input value={active ? n || '' : ''} placeholder="0" disabled={!active} inputMode="decimal" aria-label={`Количество: ${i.name}`}
                                      onChange={(e) => set(parseNum(e.target.value))} />
                                    <button disabled={!active || (o.free != null && n >= Number(o.free))} onClick={() => set(n + pack)} aria-label={`Больше: ${i.name}`}>+</button>
                                  </div>
                                )}
                              </td>
                              <td className="right">
                                {o && !i.mine && (
                                  <input className="num-input" style={{ width: 100 }} value={saleOf(i, o)} disabled={!active} inputMode="decimal"
                                    aria-label={`Розничная цена: ${i.name}`} onChange={(e) => setSale({ ...sale, [i.id]: e.target.value })} />
                                )}
                              </td>
                              <td className="right">{n > 0 && o ? money(n * Number(o.price)) : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="cartbar">
        <div>
          <b>Новых товаров: {newCount}</b>
          <div className="muted">
            {summary.lines
              ? `к заказу ${summary.lines} ${plural(summary.lines, 'товар', 'товара', 'товаров')} у ${summary.companies} ${plural(summary.companies, 'компании', 'компаний', 'компаний')}`
              : 'Добавятся в «Список товаров» с категориями и ценами'}
          </div>
        </div>
        <span className="spacer" />
        {summary.sum > 0 && <div className="pos-total-sum" style={{ fontSize: 22 }}>{money(summary.sum)} <span className="stat-unit">{org.currency}</span></div>}
        <button className="btn ghost" onClick={() => navigate('/')}>Не сейчас</button>
        <button className="btn" disabled={busy || !newCount} onClick={() => submit(false)}>Только добавить товары</button>
        <button className="btn primary large" disabled={busy || (!newCount && !summary.lines)} onClick={() => submit(summary.lines > 0)}>
          {summary.lines ? 'Добавить и перейти к заказу' : `Добавить ${newCount || ''} в мои товары`}
        </button>
      </div>
    </div>
  );
}
