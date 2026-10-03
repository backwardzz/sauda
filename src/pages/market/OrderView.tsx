import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dateTime, money, parseNum, qty as fmtQty, round2 } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ORDER_STATUS, type Order, type OrderItem } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { Icon } from '../../ui/Icon';
import { Confirm } from '../../ui/Modal';
import { toast } from '../../ui/toast';

const STEPS = ['new', 'confirmed', 'shipped', 'received'] as const;

export function OrderView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { org, canManage } = useOrg();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reply, setReply] = useState('');

  const data = useQuery(
    () => q<(Order & { order_items: OrderItem[] }) | null>(db.from('orders').select('*, order_items(*)').eq('id', id).maybeSingle() as never),
    [id],
  );
  const o = data.data;
  useEffect(() => {
    if (o) setReply(o.supplier_comment);
  }, [o?.id, o?.supplier_comment]);

  if (data.loading && !o) return <div className="empty">Загрузка…</div>;
  if (!o) return <div className="empty">Заказ не найден</div>;

  const isSupplier = o.supplier_org === org.id;
  const items = [...o.order_items].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const editable = isSupplier && o.status === 'new';
  const shipQty = (i: OrderItem) => (editable && edits[i.id] !== undefined ? Math.max(parseNum(edits[i.id]), 0) : Number(i.qty_shipped ?? i.qty));
  const total = round2(items.reduce((s, i) => s + shipQty(i) * Number(i.price), 0));
  const changed = items.some((i) => shipQty(i) !== Number(i.qty));

  const run = async (fn: () => Promise<unknown>, ok: string, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.ok(ok);
      setConfirmCancel(false);
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

  const download = () =>
    exportXlsx(`Заказ № ${o.number} ${isSupplier ? o.store_org_name : o.supplier_name}`, 'Заказ', items.map((i) => ({
      'Товар': i.name, 'Штрихкод': i.barcode, 'Ед. изм': i.unit, 'Заказано': Number(i.qty), 'К отгрузке': shipQty(i), 'Цена': Number(i.price), 'Сумма': round2(shipQty(i) * Number(i.price)),
    }))).catch(toast.error);

  const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);
  const stamps = [o.created_at, o.confirmed_at, o.shipped_at, o.received_at];

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/orders')} aria-label="К списку заказов"><Icon name="back" /></button>
        <h1>Заказ № {o.number}</h1>
        <span className={`badge ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>
        <span className="muted">{isSupplier ? `${o.store_org_name} · ${[o.store_name, o.store_address].filter(Boolean).join(', ')}` : o.supplier_name}</span>
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
        {isSupplier && o.status === 'new' && <button className="btn primary" disabled={busy} onClick={confirm}>{changed ? 'Подтвердить с изменениями' : 'Подтвердить заказ'}</button>}
        {isSupplier && o.status === 'confirmed' && (
          <button className="btn primary" disabled={busy} onClick={() => run(() => status('shipped'), 'Заказ отгружен: магазин примет его в один клик')}>Отгрузить</button>
        )}
        {!isSupplier && o.status === 'shipped' && canManage && <button className="btn primary" disabled={busy} onClick={receive}>Принять товар</button>}
        {!isSupplier && o.supply_doc && <Link className="btn" to={`/docs/supply/${o.supply_doc}`}>Открыть приёмку</Link>}
        {((isSupplier && ['new', 'confirmed'].includes(o.status)) || (!isSupplier && o.status === 'new' && canManage)) && (
          <button className="btn danger" disabled={busy} onClick={() => setConfirmCancel(true)}>Отменить заказ</button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      {(o.comment || o.supplier_comment || editable) && (
        <div className="card filter-grid">
          {o.comment && <div className="field"><span>Комментарий магазина</span><div>{o.comment}</div></div>}
          {editable ? (
            <label className="field">
              <span>Ответ магазину</span>
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Когда привезём, чего нет в наличии" />
            </label>
          ) : o.supplier_comment ? (
            <div className="field"><span>Ответ поставщика</span><div>{o.supplier_comment}</div></div>
          ) : null}
        </div>
      )}

      <div className="table-wrap">
        <table className="table doc-lines">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Штрихкод</th>
              <th className="right">Заказано</th>
              <th className="right">{o.status === 'new' ? 'К отгрузке' : 'Отгружается'}</th>
              <th className="right">Цена, {org.currency}</th>
              <th className="right">Сумма, {org.currency}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const ship = shipQty(i);
              return (
                <tr key={i.id} className={ship !== Number(i.qty) ? 'row-low' : ''}>
                  <td>{i.name}</td>
                  <td className="num">{i.barcode}</td>
                  <td className="right">{fmtQty(i.qty)} {i.unit}</td>
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
              <td colSpan={5}>Итого: позиций {items.filter((i) => shipQty(i) > 0).length}</td>
              <td className="right">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && <p className="hint" style={{ marginTop: 10 }}>Если чего-то нет или меньше, чем заказано, поправьте количество «К отгрузке» — магазин увидит изменения.</p>}
      {!isSupplier && o.status === 'shipped' && (
        <p className="hint" style={{ marginTop: 10 }}>«Принять товар» создаст черновик приёмки с этими количествами и ценами. Товары, которых ещё нет в вашей базе, заведутся сами.</p>
      )}

      {confirmCancel && (
        <Confirm title={`Отменить заказ № ${o.number}`} text="Вторая сторона увидит, что заказ отменён. Вернуть его в работу будет нельзя."
          confirmLabel="Отменить заказ" danger busy={busy} onClose={() => setConfirmCancel(false)}
          onConfirm={() => run(() => status('canceled', isSupplier ? { p_comment: reply.trim() || null } : {}), 'Заказ отменён')} />
      )}
    </>
  );
}
