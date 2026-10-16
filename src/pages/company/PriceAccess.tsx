import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dateTime } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useCompany } from '../../lib/session';
import type { PriceAccessStatus } from '../../lib/types';
import { DataTable, type Column } from '../../ui/DataTable';
import { PhoneLink } from '../../ui/PhoneLink';
import { toast } from '../../ui/toast';
import { decidePriceAccess, priceAccessList, type PriceAccessRow as Row } from '../../api/company';

const STATUS: Record<PriceAccessStatus, { label: string; badge: string }> = {
  pending: { label: 'Ждёт ответа', badge: 'warn' },
  approved: { label: 'Цены открыты', badge: 'ok' },
  declined: { label: 'Отклонён', badge: '' },
};

/** Запросы магазинов на прайс и открытые доступы. */
export function PriceAccess() {
  const { org, company, canManage, isHq } = useCompany();
  // запросы прайса разбирает головной офис: сотруднику филиала база их не отдаёт
  const list = useQuery(async () => (isHq ? priceAccessList(org.id) : []), [org.id, isHq]);
  const [busy, setBusy] = useState<string | null>(null);
  const closed = company.price_access === 'approved';

  const decide = async (r: Row, status: 'approved' | 'declined') => {
    setBusy(r.store_org);
    try {
      await decidePriceAccess(org.id, r.store_org, status);
      toast.ok(status === 'approved' ? `${r.store_name}: цены открыты` : `${r.store_name}: доступ закрыт`);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<Row>[] = [
    { key: 'store', title: 'Магазин', fixed: true, value: (r) => r.store_name },
    { key: 'city', title: 'Город', value: (r) => r.city },
    {
      key: 'phone', title: 'Телефон',
      render: (r) => (r.phone ? <PhoneLink phone={r.phone} /> : ''),
    },
    { key: 'orders', title: 'Заказов', align: 'right', value: (r) => Number(r.orders) },
    { key: 'status', title: 'Статус', render: (r) => <span className={`badge ${STATUS[r.status].badge}`}>{STATUS[r.status].label}</span> },
    { key: 'date', title: 'Запрос / решение', value: (r) => dateTime(r.decided_at ?? r.requested_at) },
    {
      key: 'actions', title: '', fixed: true,
      render: (r) => canManage && (
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          {r.status !== 'approved' && (
            <button className="btn small primary" disabled={busy === r.store_org} onClick={() => decide(r, 'approved')}>Открыть цены</button>
          )}
          {r.status === 'pending' && (
            <button className="btn small" disabled={busy === r.store_org} onClick={() => decide(r, 'declined')}>Отклонить</button>
          )}
          {r.status === 'approved' && (
            <button className="btn small" disabled={busy === r.store_org} onClick={() => decide(r, 'declined')}>Закрыть доступ</button>
          )}
        </div>
      ),
    },
  ];

  if (!isHq) return <div className="card empty">Доступ магазинов к ценам открывает головной офис компании.</div>;

  const pending = (list.data ?? []).filter((r) => r.status === 'pending').length;

  return (
    <>
      <div className="page-head">
        <h1>Доступ к ценам</h1>
        {pending > 0 && <span className="badge warn">новых запросов: {pending}</span>}
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        {closed
          ? 'Цены, остатки и заказ видят только магазины с открытым доступом. Остальные видят каталог без цен и могут запросить прайс.'
          : 'Сейчас цены видят все магазины на площадке, другие компании их не видят. Чтобы открывать прайс только своим магазинам, '}
        {!closed && <Link to="/profile">закройте его в профиле компании</Link>}
        {!closed && '.'}
      </p>
      {list.error ? <div className="card empty error-text">{list.error}</div> : (
        <DataTable id="price-access" columns={columns} rows={list.data ?? []} rowKey={(r) => r.store_org}
          empty={list.loading ? 'Загрузка…' : closed ? 'Запросов пока нет' : 'Запросов нет: прайс открыт для всех магазинов'} />
      )}
    </>
  );
}
