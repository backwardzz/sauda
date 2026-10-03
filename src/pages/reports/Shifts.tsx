import { useState } from 'react';
import { dateTime, money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { db, q } from '../../lib/supabase';
import type { Sale } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';
import { SaleModal } from '../SaleModal';
import { useReportScope } from './common';

export interface ShiftRow {
  id: string;
  number: number;
  register_name: string;
  cashier_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  sales_cash: number;
  sales_card: number;
  returns_cash: number;
  returns_card: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  closing_cash: number | null;
  cost: number;
  profit: number;
  receipts: number;
}

const income = (s: ShiftRow) => Number(s.sales_cash) + Number(s.cash_in);
const outgo = (s: ShiftRow) => Number(s.returns_cash) + Number(s.cash_out);
const diff = (s: ShiftRow) => (s.closing_cash == null ? null : Number(s.closing_cash) - Number(s.expected_cash));

export function ShiftsReport() {
  const scope = useReportScope();
  const [open, setOpen] = useState<ShiftRow | null>(null);
  const [sale, setSale] = useState<string | null>(null);

  const shifts = useQuery(
    () => q<ShiftRow[]>(db.rpc('report_shifts', scope.args)),
    [scope.args.p_org, scope.args.p_from, scope.args.p_to, scope.args.p_store],
  );
  const sales = useQuery(
    async () => (open ? q<Sale[]>(db.from('sales').select('*').eq('shift_id', open.id).order('created_at')) : []),
    [open?.id],
  );

  const rows = shifts.data ?? [];
  const columns: Column<ShiftRow>[] = [
    { key: 'number', title: '№', fixed: true, render: (s) => <a>{s.number}</a> },
    { key: 'register', title: 'Касса', value: (s) => s.register_name },
    { key: 'cashier', title: 'Кассир', value: (s) => s.cashier_name },
    { key: 'opened', title: 'Время открытия', render: (s) => dateTime(s.opened_at) },
    { key: 'closed', title: 'Время закрытия', render: (s) => (s.closed_at ? dateTime(s.closed_at) : <span className="badge ok">Открыта</span>) },
    { key: 'start', title: 'Н. остаток', align: 'right', render: (s) => money(s.opening_cash) },
    { key: 'income', title: 'Приход', align: 'right', render: (s) => money(income(s)) },
    { key: 'outgo', title: 'Расход', align: 'right', render: (s) => money(outgo(s)) },
    { key: 'end', title: 'К. остаток', align: 'right', render: (s) => money(s.expected_cash) },
    {
      key: 'diff', title: 'Разница', align: 'right',
      render: (s) => {
        const d = diff(s);
        if (d == null) return '';
        return <span className={d < 0 ? 'error-text' : d > 0 ? 'ok-text' : ''}>{money(d)}</span>;
      },
    },
    { key: 'card', title: 'Безнал', align: 'right', render: (s) => money(Number(s.sales_card) - Number(s.returns_card)) },
    { key: 'profit', title: 'Прибыль', align: 'right', render: (s) => money(s.profit) },
  ];
  const sum = (f: (s: ShiftRow) => number) => money(rows.reduce((a, s) => a + Number(f(s)), 0));

  const download = async () => {
    if (!rows.length) return toast.error('Нет данных для выгрузки');
    await exportXlsx(`Отчёт по сменам ${scope.label}`, 'Смены', rows.map((s) => ({
      '№': s.number, 'Касса': s.register_name, 'Кассир': s.cashier_name, 'Открыта': dateTime(s.opened_at),
      'Закрыта': s.closed_at ? dateTime(s.closed_at) : '', 'Н. остаток': s.opening_cash, 'Приход': income(s), 'Расход': outgo(s),
      'К. остаток': s.expected_cash, 'Фактически': s.closing_cash ?? '', 'Разница': diff(s) ?? '',
      'Безнал': Number(s.sales_card) - Number(s.returns_card), 'Прибыль': s.profit, 'Чеков': s.receipts,
    }))).catch(toast.error);
  };

  const saleColumns: Column<Sale>[] = [
    { key: 'number', title: 'Номер', fixed: true, render: (s) => <a>{s.kind === 'return' ? 'Возврат' : 'Чек'} № {s.number}</a> },
    { key: 'time', title: 'Время', render: (s) => dateTime(s.created_at) },
    { key: 'cash', title: 'Наличными', align: 'right', render: (s) => money(s.paid_cash) },
    { key: 'card', title: 'Картой', align: 'right', render: (s) => money(s.paid_card) },
    { key: 'total', title: 'Сумма', align: 'right', render: (s) => (s.kind === 'return' ? `−${money(s.total)}` : money(s.total)) },
  ];

  return (
    <>
      <div className="page-head"><h1>Отчёты по сменам</h1></div>
      <div className="toolbar">
        {scope.controls}
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>
      <DataTable id="shifts" columns={columns} rows={rows} rowKey={(s) => s.id} loading={shifts.loading} error={shifts.error}
        empty="За выбранный период смен не было" onRowClick={setOpen}
        footer={{ number: 'Итого', income: sum(income), outgo: sum(outgo), card: sum((s) => Number(s.sales_card) - Number(s.returns_card)), profit: sum((s) => s.profit) }} />

      {open && (
        <Modal title={`Смена № ${open.number} · ${open.register_name} · ${open.cashier_name}`} onClose={() => setOpen(null)} width={860}
          footer={<button className="btn" onClick={() => setOpen(null)}>Закрыть</button>}>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="card pad">
              <div className="section-title">Наличные в кассе</div>
              <dl className="kv">
                <dt>Остаток на начало смены</dt><dd>{money(open.opening_cash)}</dd>
                <dt>Продажи наличными</dt><dd>{money(open.sales_cash)}</dd>
                <dt>Внесения</dt><dd>{money(open.cash_in)}</dd>
                <dt>Возвраты наличными</dt><dd>{Number(open.returns_cash) ? "−" : ""}{money(open.returns_cash)}</dd>
                <dt>Изъятия</dt><dd>{Number(open.cash_out) ? "−" : ""}{money(open.cash_out)}</dd>
                <dt className="total">Остаток на конец смены</dt><dd className="total">{money(open.expected_cash)}</dd>
                {open.closing_cash != null && (
                  <>
                    <dt>Фактически в кассе</dt><dd>{money(open.closing_cash)}</dd>
                    <dt>Разница</dt><dd>{money(diff(open))}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="card pad">
              <div className="section-title">Выручка</div>
              <dl className="kv">
                <dt>Наличными</dt><dd>{money(Number(open.sales_cash) - Number(open.returns_cash))}</dd>
                <dt>Безналичными</dt><dd>{money(Number(open.sales_card) - Number(open.returns_card))}</dd>
                <dt>Себестоимость</dt><dd>{money(open.cost)}</dd>
                <dt className="total">Валовая прибыль</dt><dd className="total">{money(open.profit)}</dd>
                <dt>Чеков</dt><dd>{open.receipts}</dd>
                <dt>Открыта</dt><dd>{dateTime(open.opened_at)}</dd>
                <dt>Закрыта</dt><dd>{open.closed_at ? dateTime(open.closed_at) : 'ещё открыта'}</dd>
              </dl>
            </div>
          </div>
          <DataTable id="shift-sales" columns={saleColumns} rows={sales.data ?? []} rowKey={(s) => s.id} loading={sales.loading}
            error={sales.error} empty="В этой смене продаж не было" onRowClick={(s) => setSale(s.id)} />
        </Modal>
      )}
      {sale && <SaleModal saleId={sale} onClose={() => setSale(null)} />}
    </>
  );
}
