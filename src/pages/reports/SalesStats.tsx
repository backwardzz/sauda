import { useState } from 'react';
import { dateTime, marginPct, money, qty } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useTeamNames } from '../../lib/refs';
import { db, q } from '../../lib/supabase';
import type { Sale } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { SaleModal } from '../SaleModal';
import { useReportScope, type SalesRow } from './common';

const TABS = [
  { key: 'product', label: 'По товарам', column: 'Название товара' },
  { key: 'receipt', label: 'По чекам', column: '' },
  { key: 'category', label: 'По категориям', column: 'Категория' },
  { key: 'supplier', label: 'По поставщикам', column: 'Поставщик' },
  { key: 'customer', label: 'По покупателям', column: 'Покупатель' },
] as const;

type Tab = (typeof TABS)[number]['key'];

export function SalesStats() {
  const scope = useReportScope();
  const teamName = useTeamNames();
  const [tab, setTab] = useState<Tab>('product');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const cur = scope.org.currency;

  const grouped = useQuery(
    async () => (tab === 'receipt' ? [] : q<SalesRow[]>(db.rpc('report_sales', { ...scope.args, p_group: tab }))),
    [tab, scope.args.p_org, scope.args.p_from, scope.args.p_to, scope.args.p_store],
  );

  const receipts = useQuery(async () => {
    if (tab !== 'receipt') return [];
    let query = db.from('sales').select('*').eq('org_id', scope.org.id)
      .gte('created_at', scope.range.from).lt('created_at', scope.range.to);
    if (scope.storeId) query = query.eq('store_id', scope.storeId);
    return q<Sale[]>(query.order('created_at', { ascending: false }).limit(2000));
  }, [tab, scope.org.id, scope.range.from, scope.range.to, scope.storeId]);

  const term = search.trim().toLowerCase();
  const rows = (grouped.data ?? [])
    .filter((r) => !term || r.label.toLowerCase().includes(term) || r.barcode.includes(term))
    .sort((a, b) => b.revenue - a.revenue);
  const total = (f: (r: SalesRow) => number) => rows.reduce((s, r) => s + Number(f(r)), 0);

  const meta = TABS.find((t) => t.key === tab)!;
  const columns: Column<SalesRow>[] = [
    { key: 'label', title: meta.column, sortable: true, fixed: true, value: (r) => r.label },
    ...(tab === 'product'
      ? ([
          { key: 'barcode', title: 'Штрихкод', value: (r) => r.barcode },
          { key: 'unit', title: 'Ед. изм', value: (r) => r.unit },
        ] as Column<SalesRow>[])
      : ([{ key: 'receipts', title: 'Чеков', align: 'right', sortable: true, value: (r) => r.receipts }] as Column<SalesRow>[])),
    { key: 'sold', title: 'Продано', align: 'right', sortable: true, value: (r) => r.qty_sold, render: (r) => qty(r.qty_sold) },
    { key: 'returned', title: 'Возвращено', align: 'right', sortable: true, value: (r) => r.qty_returned, render: (r) => (r.qty_returned ? qty(r.qty_returned) : '') },
    { key: 'sales', title: `Сумма продаж, ${cur}`, align: 'right', sortable: true, value: (r) => r.sales_sum, render: (r) => money(r.sales_sum) },
    { key: 'returns', title: `Сумма возвратов, ${cur}`, align: 'right', sortable: true, value: (r) => r.returns_sum, render: (r) => (r.returns_sum ? money(r.returns_sum) : '') },
    { key: 'cost', title: `Сумма себес., ${cur}`, align: 'right', sortable: true, value: (r) => r.cost, render: (r) => money(r.cost) },
    { key: 'profit', title: `Прибыль, ${cur}`, align: 'right', sortable: true, value: (r) => r.profit, render: (r) => <b style={{ fontWeight: 600 }}>{money(r.profit)}</b> },
    { key: 'margin', title: 'Рентабельность, %', align: 'right', sortable: true, value: (r) => marginPct(r.revenue, r.profit) },
    { key: 'discount', title: `Скидки, ${cur}`, align: 'right', optional: true, sortable: true, value: (r) => r.discount, render: (r) => money(r.discount) },
  ];

  const receiptRows = receipts.data ?? [];
  const receiptColumns: Column<Sale>[] = [
    { key: 'number', title: 'Номер', fixed: true, render: (s) => <a>{s.kind === 'return' ? 'Возврат' : 'Чек'} № {s.number}</a> },
    { key: 'date', title: 'Дата', sortable: true, value: (s) => s.created_at, render: (s) => dateTime(s.created_at) },
    { key: 'cashier', title: 'Кассир', value: (s) => teamName(s.cashier_id) },
    { key: 'total', title: `Сумма продаж, ${cur}`, align: 'right', sortable: true, value: (s) => signed(s, s.total), render: (s) => money(signed(s, s.total)) },
    { key: 'cash', title: 'Наличными', align: 'right', render: (s) => money(signed(s, s.paid_cash)) },
    { key: 'card', title: 'Картой', align: 'right', render: (s) => money(signed(s, s.paid_card)) },
    { key: 'discount', title: 'Сумма скидок', align: 'right', render: (s) => (s.discount > 0 ? money(s.discount) : '') },
    { key: 'profit', title: `Прибыль, ${cur}`, align: 'right', sortable: true, value: (s) => signed(s, s.total - s.cost), render: (s) => money(signed(s, s.total - s.cost)) },
  ];
  const rsum = (f: (s: Sale) => number) => money(receiptRows.reduce((a, s) => a + signed(s, Number(f(s))), 0));

  const download = async () => {
    try {
      if (tab === 'receipt') {
        if (!receiptRows.length) return toast.error('Нет данных для выгрузки');
        await exportXlsx(`Чеки ${scope.label}`, 'Чеки', receiptRows.map((s) => ({
          'Номер': s.number, 'Тип': s.kind === 'return' ? 'Возврат' : 'Продажа', 'Дата': dateTime(s.created_at),
          'Кассир': teamName(s.cashier_id), 'Сумма': signed(s, s.total), 'Наличными': signed(s, s.paid_cash),
          'Картой': signed(s, s.paid_card), 'Скидка': s.discount, 'Себестоимость': signed(s, s.cost),
        })));
      } else {
        if (!rows.length) return toast.error('Нет данных для выгрузки');
        await exportXlsx(`Статистика продаж ${meta.label} ${scope.label}`, meta.label, rows.map((r) => ({
          [meta.column]: r.label, ...(tab === 'product' ? { 'Штрихкод': r.barcode, 'Ед. изм': r.unit } : { 'Чеков': r.receipts }),
          'Продано': r.qty_sold, 'Возвращено': r.qty_returned, 'Сумма продаж': r.sales_sum, 'Сумма возвратов': r.returns_sum,
          'Себестоимость': r.cost, 'Прибыль': r.profit, 'Рентабельность, %': marginPct(r.revenue, r.profit),
        })));
      }
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <div className="page-head"><h1>Статистика продаж</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="toolbar">
        {scope.controls}
        {tab !== 'receipt' && (
          <input className="search" type="search" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      {tab === 'receipt' ? (
        <DataTable id="stats-receipts" columns={receiptColumns} rows={receiptRows} rowKey={(s) => s.id} loading={receipts.loading}
          error={receipts.error} empty="За выбранный период чеков нет" onRowClick={(s) => setOpen(s.id)}
          footer={{ number: `Чеков: ${receiptRows.length}`, total: rsum((s) => s.total), cash: rsum((s) => s.paid_cash), card: rsum((s) => s.paid_card), profit: rsum((s) => s.total - s.cost) }} />
      ) : (
        <DataTable id={`stats-${tab}`} columns={columns} rows={rows} rowKey={(r) => r.key || 'none'} loading={grouped.loading}
          error={grouped.error} empty="За выбранный период продаж не было"
          footer={{
            label: 'Итого', sold: qty(total((r) => r.qty_sold)), returned: qty(total((r) => r.qty_returned)),
            sales: money(total((r) => r.sales_sum)), returns: money(total((r) => r.returns_sum)), cost: money(total((r) => r.cost)),
            profit: money(total((r) => r.profit)), margin: marginPct(total((r) => r.revenue), total((r) => r.profit)),
            discount: money(total((r) => r.discount)),
          }} />
      )}
      {open && <SaleModal saleId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Возврат в сводных суммах идёт с минусом. */
function signed(s: Sale, n: number): number {
  return s.kind === 'return' ? -Number(n) : Number(n);
}
