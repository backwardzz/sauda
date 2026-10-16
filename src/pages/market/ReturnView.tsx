import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dateTime, money, qty as fmtQty } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { RETURN_REASON, RETURN_STATUS } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { Icon } from '../../ui/Icon';
import { Confirm, Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';
import { useAction } from '../../ui/useAction';
import { getReturn, setReturnStatus } from '../../api/market';

const STEPS = ['new', 'accepted', 'sent', 'received'] as const;

type Ask = 'accept' | 'reject' | 'send' | 'receive' | 'cancel';

export function ReturnView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { org, canManage } = useOrg();
  const [busy, act] = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reply, setReply] = useState('');
  const [restock, setRestock] = useState(true);

  const data = useQuery(
    () => getReturn(id),
    [id],
  );
  const r = data.data;

  if (data.loading && !r) return <div className="empty">Загрузка…</div>;
  if (!r) return <div className="empty">Возврат не найден</div>;

  const isSupplier = r.supplier_org === org.id;
  const items = [...r.order_return_items].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const closed = r.status === 'rejected' || r.status === 'canceled';
  const step = STEPS.indexOf(r.status as (typeof STEPS)[number]);
  const stamps = [r.created_at, r.accepted_at, r.sent_at, r.received_at];

  const open = (a: Ask) => {
    setReply('');
    // брак и просрочку в продажу не возвращают
    setRestock(r.reason !== 'defect' && r.reason !== 'expired');
    setAsk(a);
  };
  const run = (status: string, ok: string, extra: Record<string, unknown> = {}) =>
    act(async () => {
      await setReturnStatus(r.id, status, extra);
      toast.ok(ok);
      setAsk(null);
      data.reload();
    });

  const download = () =>
    exportXlsx(`Возврат № ${r.number} ${isSupplier ? r.store_org_name : r.supplier_name}`, 'Возврат', items.map((i) => ({
      'Товар': i.name, 'Штрихкод': i.barcode, 'Ед. изм': i.unit, 'Количество': Number(i.qty), 'Цена': Number(i.price), 'Сумма': Math.round(Number(i.qty) * Number(i.price) * 100) / 100,
    }))).catch(toast.error);

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/order-returns')} aria-label="К списку возвратов"><Icon name="back" /></button>
        <h1>Возврат № {r.number}</h1>
        <span className={`badge ${RETURN_STATUS[r.status].badge}`}>{RETURN_STATUS[r.status].label}</span>
        <span className="muted">{isSupplier ? `${r.store_org_name} · ${r.store_name}` : r.supplier_name}</span>
      </div>

      {!closed && (
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`step ${i <= step ? 'done' : ''} ${i === step ? 'current' : ''}`}>
              <span className="step-dot">{i < step || r.status === 'received' ? <Icon name="check" size={13} /> : i + 1}</span>
              <div>
                <b>{RETURN_STATUS[s].label}</b>
                <div className="muted">{stamps[i] && i <= step ? dateTime(stamps[i]) : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        {isSupplier && r.status === 'new' && <button className="btn primary" disabled={busy} onClick={() => open('accept')}>Согласиться на возврат</button>}
        {isSupplier && r.status === 'new' && <button className="btn danger" disabled={busy} onClick={() => open('reject')}>Отклонить</button>}
        {isSupplier && r.status === 'sent' && <button className="btn primary" disabled={busy} onClick={() => open('receive')}>Товар получен</button>}
        {!isSupplier && canManage && r.status === 'accepted' && <button className="btn primary" disabled={busy} onClick={() => open('send')}>Товар отдан</button>}
        {!isSupplier && canManage && (r.status === 'new' || r.status === 'accepted') && (
          <button className="btn danger" disabled={busy} onClick={() => open('cancel')}>Отменить возврат</button>
        )}
        <Link className="btn" to={`/orders/${r.order_id}`}>Заказ № {r.order_number}</Link>
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      <div className="card filter-grid">
        {isSupplier
          ? <div className="field"><span>Магазин</span><div>{r.store_org_name} · {r.store_name}</div></div>
          : <div className="field"><span>Компания</span><div><Link to={`/market/${r.supplier_org}`}>{r.supplier_name}</Link></div></div>}
        {r.branch_name && <div className="field"><span>{isSupplier ? 'Филиал' : 'Принимает филиал'}</span><div>{r.branch_name}</div></div>}
        <div className="field"><span>Причина</span><div>{RETURN_REASON[r.reason]}</div></div>
        {r.comment && <div className="field"><span>Комментарий магазина</span><div>{r.comment}</div></div>}
        {r.supplier_comment && <div className="field"><span>Ответ компании</span><div>{r.supplier_comment}</div></div>}
        {isSupplier && r.status === 'received' && (
          <div className="field"><span>Склад</span><div>{r.restocked ? 'Товар вернулся в остаток филиала' : 'В остаток не возвращён'}</div></div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table doc-lines">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Штрихкод</th>
              <th className="right">Возвращается</th>
              <th className="right">Цена, {org.currency}</th>
              <th className="right">Сумма, {org.currency}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="num">{i.barcode}</td>
                <td className="right">{fmtQty(i.qty)} {i.unit}</td>
                <td className="right">{money(i.price)}</td>
                <td className="right">{money(Number(i.qty) * Number(i.price))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Итого: позиций {items.length}</td>
              <td className="right">{money(r.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!isSupplier && r.status === 'accepted' && (
        <p className="hint" style={{ marginTop: 10 }}>Когда представитель компании заберёт товар, нажмите «Товар отдан» — он спишется с остатков магазина.</p>
      )}
      {!isSupplier && r.status === 'received' && (
        <p className="hint" style={{ marginTop: 10 }}>Компания получила товар. Деньги или зачёт по этому возврату вы согласуете с компанией сами: в расчётах Sauda он пока не учитывается.</p>
      )}

      {ask === 'accept' && (
        <Modal title={`Согласиться на возврат № ${r.number}`} onClose={() => setAsk(null)} width={480}
          footer={
            <>
              <button className="btn" onClick={() => setAsk(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={() => run('accepted', 'Возврат согласован: магазин подготовит товар', { p_comment: reply.trim() || null })}>Согласиться</button>
            </>
          }>
          <div className="stack">
            <p>Магазин ({r.store_org_name}) увидит, что вы заберёте товар: позиций {items.length} на {money(r.total)} {org.currency}.</p>
            <label className="field">
              <span>Ответ магазину</span>
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Когда заберём, как вернём деньги" />
            </label>
          </div>
        </Modal>
      )}
      {ask === 'reject' && (
        <Modal title={`Отклонить возврат № ${r.number}`} onClose={() => setAsk(null)} width={480}
          footer={
            <>
              <button className="btn" onClick={() => setAsk(null)}>Отмена</button>
              <button className="btn danger" disabled={busy || !reply.trim()} onClick={() => run('rejected', 'Возврат отклонён', { p_comment: reply.trim() })}>Отклонить</button>
            </>
          }>
          <div className="stack">
            <p>Товар останется у магазина. Вернуть возврат в работу будет нельзя — магазину придётся оформить новый.</p>
            <label className="field">
              <span>Почему отклонён</span>
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Магазин увидит это объяснение" autoFocus />
            </label>
          </div>
        </Modal>
      )}
      {ask === 'receive' && (
        <Modal title={`Получен товар по возврату № ${r.number}`} onClose={() => setAsk(null)} width={480}
          footer={
            <>
              <button className="btn" onClick={() => setAsk(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={() => run('received', restock ? 'Товар получен и вернулся на склад' : 'Товар получен', { p_restock: restock })}>Товар получен</button>
            </>
          }>
          <div className="stack">
            <p>Возврат будет закрыт: позиций {items.length} на {money(r.total)} {org.currency}. Отменить это будет нельзя.</p>
            <label className="check-row">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
              Вернуть товар в остаток{r.branch_name && <> ({r.branch_name})</>}
            </label>
            <p className="muted">Снимите отметку, если товар нельзя продавать: брак, истёкший срок. Остаток меняется только у товаров с учётом склада.</p>
          </div>
        </Modal>
      )}
      {ask === 'send' && (
        <Confirm title={`Товар по возврату № ${r.number} отдан`} busy={busy} onClose={() => setAsk(null)} confirmLabel="Товар отдан"
          onConfirm={() => run('sent', 'Товар списан с остатков магазина: компания подтвердит получение')}
          text={<>Товар спишется с остатков магазина: позиций {items.length} на {money(r.total)} {org.currency}. Отменить возврат после этого будет нельзя.</>} />
      )}
      {ask === 'cancel' && (
        <Confirm title={`Отменить возврат № ${r.number}`} text="Компания увидит, что возврат отменён. Товар останется у вас."
          confirmLabel="Отменить возврат" danger busy={busy} onClose={() => setAsk(null)}
          onConfirm={() => run('canceled', 'Возврат отменён')} />
      )}
    </>
  );
}
