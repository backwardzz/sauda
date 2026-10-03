import { useEffect, useState } from 'react';
import { dateTime, money, parseNum, qty as fmtQty, round2, round3 } from '../lib/format';
import { db, q } from '../lib/supabase';
import type { Shift } from '../lib/types';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';
import { SALE_SELECT, type SaleFull } from './SaleModal';

interface Props {
  orgId: string;
  shift: Shift;
  currency: string;
  /** Чек, открытый из кабинета кнопкой «Оформить возврат». */
  saleId?: string | null;
  onClose: () => void;
  onDone: (returnId: string) => void;
}

export function PosReturn({ orgId, shift, currency, saleId, onClose, onDone }: Props) {
  const [number, setNumber] = useState('');
  const [sale, setSale] = useState<SaleFull | null>(null);
  const [returned, setReturned] = useState<Record<string, number>>({});
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [toCard, setToCard] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (by: { id: string } | { number: number }) => {
    setBusy(true);
    try {
      let query = db.from('sales').select(SALE_SELECT).eq('org_id', orgId).eq('kind', 'sale');
      query = 'id' in by ? query.eq('id', by.id) : query.eq('number', by.number);
      const found = await q<SaleFull | null>(query.maybeSingle() as never);
      if (!found) return toast.error('Чек с таким номером не найден');
      const prior = await q<{ parent_item_id: string; qty: number }[]>(
        db.from('sale_items').select('parent_item_id, qty').in('parent_item_id', found.sale_items.map((i) => i.id)),
      );
      const map: Record<string, number> = {};
      for (const r of prior) map[r.parent_item_id] = (map[r.parent_item_id] ?? 0) + Number(r.qty);
      setReturned(map);
      setQtys({});
      setToCard(Number(found.paid_cash) === 0 && Number(found.paid_card) > 0);
      setSale(found);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (saleId) void load({ id: saleId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const left = (id: string, sold: number) => round3(sold - (returned[id] ?? 0));
  const lines = (sale?.sale_items ?? []).map((i) => {
    const max = left(i.id, Number(i.qty));
    const take = Math.min(Math.max(parseNum(qtys[i.id]), 0), max);
    return { item: i, max, take, sum: round2((Number(i.total) * take) / Number(i.qty)) };
  });
  const total = round2(lines.reduce((s, l) => s + l.sum, 0));
  const nothingLeft = !!sale && lines.every((l) => l.max <= 0);

  const submit = async () => {
    if (!sale) return;
    const items = lines.filter((l) => l.take > 0).map((l) => ({ item_id: l.item.id, qty: l.take }));
    if (!items.length) return toast.error('Укажите количество к возврату');
    setBusy(true);
    try {
      const res = await q<{ id: string; number: number; total: number }>(
        db.rpc('create_return', { p_shift: shift.id, p_sale: sale.id, p_items: items, p_refund_card: toCard ? total : 0 }),
      );
      toast.ok(`Возврат № ${res.number} на ${money(res.total)} ${currency}`);
      onDone(res.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={sale ? `Возврат по чеку № ${sale.number} от ${dateTime(sale.created_at)}` : 'Возврат покупателя'}
      onClose={onClose}
      width={760}
      footer={
        sale ? (
          <>
            <button className="btn" onClick={() => setSale(null)}>Другой чек</button>
            <span className="spacer" />
            <b className="num" style={{ alignSelf: 'center' }}>К возврату: {money(total)} {currency}</b>
            <button className="btn primary" disabled={busy || total <= 0} onClick={submit}>Оформить возврат</button>
          </>
        ) : undefined
      }
    >
      {!sale ? (
        <div className="stack">
          <label className="field pay-field">
            <span>Номер чека продажи</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" autoFocus
              onKeyDown={(e) => e.key === 'Enter' && Number(number) > 0 && load({ number: Number(number) })} />
          </label>
          <button className="btn primary large" disabled={busy || !(Number(number) > 0)} onClick={() => load({ number: Number(number) })}>
            Найти чек
          </button>
          <p className="hint">Номер напечатан в шапке чека. Его же видно в кабинете в разделе «Продажи → Чеки».</p>
        </div>
      ) : (
        <div className="stack">
          {nothingLeft && <p className="error-text">По этому чеку уже всё возвращено.</p>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="right">Продано</th>
                  <th className="right">Уже возвращено</th>
                  <th className="right">Вернуть</th>
                  <th className="right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ item, max, sum }) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="right">{fmtQty(item.qty)} {item.unit}</td>
                    <td className="right">{returned[item.id] ? fmtQty(returned[item.id]) : ''}</td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <input className="num-input" style={{ width: 80 }} value={qtys[item.id] ?? ''} disabled={max <= 0} placeholder="0"
                          inputMode="decimal" onChange={(e) => setQtys({ ...qtys, [item.id]: e.target.value })} aria-label={`Вернуть: ${item.name}`} />
                        <button className="btn small" disabled={max <= 0} onClick={() => setQtys({ ...qtys, [item.id]: String(max) })}>Всё</button>
                      </div>
                    </td>
                    <td className="right">{sum > 0 ? money(sum) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row wrap">
            <button className="btn" disabled={nothingLeft}
              onClick={() => setQtys(Object.fromEntries(lines.map((l) => [l.item.id, String(l.max)])))}>
              Вернуть весь чек
            </button>
            <span className="spacer" />
            <span className="muted">Деньги вернуть</span>
            <div className="segmented">
              <button className={!toCard ? 'active' : ''} onClick={() => setToCard(false)}>Наличными</button>
              <button className={toCard ? 'active' : ''} onClick={() => setToCard(true)}>На карту</button>
            </div>
          </div>
          <p className="hint">
            Чек оплачен: наличными {money(sale.paid_cash)}, картой {money(sale.paid_card)}. Товар вернётся на склад этого магазина.
          </p>
        </div>
      )}
    </Modal>
  );
}
