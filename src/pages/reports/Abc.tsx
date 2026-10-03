import { useMemo, useState } from 'react';
import { money, qty } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { grade, type Grade } from '../../lib/abc';
import { db, q } from '../../lib/supabase';
import { exportXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { useReportScope, type SalesRow } from './common';

interface AbcRow extends SalesRow {
  n: number;
  byRevenue: Grade;
  byProfit: Grade;
}

const BADGE: Record<Grade, string> = { A: 'ok', B: 'warn', C: '' };

export function AbcReport() {
  const scope = useReportScope(90);
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<Grade | ''>('');

  const data = useQuery(
    () => q<SalesRow[]>(db.rpc('report_sales', { ...scope.args, p_group: 'product' })),
    [scope.args.p_org, scope.args.p_from, scope.args.p_to, scope.args.p_store],
  );

  const all = useMemo<AbcRow[]>(() => {
    const src = (data.data ?? []).map((r) => ({ ...r, revenue: Number(r.revenue), profit: Number(r.profit) }));
    const byRevenue = grade(src, (r) => r.revenue);
    const byProfit = grade(src, (r) => r.profit);
    return src
      .sort((a, b) => b.revenue - a.revenue)
      .map((r, i) => ({ ...r, n: i + 1, byRevenue: byRevenue.get(r.key)!, byProfit: byProfit.get(r.key)! }));
  }, [data.data]);

  const term = search.trim().toLowerCase();
  const rows = all.filter(
    (r) => (!only || r.byRevenue === only) && (!term || r.label.toLowerCase().includes(term) || r.barcode.includes(term)),
  );
  const count = (g: Grade) => all.filter((r) => r.byRevenue === g).length;

  const columns: Column<AbcRow>[] = [
    { key: 'n', title: '№', value: (r) => r.n, sortable: true },
    { key: 'name', title: 'Товар', fixed: true, sortable: true, value: (r) => r.label },
    { key: 'barcode', title: 'Штрихкод', optional: true, value: (r) => r.barcode },
    { key: 'qty', title: 'Кол-во продаж', align: 'right', sortable: true, value: (r) => r.qty_sold - r.qty_returned, render: (r) => qty(r.qty_sold - r.qty_returned) },
    { key: 'cost', title: 'Сумма продаж по с/с', align: 'right', sortable: true, value: (r) => r.cost, render: (r) => money(r.cost) },
    { key: 'revenue', title: 'Сумма продаж по р/ц', align: 'right', sortable: true, value: (r) => r.revenue, render: (r) => money(r.revenue) },
    { key: 'abcRevenue', title: 'ABC по р/ц', align: 'center', sortable: true, value: (r) => r.byRevenue, render: (r) => <span className={`badge ${BADGE[r.byRevenue]}`}>{r.byRevenue}</span> },
    { key: 'profit', title: 'Прибыль', align: 'right', sortable: true, value: (r) => r.profit, render: (r) => money(r.profit) },
    { key: 'abcProfit', title: 'ABC по прибыли', align: 'center', sortable: true, value: (r) => r.byProfit, render: (r) => <span className={`badge ${BADGE[r.byProfit]}`}>{r.byProfit}</span> },
    { key: 'sum', title: 'Свод', align: 'center', sortable: true, value: (r) => r.byRevenue + r.byProfit, render: (r) => <b>{r.byRevenue}{r.byProfit}</b> },
  ];

  const download = () => {
    if (!rows.length) return toast.error('Нет данных для выгрузки');
    exportXlsx(`ABC-анализ ${scope.label}`, 'ABC', rows.map((r) => ({
      '№': r.n, 'Товар': r.label, 'Штрихкод': r.barcode, 'Кол-во продаж': r.qty_sold - r.qty_returned, 'Сумма по с/с': r.cost,
      'Сумма по р/ц': r.revenue, 'ABC по р/ц': r.byRevenue, 'Прибыль': r.profit, 'ABC по прибыли': r.byProfit, 'Свод': r.byRevenue + r.byProfit,
    }))).catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>ABC-анализ</h1>
        <span className="muted">A — товары, дающие 80% продаж, B — следующие 15%, C — оставшиеся 5%</span>
      </div>
      <div className="toolbar">
        {scope.controls}
        <div className="segmented">
          <button className={only === '' ? 'active' : ''} onClick={() => setOnly('')}>Все {all.length}</button>
          {(['A', 'B', 'C'] as Grade[]).map((g) => (
            <button key={g} className={only === g ? 'active' : ''} onClick={() => setOnly(g)}>{g} · {count(g)}</button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Код продукта / название" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>
      <DataTable id="abc" columns={columns} rows={rows} rowKey={(r) => r.key} loading={data.loading} error={data.error}
        empty="За выбранный период продаж не было" />
    </>
  );
}
