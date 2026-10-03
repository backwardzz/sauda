import { useState } from 'react';
import { dateTime, qty } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useTeamNames } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q } from '../lib/supabase';
import { DataTable, type Column } from '../ui/DataTable';
import { lastDays, PeriodPicker, periodRange } from '../ui/Period';

interface Row {
  id: string;
  cashier_id: string | null;
  name: string;
  qty_from: number;
  qty_to: number;
  created_at: string;
  registers: { name: string } | null;
}

export function Canceled() {
  const { org, store } = useWorkspace();
  const teamName = useTeamNames();
  const [period, setPeriod] = useState(lastDays(7));
  const [search, setSearch] = useState('');

  const list = useQuery(() => {
    const { from, to } = periodRange(period);
    return q<Row[]>(
      db.from('canceled_items').select('id, cashier_id, name, qty_from, qty_to, created_at, registers(name)')
        .eq('org_id', org.id).eq('store_id', store.id).gte('created_at', from).lt('created_at', to)
        .order('created_at', { ascending: false }).limit(1000) as never,
    );
  }, [org.id, store.id, period]);

  const rows = (list.data ?? []).filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));

  const columns: Column<Row>[] = [
    { key: 'register', title: 'Касса', value: (r) => r.registers?.name ?? '' },
    { key: 'cashier', title: 'Кассир', sortable: true, value: (r) => teamName(r.cashier_id) },
    { key: 'name', title: 'Название товара', sortable: true, fixed: true, value: (r) => r.name },
    { key: 'time', title: 'Время', sortable: true, value: (r) => r.created_at, render: (r) => dateTime(r.created_at) },
    {
      key: 'qty', title: 'Количество', align: 'right',
      render: (r) => (r.qty_to === 0 ? qty(r.qty_from) : `${qty(r.qty_from)} → ${qty(r.qty_to)}`),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Отменённые товары</h1>
        <span className="muted">Товары, которые кассир добавил в чек, а потом убрал или уменьшил количество</span>
      </div>
      <div className="toolbar">
        <PeriodPicker value={period} onChange={setPeriod} />
        <input className="search" type="search" placeholder="Название товара" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataTable id="canceled" columns={columns} rows={rows} rowKey={(r) => r.id} loading={list.loading} error={list.error}
        empty="За выбранный период отмен не было" />
    </>
  );
}
