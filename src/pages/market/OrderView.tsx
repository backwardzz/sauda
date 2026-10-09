import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { readCart, writeCart } from '../../lib/cart';
import { dateTime, money, parseNum, qty as fmtQty, round2 } from '../../lib/format';
import { useChanged, useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ORDER_STATUS, type Order, type OrderItem } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { Icon } from '../../ui/Icon';
import { Confirm, Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

const STEPS = ['new', 'confirmed', 'shipped', 'received'] as const;

export function OrderView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { org, canManage, branches, store } = useOrg();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // подтверждение и отгрузка необратимы, поэтому сначала спрашиваем
  const [ask, setAsk] = useState<'confirm' | 'ship' | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reply, setReply] = useState('');

  const data = useQuery(
    () => q<(Order & { order_items: OrderItem[] }) | null>(db.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle() as never),
    [id],
  );
  const o = data.data;
  // заказ перечитывается новым объектом: поле ответа сбрасывается, только если поменялся сам ответ
  if (useChanged([o?.id, o?.supplier_comment], true) && o) setReply(o.supplier_comment);

  const isSupplier = o?.supplier_org === org.id;
  const open = !!o && (o.status === 'new' || o.status === 'confirmed');
  // компании до отгрузки видно, хватает ли товара на складе филиала
  const stock = useQuery(async () => {
    const ids = (o?.order_items ?? []).map((i) => i.variant_id).filter((v): v is string => !!v);
    if (!isSupplier || !open || !o?.branch_id || !ids.length) return null;
    const [tracked, rows] = await Promise.all([
      q<{ id: string }[]>(db.from('company_variants').select('id').in('id', ids).eq('track_stock', true)),
      q<{ variant_id: string; qty: number }[]>(db.from('company_stock').select('variant_id, qty').eq('branch_id', o.branch_id).in('variant_id', ids)),
    ]);
    return new Map(tracked.map((t) => [t.id, Number(rows.find((r) => r.variant_id === t.id)?.qty ?? 0)]));
  }, [o?.id, o?.branch_id, o?.status, isSupplier]);

  if (data.loading && !o) return <div className="empty">Загрузка…</div>;
  if (!o) return <div className="empty">Заказ не найден</div>;

  const items = [...o.order_items].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const editable = isSupplier && o.status === 'new';
  const shipQty = (i: OrderItem) => (editable && edits[i.id] !== undefined ? Math.max(parseNum(edits[i.id]), 0) : Number(i.qty_shipped ?? i.qty));
  const total = round2(items.reduce((s, i) => s + shipQty(i) * Number(i.price), 0));
  const changed = items.some((i) => shipQty(i) !== Number(i.qty));
  const have = (i: OrderItem) => (i.variant_id ? stock.data?.get(i.variant_id) : undefined);
  const short = items.filter((i) => have(i) !== undefined && have(i)! < shipQty(i));

  const run = async (fn: () => Promise<unknown>, ok: string, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.ok(ok);
      setConfirmCancel(false);
      setAsk(null);
      if (after) after(r);
      else data.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const status = (s: string, extra: Record<string, unknown> = {}) => q(db.rpc('set_order_status', { p_order: o.id, p_status: s, ...extra }));

  const confirm = () =>
    run(() => status('confirmed', {
      p_items: items.filter((i) => edits[i.id] !== undefined).map((i) => ({ item_id: i.id, qty: shipQty(i) })),
      p_comment: reply.trim(),
    }), 'Заказ подтверждён');
  const receive = () =>
    run(() => q<string>(db.rpc('receive_order', { p_order: o.id })), 'Создан черновик приёмки: проверьте и проведите', (doc) => navigate(`/docs/supply/${doc as string}`));
  // «на складе не хватает» → одним нажатием оставить к отгрузке столько, сколько есть
  const fitStock = () => setEdits({ ...edits, ...Object.fromEntries(short.map((i) => [i.id, String(have(i))])) });

  const repeat = () => {
    if (!store) return;
    const cart = { ...readCart(store.id, o.supplier_org) };
    let added = 0;
    for (const i of items) {
      if (!i.variant_id) continue;
      cart[i.variant_id] = Number(i.qty);
      added++;
    }
    if (!added) return toast.error('Этих товаров больше нет в каталоге компании');
    writeCart(store.id, o.supplier_org, cart);
    toast.ok('Товары заказа в корзине: проверьте цены и наличие');
    navigate('/cart');
  };

  const download = () =>
    exportXlsx(`Заказ № ${o.number} ${isSupplier ? o.store_org_name : o.supplier_name}`, 'Заказ', items.map((i) => ({
      'Товар': i.name, 'Штрихкод': i.barcode, 'Ед. изм': i.unit, 'Заказано': Number(i.qty), 'К отгрузке': shipQty(i), 'Цена': Number(i.price), 'Сумма': round2(shipQty(i) * Number(i.price)),
    }))).catch(toast.error);

  const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);
  const stamps = [o.created_at, o.confirmed_at, o.shipped_at, o.received_at];
  const showStock = isSupplier && open && !!stock.data;

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/orders')} aria-label="К списку заказов"><Icon name="back" /></button>
        <h1>Заказ № {o.number}</h1>
        <span className={`badge ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>
        <span className="muted">{isSupplier ? `${o.store_org_name} · ${[o.store_name, o.store_city, o.store_address].filter(Boolean).join(', ')}` : o.supplier_name}</span>
      </div>

      {o.status !== 'canceled' && (
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`step ${i <= step ? 'done' : ''} ${i === step ? 'current' : ''}`}>
              <span className="step-dot">{i < step || o.status === 'received' ? <Icon name="check" size={13} /> : i + 1}</span>
              <div>
                <b>{ORDER_STATUS[s].label}</b>
                <div className="muted">{stamps[i] && i <= step ? dateTime(stamps[i]) : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        {isSupplier && o.status === 'new' && <button className="btn primary" disabled={busy} onClick={() => setAsk('confirm')}>{changed ? 'Подтвердить с изменениями' : 'Подтвердить заказ'}</button>}
        {isSupplier && o.status === 'confirmed' && <button className="btn primary" disabled={busy} onClick={() => setAsk('ship')}>Отгрузить</button>}
        {!isSupplier && o.status === 'shipped' && canManage && <button className="btn primary" disabled={busy} onClick={receive}>Принять товар</button>}
        {!isSupplier && o.supply_doc && <Link className="btn" to={`/docs/supply/${o.supply_doc}`}>Открыть приёмку</Link>}
        {!isSupplier && canManage && ['received', 'canceled'].includes(o.status) && (
          <button className="btn" onClick={repeat} title="Положить те же товары в корзину"><Icon name="undo" size={16} />Повторить заказ</button>
        )}
        {((isSupplier && open) || (!isSupplier && o.status === 'new' && canManage)) && (
          <button className="btn danger" disabled={busy} onClick={() => setConfirmCancel(true)}>Отменить заказ</button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      <div className="card filter-grid">
        {isSupplier ? (
          <>
            <div className="field">
              <span>Магазин</span>
              <div>
                {o.store_org_name}
                {o.store_phone && <> · <a href={`tel:${o.store_phone.replace(/[^\d+]/g, '')}`}>{o.store_phone}</a></>}
              </div>
            </div>
            <div className="field">
              <span>Куда везти</span>
              <div>{[o.store_city, o.store_address, o.store_name].filter(Boolean).join(', ') || 'адрес не указан'}</div>
            </div>
            <label className="field">
              <span>Отгружает филиал</span>
              {open && branches.length > 1 ? (
                <select value={o.branch_id ?? ''} disabled={busy}
                  onChange={(e) => run(() => q(db.rpc('set_order_branch', { p_order: o.id, p_branch: e.target.value })), 'Заказ передан другому филиалу')}>
                  {!o.branch_id && <option value="">Не выбран</option>}
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              ) : <div>{o.branch_name || '—'}</div>}
            </label>
          </>
        ) : (
          <>
            <div className="field"><span>Компания</span><div><Link to={`/market/${o.supplier_org}`}>{o.supplier_name}</Link></div></div>
            {o.branch_name && <div className="field"><span>Заказ собирает</span><div>{o.branch_name}</div></div>}
          </>
        )}
        {o.comment && <div className="field"><span>Комментарий магазина</span><div>{o.comment}</div></div>}
        {editable ? (
          <label className="field">
            <span>Ответ магазину</span>
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Когда привезём, чего нет в наличии" />
          </label>
        ) : o.supplier_comment ? (
          <div className="field"><span>Ответ компании</span><div>{o.supplier_comment}</div></div>
        ) : null}
      </div>

      {short.length > 0 && (
        <div className="card banner warn">
          <Icon name="alert" />
          <span className="grow">На складе филиала не хватает товаров: {short.length}. {editable ? 'Уменьшите количество к отгрузке или передайте заказ другому филиалу.' : 'Пополните остаток или передайте заказ другому филиалу — иначе заказ не отгрузится.'}</span>
          {editable && <button className="btn" onClick={fitStock}>Отгрузить, сколько есть</button>}
        </div>
      )}

      <div className="table-wrap">
        <table className="table doc-lines">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Штрихкод</th>
              <th className="right">Заказано</th>
              {showStock && <th className="right">На складе</th>}
              <th className="right">{o.status === 'new' ? 'К отгрузке' : 'Отгружается'}</th>
              <th className="right">Цена, {org.currency}</th>
              <th className="right">Сумма, {org.currency}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const ship = shipQty(i);
              const h = have(i);
              return (
                <tr key={i.id} className={h !== undefined && h < ship ? 'row-neg' : ship !== Number(i.qty) ? 'row-low' : ''}>
                  <td>{i.name}</td>
                  <td className="num">{i.barcode}</td>
                  <td className="right">{fmtQty(i.qty)} {i.unit}</td>
                  {showStock && <td className="right">{h === undefined ? <span className="muted">без учёта</span> : fmtQty(h)}</td>}
                  <td className="right">
                    {editable ? (
                      <input className="num-input" value={edits[i.id] ?? String(Number(i.qty))} inputMode="decimal" aria-label={`К отгрузке: ${i.name}`}
                        onChange={(e) => setEdits({ ...edits, [i.id]: e.target.value })} />
                    ) : ship === 0 ? <span className="badge danger">нет</span> : `${fmtQty(ship)} ${i.unit}`}
                  </td>
                  <td className="right">{money(i.price)}</td>
                  <td className="right">{money(ship * Number(i.price))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={showStock ? 6 : 5}>Итого: позиций {items.filter((i) => shipQty(i) > 0).length}</td>
              <td className="right">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && <p className="hint" style={{ marginTop: 10 }}>Если чего-то нет или меньше, чем заказано, поправьте количество «К отгрузке» — магазин увидит изменения.</p>}
      {!isSupplier && o.status === 'shipped' && (
        <p className="hint" style={{ marginTop: 10 }}>«Принять товар» создаст черновик приёмки с этими количествами и ценами. Товары, которых ещё нет в вашей базе, заведутся сами.</p>
      )}

      {ask === 'confirm' && (
        <Confirm title={`Подтвердить заказ № ${o.number}`} busy={busy} onClose={() => setAsk(null)} onConfirm={confirm}
          confirmLabel={changed ? 'Подтвердить с изменениями' : 'Подтвердить заказ'}
          text={<>
            Покупатель ({o.store_org_name}) увидит, что заказ принят в работу: позиций {items.filter((i) => shipQty(i) > 0).length} на {money(total)} {org.currency}.
            {changed && ' Количество к отгрузке отличается от заказанного — магазин увидит изменения.'}
            {' '}После подтверждения количество поменять уже нельзя.
          </>} />
      )}
      {ask === 'ship' && (
        <Modal title={`Отгрузить заказ № ${o.number}`} onClose={() => setAsk(null)} width={480}
          footer={
            <>
              <button className="btn" onClick={() => setAsk(null)}>Отмена</button>
              <button className="btn primary" disabled={busy || short.length > 0}
                onClick={() => run(() => status('shipped'), 'Заказ отгружен: товар списан со склада, магазин примет его в один клик')}>
                Отгрузить
              </button>
            </>
          }>
          <div className="stack">
            <p>
              Товар будет списан со склада{o.branch_name && <> ({o.branch_name})</>}: позиций {items.filter((i) => shipQty(i) > 0).length} на {money(total)} {org.currency}.
              Покупатель ({o.store_org_name}) сможет принять его у себя.
            </p>
            <p className="muted">Куда везти: {[o.store_city, o.store_address, o.store_name].filter(Boolean).join(', ') || 'адрес не указан'}. Отменить отгрузку будет нельзя.</p>
            {short.length > 0 && <p className="error-text">На складе филиала не хватает товаров: {short.length}. Пополните остаток или передайте заказ другому филиалу.</p>}
            {/* передачи заказа водителю пока нет: кнопка показывает, что она появится */}
            <button type="button" className="btn soon-btn" disabled title="Раздел для водителей-экспедиторов ещё в разработке">
              <Icon name="truck" size={16} />Отправить водителю-экспедитору<span className="badge warn">Скоро…</span>
            </button>
          </div>
        </Modal>
      )}
      {confirmCancel && (
        <Confirm title={`Отменить заказ № ${o.number}`} text="Вторая сторона увидит, что заказ отменён. Вернуть его в работу будет нельзя."
          confirmLabel="Отменить заказ" danger busy={busy} onClose={() => setConfirmCancel(false)}
          onConfirm={() => run(() => status('canceled', isSupplier ? { p_comment: reply.trim() || null } : {}), 'Заказ отменён')} />
      )}
    </>
  );
}
