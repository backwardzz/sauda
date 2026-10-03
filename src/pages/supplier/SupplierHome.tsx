import { Link, useNavigate } from 'react-router-dom';
import { dateTime, money, moneyShort } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ORDER_STATUS, type Order } from '../../lib/types';

/** Главная поставщика: что требует действия прямо сейчас и кто заказывает. */
export function SupplierHome() {
  const { org } = useOrg();
  const navigate = useNavigate();
  const orders = useQuery(
    () => q<Order[]>(db.from('orders').select('*').eq('supplier_org', org.id).order('created_at', { ascending: false }).limit(1000)),
    [org.id],
  );
  const products = useQuery(
    async () => (await db.from('supplier_products').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('archived', false)).count ?? 0,
    [org.id],
  );

  const all = orders.data ?? [];
  const monthAgo = Date.now() - 30 * 86400_000;
  const done = all.filter((o) => ['shipped', 'received'].includes(o.status) && new Date(o.created_at).getTime() >= monthAgo);
  const revenue = done.reduce((s, o) => s + Number(o.total), 0);
  const todo = all.filter((o) => o.status === 'new' || o.status === 'confirmed');

  const clients = new Map<string, { name: string; sum: number; count: number }>();
  for (const o of all.filter((x) => x.status !== 'canceled')) {
    const c = clients.get(o.store_org) ?? { name: o.store_org_name, sum: 0, count: 0 };
    clients.set(o.store_org, { name: c.name, sum: c.sum + Number(o.total), count: c.count + 1 });
  }
  const top = [...clients.values()].sort((a, b) => b.sum - a.sum).slice(0, 6);

  return (
    <>
      <div className="page-head">
        <h1>{org.name}</h1>
        <span className="muted">Кабинет поставщика</span>
      </div>
      <div className="stat-grid">
        <Stat label="Новые заказы: подтвердите" value={String(all.filter((o) => o.status === 'new').length)} />
        <Stat label="Подтверждены: отгрузите" value={String(all.filter((o) => o.status === 'confirmed').length)} />
        <Stat label="Отгружено за 30 дней" value={moneyShort(revenue)} unit={org.currency} />
        <Stat label="Магазинов-клиентов" value={String(clients.size)} />
        <Stat label="Товаров в каталоге" value={String(products.data ?? '…')} />
      </div>

      {products.data === 0 && (
        <div className="card pad" style={{ marginBottom: 14 }}>
          <b>Начните с каталога.</b> Магазины видят вас на площадке, но заказать пока нечего.{' '}
          <Link to="/catalog">Добавить товары</Link>
        </div>
      )}

      <div className="dash-row">
        <div className="card">
          <div className="card-head"><h2>Ждут вашего действия</h2><span className="spacer" /><Link to="/orders">Все заказы</Link></div>
          {todo.length === 0 && <div className="empty">{orders.loading ? 'Загрузка…' : 'Все заказы обработаны'}</div>}
          {todo.slice(0, 8).map((o) => (
            <div className="list-row" key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
              <span className={`badge ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>
              <span className="grow"><a>№ {o.number}</a> · {o.store_org_name}</span>
              <span className="muted">{dateTime(o.created_at)}</span>
              <b className="num" style={{ minWidth: 90, textAlign: 'right' }}>{money(o.total)}</b>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h2>Клиенты</h2></div>
          {top.length === 0 && <div className="empty">Заказов ещё не было</div>}
          {top.map((c) => (
            <div className="list-row" key={c.name}>
              <span className="grow">{c.name}</span>
              <span className="muted">заказов: {c.count}</span>
              <b className="num" style={{ minWidth: 100, textAlign: 'right' }}>{money(c.sum)}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
    </div>
  );
}
