import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { suggestQty, useCart } from '../../lib/cart';
import { money, parseNum, qty as fmtQty, round2 } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Org, StockRow, SupplierProduct } from '../../lib/types';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

type Mine = Pick<StockRow, 'barcode' | 'qty' | 'min_stock' | 'low' | 'unit'>;

/** Каталог одного поставщика глазами магазина: остатки магазина рядом с товаром и корзина заказа. */
export function MarketSupplier() {
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

  const supplier = useQuery(() => q<Org | null>(db.from('orgs').select('*').eq('id', id).eq('kind', 'supplier').maybeSingle()), [id]);
  const catalog = useQuery(
    () => q<SupplierProduct[]>(db.from('supplier_products').select('*').eq('org_id', id).eq('archived', false).order('category').order('name').limit(5000)),
    [id],
  );
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

  const items = catalog.data ?? [];
  const stock = mine.data ?? new Map<string, Mine>();
  const categories = useMemo(() => [...new Set(items.map((p) => p.category).filter(Boolean))], [items]);
  const term = search.trim().toLowerCase();
  const shown = items.filter(
    (p) =>
      (!term || p.name.toLowerCase().includes(term) || p.barcode.includes(term)) &&
      (!category || p.category === category) &&
      (!onlyLow || stock.get(p.barcode)?.low) &&
      (!onlyCart || cart[p.id] > 0),
  );

  const lines = items.filter((p) => cart[p.id] > 0);
  const total = round2(lines.reduce((s, p) => s + cart[p.id] * Number(p.price), 0));
  const s = supplier.data;
  const minOrder = Number(s?.min_order ?? 0);
  const lowCount = items.filter((p) => p.available && stock.get(p.barcode)?.low).length;

  const addLow = () => {
    const next = { ...cart };
    let added = 0;
    for (const p of items) {
      const m = stock.get(p.barcode);
      if (!p.available || !m?.low || m.min_stock == null || next[p.id] > 0) continue;
      const n = suggestQty(Number(m.qty), Number(m.min_stock), Number(p.pack_qty)) || Number(p.pack_qty);
      next[p.id] = n;
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
          p_items: lines.map((p) => ({ product_id: p.id, qty: cart[p.id] })),
        }),
      );
      clear();
      toast.ok('Заказ отправлен поставщику');
      navigate(`/orders/${orderId}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  if (supplier.loading && !s) return <div className="empty">Загрузка…</div>;
  if (!s) return <div className="empty">Поставщик не найден</div>;

  return (
    <div className="with-cartbar">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/market')} aria-label="К списку поставщиков"><Icon name="back" /></button>
        <h1>{s.name}</h1>
        <span className="muted">
          {[minOrder > 0 && `заказ от ${money(minOrder)} ${org.currency}`, s.delivery_note, s.phone].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div className="toolbar">
        <input className="search" type="search" placeholder="Название или штрихкод" value={search} onChange={(e) => setSearch(e.target.value)} />
        {categories.length > 1 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
            <option value="">Все категории</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <label className="check-row"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />Заканчивается у меня{lowCount ? ` · ${lowCount}` : ''}</label>
        <label className="check-row"><input type="checkbox" checked={onlyCart} onChange={(e) => setOnlyCart(e.target.checked)} />В корзине</label>
        <span className="spacer" />
        <button className="btn" disabled={!lowCount} onClick={addLow}>
          <Icon name="bolt" size={16} />Заказать всё, что заканчивается
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Категория</th>
              <th className="right">У вас</th>
              <th className="right">Упаковка</th>
              <th className="right">Цена, {org.currency}</th>
              <th className="center" style={{ width: 170 }}>Заказать</th>
              <th className="right">Сумма, {org.currency}</th>
            </tr>
          </thead>
          <tbody>
            {catalog.error ? (
              <tr><td colSpan={7} className="table-note error-text">{catalog.error}</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={7} className="table-note">{catalog.loading ? 'Загрузка…' : items.length ? 'Ничего не найдено' : 'Поставщик ещё не добавил товары'}</td></tr>
            ) : (
              shown.map((p) => {
                const m = stock.get(p.barcode);
                const n = cart[p.id] ?? 0;
                const pack = Number(p.pack_qty);
                return (
                  <tr key={p.id} className={n > 0 ? 'selected' : ''}>
                    <td>
                      <div>{p.name}</div>
                      <div className="muted num" style={{ fontSize: 12.5 }}>{p.barcode}</div>
                    </td>
                    <td className="muted">{p.category}</td>
                    <td className="right">
                      {mine.loading ? '' : !m ? <span className="badge">нет в базе</span>
                        : <>{fmtQty(m.qty)} {m.unit}{m.low && <span className="badge warn" style={{ marginLeft: 6 }}>мало</span>}</>}
                    </td>
                    <td className="right">{pack !== 1 ? `по ${fmtQty(pack)} ${p.unit}` : p.unit}</td>
                    <td className="right">{money(p.price)}</td>
                    <td>
                      {p.available ? (
                        <div className="qty-box">
                          <button onClick={() => setQty(p.id, n - pack)} disabled={n <= 0} aria-label={`Меньше: ${p.name}`}>−</button>
                          <input value={n || ''} placeholder="0" inputMode="decimal" aria-label={`Количество: ${p.name}`}
                            onChange={(e) => setQty(p.id, parseNum(e.target.value))} />
                          <button onClick={() => setQty(p.id, n + pack)} aria-label={`Больше: ${p.name}`}>+</button>
                        </div>
                      ) : (
                        <div className="center muted">нет в наличии</div>
                      )}
                    </td>
                    <td className="right">{n > 0 ? money(n * Number(p.price)) : ''}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {lines.length > 0 && (
        <div className="cartbar">
          <div>
            <b>В заказе: {lines.length}</b>
            <div className={total < minOrder ? 'error-text' : 'muted'}>
              {total < minOrder ? `До минимального заказа не хватает ${money(minOrder - total)} ${org.currency}` : store.name}
            </div>
          </div>
          <input className="grow" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий поставщику: когда привезти, кого спросить" />
          <button className="btn ghost" onClick={clear}>Очистить</button>
          <div className="pos-total-sum" style={{ fontSize: 22 }}>{money(total)} <span className="stat-unit">{org.currency}</span></div>
          <button className="btn primary large" disabled={busy || total < minOrder} onClick={submit}>Оформить заказ</button>
        </div>
      )}
    </div>
  );
}
