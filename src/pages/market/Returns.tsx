import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dateTime, money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { RETURN_REASON, RETURN_STATUS, type OrderReturn, type ReturnStatus } from '../../lib/types';
import { exportXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

type Filter = 'active' | 'done' | 'closed' | 'all' | ReturnStatus;

const ACTIVE: ReturnStatus[] = ['new', 'accepted', 'sent'];

/** Возвраты товара компаниям: магазин видит свои возвраты, компания — возвраты от магазинов. */
export function Returns() {
  const { org, store, branches } = useOrg();
  const navigate = useNavigate();
  const isCompany = org.kind === 'company';
  const [filter, setFilter] = useState<Filter>('active');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');

  const returns = useQuery(() => {
    let query = db.from('order_returns').select('*').eq(isCompany ? 'supplier_org' : 'store_org', org.id);
    if (!isCompany && store) query = query.eq('store_id', store.id);
    return q<OrderReturn[]>(query.order('created_at', { ascending: false }).limit(500));
  }, [org.id, isCompany, store?.id]);

  const term = search.trim().toLowerCase();
  const all = (returns.data ?? []).filter((r) =>
    (!branch || r.branch_id === branch) &&
    (!term || String(r.number).includes(term) || String(r.order_number).includes(term)
      || (isCompany ? `${r.store_org_name} ${r.store_name}` : r.supplier_name).toLowerCase().includes(term)));
  const rows = all.filter((r) =>
    filter === 'all' ? true
      : filter === 'active' ? ACTIVE.includes(r.status)
        : filter === 'done' ? r.status === 'received'
          : filter === 'closed' ? r.status === 'rejected' || r.status === 'canceled'
            : r.status === filter);
  const count = (s: ReturnStatus) => all.filter((r) => r.status === s).length;

  const columns: Column<OrderReturn>[] = [
    { key: 'number', title: 'Номер', fixed: true, render: (r) => <a>№ {r.number}</a> },
    { key: 'date', title: 'Дата', sortable: true, value: (r) => r.created_at, render: (r) => dateTime(r.created_at) },
    {
      key: 'status', title: 'Статус',
      render: (r) => <span className={`badge ${RETURN_STATUS[r.status].badge}`}>{RETURN_STATUS[r.status].label}</span>,
    },
    isCompany
      ? { key: 'party', title: 'Магазин', sortable: true, value: (r) => r.store_org_name, render: (r) => <>{r.store_org_name}<div className="muted">{r.store_name}</div></> }
      : { key: 'party', title: 'Компания', sortable: true, value: (r) => r.supplier_name },
    ...(isCompany && branches.length > 1 ? [{ key: 'branch', title: 'Филиал', sortable: true, value: (r: OrderReturn) => r.branch_name }] : []),
    { key: 'order', title: 'Заказ', value: (r) => `№ ${r.order_number}` },
    { key: 'reason', title: 'Причина', value: (r) => RETURN_REASON[r.reason], render: (r) => <>{RETURN_REASON[r.reason]}{r.comment && <div className="muted">{r.comment}</div>}</> },
    { key: 'total', title: `Сумма, ${org.currency}`, align: 'right', sortable: true, value: (r) => Number(r.total), render: (r) => <b style={{ fontWeight: 600 }}>{money(r.total)}</b> },
  ];

  const hint = isCompany
    ? { new: 'ждут вашего ответа', accepted: 'магазин готовит товар', sent: 'заберите и подтвердите' }
    : { new: 'ждут ответа компании', accepted: 'можно отдавать товар', sent: 'компания подтверждает получение' };

  const download = () => {
    if (!rows.length) return toast.error('Возвратов нет');
    exportXlsx(isCompany ? 'Возвраты от магазинов' : 'Возвраты компаниям', 'Возвраты', rows.map((r) => ({
      'Номер': r.number, 'Дата': dateTime(r.created_at), 'Статус': RETURN_STATUS[r.status].label,
      ...(isCompany ? { 'Магазин': r.store_org_name, 'Точка': r.store_name, 'Филиал': r.branch_name } : { 'Компания': r.supplier_name }),
      'Заказ': r.order_number, 'Причина': RETURN_REASON[r.reason], 'Комментарий': r.comment, 'Сумма': Number(r.total),
    }))).catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>{isCompany ? 'Возвраты от магазинов' : 'Возвраты компаниям'}</h1>
        {!isCompany && store && <span className="muted">{store.name}</span>}
      </div>
      <div className="stat-grid">
        {(['new', 'accepted', 'sent'] as const).map((s) => (
          <button key={s} className={`stat stat-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(filter === s ? 'active' : s)}>
            <div className="stat-label">{RETURN_STATUS[s].label}: {hint[s]}</div>
            <div className="stat-value">{count(s)}</div>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <div className="segmented">
          <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>В работе</button>
          <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>Завершённые</button>
          <button className={filter === 'closed' ? 'active' : ''} onClick={() => setFilter('closed')}>Отклонённые и отменённые</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Все</button>
        </div>
        <input className="search" type="search" placeholder={isCompany ? 'Номер, заказ или магазин' : 'Номер, заказ или компания'} value={search} onChange={(e) => setSearch(e.target.value)} />
        {isCompany && branches.length > 1 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Филиал">
            <option value="">Все филиалы</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>
      <DataTable id={`returns-${org.kind}`} columns={columns} rows={rows} rowKey={(r) => r.id} loading={returns.loading} error={returns.error}
        empty={filter === 'active' ? 'Возвратов в работе нет' : 'Возвратов нет'} onRowClick={(r) => navigate(`/order-returns/${r.id}`)} />
      {!isCompany && <p className="hint" style={{ marginTop: 10 }}>Возврат оформляется из принятого заказа: откройте заказ и нажмите «Вернуть товар».</p>}
    </>
  );
}
