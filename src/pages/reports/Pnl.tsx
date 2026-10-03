import { money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { db, q } from '../../lib/supabase';
import { exportXlsx } from '../../lib/xlsx';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { useReportScope } from './common';

interface Pnl {
  sales_cash: number;
  sales_card: number;
  returns_sum: number;
  discount: number;
  cost_sold: number;
  cost_returned: number;
  writeoffs: number;
  /** Излишки минус недостача по проведённым инвентаризациям. */
  inventory: number;
  receipts: number;
}

export function PnlReport() {
  const scope = useReportScope();
  const data = useQuery(
    async () => (await q<Pnl[]>(db.rpc('report_pnl', scope.args)))[0],
    [scope.args.p_org, scope.args.p_from, scope.args.p_to, scope.args.p_store],
  );

  const p = data.data;
  const sales = p ? Number(p.sales_cash) + Number(p.sales_card) : 0;
  const revenue = p ? sales - Number(p.returns_sum) : 0;
  const cost = p ? Number(p.cost_sold) - Number(p.cost_returned) : 0;
  const gross = revenue - cost;
  const net = gross - Number(p?.writeoffs ?? 0) + Number(p?.inventory ?? 0);
  const cur = scope.org.currency;

  const lines: { label: string; value: number; kind?: 'head' | 'sub' | 'result' }[] = p
    ? [
        { label: 'Выручка', value: revenue, kind: 'head' },
        { label: 'Продажи наличными', value: Number(p.sales_cash), kind: 'sub' },
        { label: 'Продажи безналичными', value: Number(p.sales_card), kind: 'sub' },
        { label: 'Возвраты', value: -Number(p.returns_sum), kind: 'sub' },
        { label: 'Себестоимость', value: -cost, kind: 'head' },
        { label: 'Себестоимость проданных товаров', value: -Number(p.cost_sold), kind: 'sub' },
        { label: 'Себестоимость возвращённых товаров', value: Number(p.cost_returned), kind: 'sub' },
        { label: 'Валовая прибыль', value: gross, kind: 'head' },
        { label: 'Списания товаров', value: -Number(p.writeoffs), kind: 'head' },
        { label: 'Инвентаризации: излишки минус недостача', value: Number(p.inventory), kind: 'head' },
        { label: 'Чистая прибыль', value: net, kind: 'result' },
      ]
    : [];

  const download = () => {
    if (!p) return;
    exportXlsx(`Прибыли и убытки ${scope.label}`, 'P&L', lines.map((l) => ({ 'Показатель': l.label, [`Сумма, ${cur}`]: l.value })))
      .catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>Прибыли и убытки</h1>
        {p && <span className="muted">Чеков: {p.receipts}, скидок выдано на {money(p.discount)} {cur}</span>}
      </div>
      <div className="toolbar">
        {scope.controls}
        <span className="spacer" />
        <button className="btn" onClick={download} disabled={!p}><Icon name="download" size={16} />Скачать</button>
      </div>
      {data.error ? (
        <div className="card empty error-text">{data.error}</div>
      ) : !p ? (
        <div className="card empty">Загрузка…</div>
      ) : (
        <div className="card pnl">
          {lines.map((l) => (
            <div key={l.label} className={`pnl-row ${l.kind ?? ''}`}>
              <span>{l.label}</span>
              <span className={`num ${l.kind === 'result' ? (l.value < 0 ? 'error-text' : 'ok-text') : ''}`}>
                {l.value < 0 ? '−' : ''}{money(Math.abs(l.value))} {cur}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginTop: 10, maxWidth: 720 }}>
        Себестоимость считается по закупочной цене товара на момент продажи. Аренда, зарплата и другие расходы вне кассы в отчёт не входят.
      </p>
    </>
  );
}
