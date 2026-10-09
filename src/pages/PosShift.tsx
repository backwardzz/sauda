import { useState } from 'react';
import { fiscalZReport } from '../lib/fiscal';
import { money, parseNum } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { db, q } from '../lib/supabase';
import type { Register, Sale, Shift } from '../lib/types';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';

/** Экран перед началом работы: на кассе нет открытой смены. */
export function OpenShift({ register, currency, onOpened }: { register: Register; currency: string; onOpened: () => void }) {
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      await q(db.rpc('open_shift', { p_register: register.id, p_opening_cash: parseNum(cash) }));
      onOpened();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card stack">
        <div>
          <h1>Открытие смены</h1>
          <p className="muted">{register.name}</p>
        </div>
        <label className="field pay-field">
          <span>Наличные в кассе на начало смены, {currency}</span>
          <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" placeholder="0" autoFocus
            onKeyDown={(e) => e.key === 'Enter' && open()} />
        </label>
        <button className="btn primary large" disabled={busy} onClick={open}>Открыть смену</button>
      </div>
    </div>
  );
}

export function CashOpModal({ shift, currency, onClose }: { shift: Shift; currency: string; onClose: () => void }) {
  const [kind, setKind] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (parseNum(amount) <= 0) return toast.error('Укажите сумму');
    setBusy(true);
    try {
      await q(db.rpc('cash_op', { p_shift: shift.id, p_kind: kind, p_amount: parseNum(amount), p_comment: comment.trim() }));
      toast.ok(kind === 'in' ? 'Внесение записано' : 'Изъятие записано');
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Modal title="Внесение и изъятие наличных" onClose={onClose} width={420}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy} onClick={save}>Записать</button>
        </>
      }>
      <div className="stack">
        <div className="segmented">
          <button className={kind === 'out' ? 'active' : ''} onClick={() => setKind('out')}>Изъятие</button>
          <button className={kind === 'in' ? 'active' : ''} onClick={() => setKind('in')}>Внесение</button>
        </div>
        <label className="field pay-field">
          <span>Сумма, {currency}</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
        </label>
        <label className="field">
          <span>Комментарий</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={kind === 'out' ? 'Инкассация, оплата поставщику' : 'Размен'} />
        </label>
      </div>
    </Modal>
  );
}

interface CloseProps {
  shift: Shift;
  currency: string;
  /** Касса отправляет чеки в Webkassa: перед закрытием снимается Z-отчёт. */
  fiscal?: boolean;
  onClose: () => void;
  onClosed: () => void;
}

export function CloseShiftModal({ shift, currency, fiscal, onClose, onClosed }: CloseProps) {
  const [actual, setActual] = useState('');
  const [busy, setBusy] = useState(false);

  const data = useQuery(async () => {
    const [sales, ops] = await Promise.all([
      q<Pick<Sale, 'kind' | 'total' | 'paid_cash' | 'paid_card'>[]>(db.from('sales').select('kind, total, paid_cash, paid_card').eq('shift_id', shift.id)),
      q<{ kind: 'in' | 'out'; amount: number }[]>(db.from('cash_ops').select('kind, amount').eq('shift_id', shift.id)),
    ]);
    const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + Number(f(x)), 0);
    const sold = sales.filter((s) => s.kind === 'sale');
    const returned = sales.filter((s) => s.kind === 'return');
    const r = {
      receipts: sold.length,
      salesCash: sum(sold, (s) => s.paid_cash),
      salesCard: sum(sold, (s) => s.paid_card),
      returnsCash: sum(returned, (s) => s.paid_cash),
      returnsCard: sum(returned, (s) => s.paid_card),
      cashIn: sum(ops.filter((o) => o.kind === 'in'), (o) => o.amount),
      cashOut: sum(ops.filter((o) => o.kind === 'out'), (o) => o.amount),
    };
    return { ...r, expected: Number(shift.opening_cash) + r.salesCash - r.returnsCash + r.cashIn - r.cashOut };
  }, [shift.id]);

  const d = data.data;
  const diff = d && actual.trim() !== '' ? parseNum(actual) - d.expected : null;

  const close = async () => {
    if (!d) return;
    setBusy(true);
    try {
      // Z-отчёт снимается до закрытия: если Webkassa недоступна, смена в Sauda остаётся открытой
      if (fiscal) await fiscalZReport(shift.id);
      await q(db.rpc('close_shift', { p_shift: shift.id, p_closing_cash: actual.trim() === '' ? d.expected : parseNum(actual) }));
      toast.ok(`Смена № ${shift.number} закрыта`);
      onClosed();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Закрытие смены № ${shift.number}`} onClose={onClose} width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy || !d} onClick={close}>Закрыть смену</button>
        </>
      }>
      {data.error ? (
        <p className="error-text">{data.error}</p>
      ) : !d ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <div className="stack">
          <dl className="kv">
            <dt>Чеков</dt><dd>{d.receipts}</dd>
            <dt>Продажи картой</dt><dd>{money(d.salesCard - d.returnsCard)}</dd>
            <dt>Остаток на начало смены</dt><dd>{money(shift.opening_cash)}</dd>
            <dt>Продажи наличными</dt><dd>{money(d.salesCash)}</dd>
            <dt>Возвраты наличными</dt><dd>{d.returnsCash ? "−" : ""}{money(d.returnsCash)}</dd>
            <dt>Внесения</dt><dd>{money(d.cashIn)}</dd>
            <dt>Изъятия</dt><dd>{d.cashOut ? "−" : ""}{money(d.cashOut)}</dd>
            <dt className="total">Должно быть в кассе</dt><dd className="total">{money(d.expected)} {currency}</dd>
          </dl>
          <label className="field pay-field">
            <span>Фактически в кассе, {currency}</span>
            <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder={money(d.expected)} autoFocus />
          </label>
          {fiscal && <p className="hint">Перед закрытием неотправленные чеки уйдут в Webkassa и будет снят Z-отчёт.</p>}
          {diff != null && diff !== 0 && (
            <p className={diff < 0 ? 'error-text' : 'ok-text'}>
              {diff < 0 ? 'Недостача' : 'Излишек'}: {money(Math.abs(diff))} {currency}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
