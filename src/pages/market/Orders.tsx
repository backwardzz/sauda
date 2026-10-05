import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dateTime, money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ORDER_STATUS, type Order, type OrderStatus } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

type Filter = 'active' | 'all' | OrderStatus;

/** Заказы: магазин видит свои заказы компаниям, компания — заказы магазинов. */
export function Orders() {
  const { org, store, branches } = useOrg();
  const navigate = useNavigate();
  const isCompany = org.kind === 'company';
  const [filter, setFilter] = useState<Filter>('active');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');

  const orders = useQuery(() => {
    let query = db.from('orders').select('*').eq(isCompany ? 'supplier_org' : 'store_org', org.id);
    if (!isCompany && store) query = query.eq('store_id', store.id);
    return q<Order[]>(query.order('created_at', { ascending: false }).limit(500));
  }, [org.id, isCompany, store?.id]);

  const term = search.trim().toLowerCase();
  const all = (orders.data ?? []).filter((o) =>
    (!branch || o.branch_id === branch) &&
    (!term || String(o.number).includes(term) || (isCompany ? `${o.store_org_name} ${o.store_name} ${o.store_city}` : o.supplier_name).toLowerCase().includes(term)));
  const rows = all.filter((o) => (filter === 'all' ? true : filter === 'active' ? ['new', 'confirmed', 'shipped'].includes(o.status) : o.status === filter));
  const count = (s: OrderStatus) => all.filter((o) => o.status === s).length;

  const columns: Column<Order>[] = [
    { key: 'number', title: 'Номер', fixed: true, render: (o) => <a>№ {o.number}</a> },
    { key: 'date', title: 'Дата', sortable: true, value: (o) => o.created_at, render: (o) => dateTime(o.created_at) },
    {
      key: 'status', title: 'Статус',
      render: (o) => <span className={`badge ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>,
    },
    isCompany
      ? { key: 'party', title: 'Магазин', sortable: true, value: (o) => o.store_org_name, render: (o) => <>{o.store_org_name}<div className="muted">{[o.store_name, o.store_city, o.store_address].filter(Boolean).join(', ')}</div></> }
      : { key: 'party', title: 'Компания', sortable: true, value: (o) => o.supplier_name },
    ...(isCompany && branches.length > 1 ? [{ key: 'branch', title: 'Филиал', sortable: true, value: (o: Order) => o.branch_name }] : []),
    { key: 'comment', title: 'Комментарий', value: (o) => o.comment },
    { key: 'total', title: `Сумма, ${org.currency}`, align: 'right', sortable: true, value: (o) => Number(o.total), render: (o) => <b style={{ fontWeight: 600 }}>{money(o.total)}</b> },
  ];

  const hint = isCompany
    ? { new: 'ждут подтверждения', confirmed: 'ждут отгрузки', shipped: 'в пути' }
    : { new: 'ждут ответа компании', confirmed: 'компания собирает', shipped: 'можно принимать' };

  const download = () => {
    if (!rows.length) return toast.error('Заказов нет');
    exportXlsx(isCompany ? 'Заказы магазинов' : 'Мои заказы', 'Заказы', rows.map((o) => ({
      'Номер': o.number, 'Дата': dateTime(o.created_at), 'Статус': ORDER_STATUS[o.status].label,
      ...(isCompany ? { 'Магазин': o.store_org_name, 'Точка': o.store_name, 'Город': o.store_city, 'Адрес': o.store_address, 'Телефон': o.store_phone, 'Филиал': o.branch_name } : { 'Компания': o.supplier_name }),
      'Комментарий': o.comment, 'Сумма': Number(o.total),
    }))).catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>{isCompany ? 'Заказы магазинов' : 'Мои заказы'}</h1>
        {!isCompany && store && <span className="muted">{store.name}</span>}
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
        <input className="search" type="search" placeholder={isCompany ? 'Номер, магазин или город' : 'Номер или компания'} value={search} onChange={(e) => setSearch(e.target.value)} />
        {isCompany && branches.length > 1 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
        {!isCompany && <button className="btn primary" onClick={() => navigate('/market')}><Icon name="plus" size={16} />Новый заказ</button>}
      </div>
      <DataTable id={`orders-${org.kind}`} columns={columns} rows={rows} rowKey={(o) => o.id} loading={orders.loading} error={orders.error}
        empty={filter === 'active' ? 'Заказов в работе нет' : 'Заказов нет'} onRowClick={(o) => navigate(`/orders/${o.id}`)} />
    </>
  );
}
