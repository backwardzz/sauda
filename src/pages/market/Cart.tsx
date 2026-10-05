import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clampQty, loadOffers, useCarts } from '../../lib/cart';
import { money, parseNum, plural, qty as fmtQty, round2 } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Offer } from '../../lib/types';
import { fullName } from '../../lib/variants';
import { Icon } from '../../ui/Icon';
import { ProductImage } from '../../ui/ProductImage';
import { toast } from '../../ui/toast';

/** Корзина магазина: товары из каталога, со страниц компаний и из пакетов — по одному заказу на компанию. */
export function CartPage() {
  const { org, store } = useWorkspace();
  const navigate = useNavigate();
  const { carts, setQty, clear } = useCarts(store.id);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const ids = Object.values(carts).flatMap((c) => Object.keys(c)).sort();
  const offers = useQuery(() => loadOffers(store.id, { variants: ids }), [store.id, ids.join(',')]);

  const groups = useMemo(() => {
    const byId = new Map((offers.data ?? []).map((o) => [o.variant_id, o]));
    return Object.entries(carts).map(([companyId, cart]) => {
      const lines = Object.entries(cart).map(([variantId, n]) => ({ variantId, n, offer: byId.get(variantId) }));
      const live = lines.filter((l): l is { variantId: string; n: number; offer: Offer } => !!l.offer && (l.offer.free == null || Number(l.offer.free) > 0));
      const total = round2(live.reduce((s, l) => s + clampQty(l.n, l.offer) * Number(l.offer.price), 0));
      const head = lines.find((l) => l.offer)?.offer;
      return { companyId, lines, live, total, name: head?.company_name ?? 'Компания', min: Number(head?.min_order ?? 0), branch: head };
    });
  }, [carts, offers.data]);

  const ready = groups.filter((g) => g.live.length > 0 && g.total >= g.min);
  const grand = round2(groups.reduce((s, g) => s + g.total, 0));

  const order = async (g: (typeof groups)[number]) => {
    const id = await q<string>(db.rpc('place_order', {
      p_store: store.id, p_supplier: g.companyId, p_comment: (comments[g.companyId] ?? '').trim(),
      p_items: g.live.map((l) => ({ variant_id: l.variantId, qty: clampQty(l.n, l.offer) })),
    }));
    clear(g.companyId);
    return id;
  };

  const submit = async (list: typeof groups) => {
    setBusy(true);
    let done = 0;
    let last = '';
    try {
      for (const g of list) {
        last = await order(g);
        done++;
      }
      toast.ok(done === 1 ? 'Заказ отправлен компании' : `Отправлено заказов: ${done}`);
      navigate(done === 1 ? `/orders/${last}` : '/orders');
    } catch (e) {
      toast.error(e);
      if (done) toast.ok(`Отправлено заказов: ${done}. Остальные остались в корзине.`);
      offers.reload();
    } finally {
      setBusy(false);
    }
  };

  if (!groups.length) {
    return (
      <>
        <div className="page-head"><h1>Корзина</h1></div>
        <div className="card empty">
          <p><b>Корзина пуста.</b></p>
          <p style={{ marginTop: 6 }}>Добавьте товары из <Link to="/catalog">каталога товаров</Link> или со страницы <Link to="/market">компании</Link>.</p>
        </div>
      </>
    );
  }

  return (
    <div className="with-cartbar">
      <div className="page-head">
        <h1>Корзина</h1>
        <span className="muted">{store.name} · {groups.length} {plural(groups.length, 'компания', 'компании', 'компаний')}: каждой уйдёт свой заказ</span>
      </div>
      {offers.error && <div className="card empty error-text">{offers.error}</div>}

      {groups.map((g) => (
        <div className="card cart-group" key={g.companyId}>
          <div className="card-head">
            <h2><Link to={`/market/${g.companyId}`}>{g.name}</Link></h2>
            {g.branch?.branch_name && <span className="muted">соберёт: {g.branch.branch_name}{g.branch.local ? ' — в вашем городе' : ''}</span>}
            <span className="spacer" />
            {g.total < g.min && <span className="badge danger">до минимального заказа не хватает {money(g.min - g.total)} {org.currency}</span>}
            <button className="btn ghost small" onClick={() => clear(g.companyId)}>Очистить</button>
          </div>
          <table className="table">
            <tbody>
              {g.lines.map(({ variantId, n, offer: o }) => {
                if (!o) {
                  return (
                    <tr key={variantId} className="row-off">
                      <td colSpan={4}>{offers.loading ? 'Загрузка…' : 'Товар больше не продаётся'}</td>
                      <td className="right"><button className="icon-btn small danger" onClick={() => setQty(g.companyId, variantId, 0)} aria-label="Убрать"><Icon name="x" size={15} /></button></td>
                    </tr>
                  );
                }
                const out = o.free != null && Number(o.free) <= 0;
                const over = o.free != null && n > Number(o.free);
                const pack = Number(o.pack_qty);
                const title = fullName(o.product_name, o.label);
                const set = (v: number) => setQty(g.companyId, variantId, clampQty(v, o));
                return (
                  <tr key={variantId} className={out ? 'row-off' : over ? 'row-low' : ''}>
                    <td>
                      <div className="row">
                        <ProductImage src={o.image_url} alt="" className="small" />
                        <div>
                          <div>{title}</div>
                          <div className="muted num" style={{ fontSize: 12.5 }}>{o.barcode}{pack !== 1 && ` · по ${fmtQty(pack)} ${o.unit}`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="right">
                      {out ? <span className="badge danger">нет в наличии</span>
                        : over ? <button className="btn small" onClick={() => set(Number(o.free))}>доступно {fmtQty(o.free)} — исправить</button>
                        : o.free != null && <span className="muted">в наличии {fmtQty(o.free)}</span>}
                    </td>
                    <td className="right">{money(o.price)}</td>
                    <td style={{ width: 170 }}>
                      {!out && (
                        <div className="qty-box">
                          <button onClick={() => set(n - pack)} aria-label={`Меньше: ${title}`}>−</button>
                          <input value={n || ''} inputMode="decimal" aria-label={`Количество: ${title}`} onChange={(e) => set(parseNum(e.target.value))} />
                          <button onClick={() => set(n + pack)} disabled={o.free != null && n >= Number(o.free)} aria-label={`Больше: ${title}`}>+</button>
                        </div>
                      )}
                    </td>
                    <td className="right" style={{ width: 150 }}>
                      {!out && <b>{money(clampQty(n, o) * Number(o.price))}</b>}
                      <button className="icon-btn small danger" style={{ marginLeft: 6 }} onClick={() => setQty(g.companyId, variantId, 0)} aria-label={`Убрать: ${title}`}><Icon name="x" size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="cart-foot">
            <input className="grow" value={comments[g.companyId] ?? ''} onChange={(e) => setComments({ ...comments, [g.companyId]: e.target.value })}
              placeholder="Комментарий компании: когда привезти, кого спросить" />
            <b className="num">{money(g.total)} {org.currency}</b>
            <button className="btn primary" disabled={busy || !g.live.length || g.total < g.min} onClick={() => submit([g])}>Оформить заказ</button>
          </div>
        </div>
      ))}

      <div className="cartbar">
        <div>
          <b>К заказу: {ready.length} из {groups.length}</b>
          <div className="muted">{ready.length < groups.length ? 'остальные не дотягивают до минимальной суммы или закончились' : 'после отгрузки приёмка создаётся одной кнопкой'}</div>
        </div>
        <span className="spacer" />
        <div className="pos-total-sum" style={{ fontSize: 22 }}>{money(grand)} <span className="stat-unit">{org.currency}</span></div>
        <button className="btn primary large" disabled={busy || !ready.length} onClick={() => submit(ready)}>
          {ready.length > 1 ? `Оформить ${ready.length} ${plural(ready.length, 'заказ', 'заказа', 'заказов')}` : 'Оформить заказ'}
        </button>
      </div>
    </div>
  );
}
