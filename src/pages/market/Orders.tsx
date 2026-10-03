import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dateTime, money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ORDER_STATUS, type Order, type OrderStatus } from '../../lib/types';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';

type Filter = 'active' | 'all' | OrderStatus;

/** Заказы: магазин видит свои заказы поставщикам, поставщик — заказы магазинов. */
export function Orders() {
  const { org, store } = useOrg();
  const navigate = useNavigate();
  const isSupplier = org.kind === 'supplier';
  const [filter, setFilter] = useState<Filter>('active');

  const orders = useQuery(() => {
    let query = db.from('orders').select('*').eq(isSupplier ? 'supplier_org' : 'store_org', org.id);
    if (!isSupplier && store) query = query.eq('store_id', store.id);
    return q<Order[]>(query.order('created_at', { ascending: false }).limit(500));
  }, [org.id, isSupplier, store?.id]);

  const all = orders.data ?? [];
  const rows = all.filter((o) => (filter === 'all' ? true : filter === 'active' ? ['new', 'confirmed', 'shipped'].includes(o.status) : o.status === filter));
  const count = (s: OrderStatus) => all.filter((o) => o.status === s).length;

  const columns: Column<Order>[] = [
    { key: 'number', title: 'Номер', fixed: true, render: (o) => <a>№ {o.number}</a> },
    { key: 'date', title: 'Дата', sortable: true, value: (o) => o.created_at, render: (o) => dateTime(o.created_at) },
    {
      key: 'status', title: 'Статус',
      render: (o) => <span className={`badge ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>,
    },
    isSupplier
      ? { key: 'party', title: 'Магазин', sortable: true, value: (o) => o.store_org_name, render: (o) => <>{o.store_org_name}<div className="muted">{[o.store_name, o.store_address].filter(Boolean).join(', ')}</div></> }
      : { key: 'party', title: 'Поставщик', sortable: true, value: (o) => o.supplier_name },
    { key: 'comment', title: 'Комментарий', value: (o) => o.comment },
    { key: 'total', title: `Сумма, ${org.currency}`, align: 'right', sortable: true, value: (o) => Number(o.total), render: (o) => <b style={{ fontWeight: 600 }}>{money(o.total)}</b> },
  ];

  const hint = isSupplier
    ? { new: 'ждут подтверждения', confirmed: 'ждут отгрузки', shipped: 'в пути' }
    : { new: 'ждут ответа поставщика', confirmed: 'поставщик собирает', shipped: 'можно принимать' };

  return (
    <>
      <div className="page-head">
        <h1>{isSupplier ? 'Заказы магазинов' : 'Мои заказы'}</h1>
        {!isSupplier && store && <span className="muted">{store.name}</span>}
      </div>
      <div className="stat-grid">
        {(['new', 'confirmed', 'shipped'] as const).map((s) => (
          <button key={s} className={`stat stat-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(filter === s ? 'active' : s)}>
            <div className="stat-label">{ORDER_STATUS[s].label}: {hint[s]}</div>
            <div className="stat-value">{count(s)}</div>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="segmented">
          <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>В работе</button>
          <button className={filter === 'received' ? 'active' : ''} onClick={() => setFilter('received')}>Принятые</button>
          <button className={filter === 'canceled' ? 'active' : ''} onClick={() => setFilter('canceled')}>Отменённые</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
        </div>
        <span className="spacer" />
        {!isSupplier && <button className="btn primary" onClick={() => navigate('/market')}><Icon name="plus" size={16} />Новый заказ</button>}
      </div>
      <DataTable id={`orders-${org.kind}`} columns={columns} rows={rows} rowKey={(o) => o.id} loading={orders.loading} error={orders.error}
        empty={filter === 'active' ? 'Заказов в работе нет' : 'Заказов нет'} onRowClick={(o) => navigate(`/orders/${o.id}`)} />
    </>
  );
}
