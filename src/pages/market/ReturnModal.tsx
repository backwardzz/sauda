import { useState } from 'react';
import { money, parseNum, qty as fmtQty, round2 } from '../../lib/format';
import { RETURN_REASON, type Order, type OrderItem, type ReturnReason } from '../../lib/types';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';
import { useAction } from '../../ui/useAction';
import { createOrderReturn } from '../../api/market';

interface Props {
  order: Order;
  items: OrderItem[];
  /** Сколько по строке заказа ещё можно вернуть: привезли минус уже оформленные возвраты. */
  left: (i: OrderItem) => number;
  currency: string;
  onClose: () => void;
  onDone: (returnId: string) => void;
}

/** Оформление возврата по принятому заказу: что вернуть, сколько и почему. */
export function ReturnModal({ order, items, left, currency, onClose, onDone }: Props) {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<ReturnReason | ''>('');
  const [comment, setComment] = useState('');
  const [busy, act] = useAction();

  const rows = items.filter((i) => left(i) > 0);
  const back = (i: OrderItem) => Math.max(parseNum(qtys[i.id] ?? ''), 0);
  const over = rows.filter((i) => back(i) > left(i));
  const picked = rows.filter((i) => back(i) > 0);
  const total = round2(picked.reduce((s, i) => s + back(i) * Number(i.price), 0));

  const save = () =>
    act(async () => {
      const id = await createOrderReturn(order.id, reason, comment.trim(), picked.map((i) => ({ itemId: i.id, qty: back(i) })));
      toast.ok('Возврат отправлен компании: дождитесь ответа');
      onDone(id);
    }, { keepBusy: true });

  return (
    <Modal title={`Вернуть товар по заказу № ${order.number}`} onClose={onClose} width={720}
      footer={
        <>
          <span className="muted grow">{picked.length ? `Позиций ${picked.length} на ${money(total)} ${currency}` : 'Укажите количество у товаров, которые возвращаете'}</span>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy || !picked.length || over.length > 0 || !reason} onClick={save}>Отправить компании</button>
        </>
      }>
      <div className="stack">
        <div className="filter-grid">
          <label className="field">
            <span>Причина</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
              <option value="" disabled>Выберите причину</option>
              {(Object.keys(RETURN_REASON) as ReturnReason[]).map((k) => <option key={k} value={k}>{RETURN_REASON[k]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Комментарий для компании</span>
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что не так с товаром" />
          </label>
        </div>
        <div className="table-wrap">
          <table className="table doc-lines">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="right">Можно вернуть</th>
                <th className="right">Возвращаю</th>
                <th className="right">Цена, {currency}</th>
                <th className="right">Сумма, {currency}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={back(i) > left(i) ? 'row-neg' : ''}>
                  <td>{i.name}<div className="muted num">{i.barcode}</div></td>
                  <td className="right">
                    <button type="button" className="link-btn" title="Вернуть всё" onClick={() => setQtys({ ...qtys, [i.id]: String(left(i)) })}>{fmtQty(left(i))} {i.unit}</button>
                  </td>
                  <td className="right">
                    <input className="num-input" value={qtys[i.id] ?? ''} inputMode="decimal" placeholder="0" aria-label={`Возвращаю: ${i.name}`}
                      onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })} />
                  </td>
                  <td className="right">{money(i.price)}</td>
                  <td className="right">{back(i) > 0 ? money(back(i) * Number(i.price)) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {over.length > 0 && <p className="error-text">Нельзя вернуть больше, чем привезли: {over.map((i) => i.name).join(', ')}.</p>}
        <p className="muted">Компания ответит на возврат. Остатки магазина изменятся, когда вы отдадите товар.</p>
      </div>
    </Modal>
  );
}
