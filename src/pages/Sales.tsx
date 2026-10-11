import { useState } from 'react';
import { dateTime, money } from '../lib/format';
import { useChanged, useQuery, useStored } from '../lib/hooks';
import { useTeamNames } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import type { Sale } from '../lib/types';
import { DataTable, Pager, type Column } from '../ui/DataTable';
import { lastDays, PeriodPicker, periodRange } from '../ui/Period';
import { SaleModal } from './SaleModal';
import { listSalesPage } from '../api/pos';

interface Row extends Sale {
  registers: { name: string } | null;
  contractors: { name: string } | null;
  parent: { number: number } | null;
}

export function Sales({ kind }: { kind: 'sale' | 'return' }) {
  const { org, store } = useWorkspace();
  const teamName = useTeamNames();
  const [period, setPeriod] = useState(lastDays(7));
  const [number, setNumber] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useStored('sauda:sales:pageSize', 50);
  const [open, setOpen] = useState<string | null>(null);

  if (useChanged([kind, period, number, store.id, pageSize]) && page !== 0) setPage(0);

  const list = useQuery(async () => {
    const { from, to } = periodRange(period);
    // номер чека ищется по всем датам: покупатель с чеком приходит и через месяц
    const n = Number(number);
    const byNumber = number.trim() !== '' && Number.isInteger(n);
    return listSalesPage<Row>(org.id, store.id, kind, byNumber ? { number: n } : { from, to }, page, pageSize);
  }, [org.id, store.id, kind, period, number, page, pageSize]);

  const rows = list.data?.rows ?? [];
  const columns: Column<Row>[] = [
    { key: 'number', title: 'Номер', fixed: true, render: (s) => <a>№ {s.number}</a> },
    { key: 'date', title: 'Дата', render: (s) => dateTime(s.created_at) },
    ...(kind === 'return'
      ? [{ key: 'parent', title: 'Чек продажи', render: (s: Row) => (s.parent ? `№ ${s.parent.number}` : '') }]
      : []),
    { key: 'register', title: 'Касса', value: (s) => s.registers?.name ?? '' },
    { key: 'cashier', title: 'Кассир', value: (s) => teamName(s.cashier_id) },
    { key: 'customer', title: 'Покупатель', value: (s) => s.contractors?.name ?? 'Розничный' },
    { key: 'total', title: `Сумма, ${org.currency}`, align: 'right', render: (s) => <b style={{ fontWeight: 600 }}>{money(s.total)}</b> },
    { key: 'cash', title: 'Наличными', align: 'right', render: (s) => money(s.paid_cash) },
    { key: 'card', title: 'Картой', align: 'right', render: (s) => money(s.paid_card) },
    { key: 'discount', title: 'Скидка', align: 'right', render: (s) => (s.discount > 0 ? money(s.discount) : '') },
    { key: 'comment', title: 'Комментарий', optional: true, value: (s) => s.comment },
  ];

  const sum = (f: (s: Row) => number) => money(rows.reduce((a, s) => a + Number(f(s)), 0));

  return (
    <>
      <div className="page-head">
        <h1>{kind === 'sale' ? 'Чеки' : 'Возвраты покупателей'}</h1>
        <span className="muted">{store.name}</span>
      </div>
      <div className="toolbar">
        <PeriodPicker value={period} onChange={setPeriod} />
        <input type="search" placeholder="Номер чека" value={number} onChange={(e) => setNumber(e.target.value)} style={{ width: 150 }} inputMode="numeric" />
      </div>
      <DataTable
        id={`sales-${kind}`}
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        loading={list.loading}
        error={list.error}
        empty={kind === 'sale' ? 'За выбранный период продаж не было' : 'За выбранный период возвратов не было'}
        onRowClick={(s) => setOpen(s.id)}
        footer={{
          number: 'На странице', total: sum((s) => s.total), cash: sum((s) => s.paid_cash),
          card: sum((s) => s.paid_card), discount: sum((s) => s.discount),
        }}
      />
      <Pager page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} />
      {open && <SaleModal saleId={open} onClose={() => setOpen(null)} allowReturn={kind === 'sale'} />}
    </>
  );
}
