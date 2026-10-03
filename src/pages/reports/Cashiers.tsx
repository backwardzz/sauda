import { money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { db, q } from '../../lib/supabase';
import { DataTable, type Column } from '../../ui/DataTable';
import { useReportScope } from './common';

interface Row {
  cashier_id: string | null;
  cashier_name: string;
  sales_sum: number;
  card_sum: number;
  cash_sum: number;
  returns_sum: number;
  total: number;
  receipts: number;
}

export function CashiersReport() {
  const scope = useReportScope();
  const data = useQuery(
    () => q<Row[]>(db.rpc('report_cashiers', scope.args)),
    [scope.args.p_org, scope.args.p_from, scope.args.p_to, scope.args.p_store],
  );
  const rows = data.data ?? [];
  const sum = (f: (r: Row) => number) => money(rows.reduce((a, r) => a + Number(f(r)), 0));

  const columns: Column<Row>[] = [
    { key: 'name', title: 'Имя', fixed: true, sortable: true, value: (r) => r.cashier_name },
    { key: 'receipts', title: 'Чеков', align: 'right', sortable: true, value: (r) => r.receipts },
    { key: 'sales', title: 'Сумма по продажам', align: 'right', sortable: true, value: (r) => r.sales_sum, render: (r) => money(r.sales_sum) },
    { key: 'cash', title: 'Наличные', align: 'right', sortable: true, value: (r) => r.cash_sum, render: (r) => money(r.cash_sum) },
    { key: 'card', title: 'Безнал', align: 'right', sortable: true, value: (r) => r.card_sum, render: (r) => money(r.card_sum) },
    { key: 'returns', title: 'Возврат', align: 'right', sortable: true, value: (r) => r.returns_sum, render: (r) => money(r.returns_sum) },
    { key: 'total', title: 'Итого', align: 'right', sortable: true, value: (r) => r.total, render: (r) => <b style={{ fontWeight: 600 }}>{money(r.total)}</b> },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Отчёты по кассирам</h1>
        <span className="muted">Итого = сумма продаж − сумма возвратов</span>
      </div>
      <div className="toolbar">{scope.controls}</div>
      <DataTable id="cashiers" columns={columns} rows={rows} rowKey={(r) => r.cashier_id ?? 'none'} loading={data.loading}
        error={data.error} empty="За выбранный период продаж не было"
        footer={{
          name: 'Итого', receipts: rows.reduce((a, r) => a + Number(r.receipts), 0), sales: sum((r) => r.sales_sum),
          cash: sum((r) => r.cash_sum), card: sum((r) => r.card_sum), returns: sum((r) => r.returns_sum), total: sum((r) => r.total),
        }} />
    </>
  );
}
