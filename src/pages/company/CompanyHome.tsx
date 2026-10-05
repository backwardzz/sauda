import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { totals, useCompanyCatalog, variantState } from '../../lib/companyCatalog';
import { dateTime, money, moneyShort, qty as fmtQty } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useCompany } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ORDER_STATUS, type Order } from '../../lib/types';
import { CompanyAvatar } from '../../ui/CompanyAvatar';

/** Главная компании: что требует действия прямо сейчас, что продаётся и что заканчивается. */
export function CompanyHome() {
  const { org, company, branches } = useCompany();
  const navigate = useNavigate();
  const orders = useQuery(
    () => q<Order[]>(db.from('orders').select('*').eq('supplier_org', org.id).order('created_at', { ascending: false }).limit(1000)),
    [org.id],
  );
  const catalog = useCompanyCatalog(org.id);

  const all = orders.data ?? [];
  const monthAgo = Date.now() - 30 * 86400_000;
  const done = all.filter((o) => ['shipped', 'received'].includes(o.status) && new Date(o.shipped_at ?? o.created_at).getTime() >= monthAgo);
  const revenue = done.reduce((s, o) => s + Number(o.total), 0);
  const todo = all.filter((o) => o.status === 'new' || o.status === 'confirmed');

  const clients = new Map<string, { name: string; sum: number; count: number }>();
  for (const o of all.filter((x) => x.status !== 'canceled')) {
    const c = clients.get(o.store_org) ?? { name: o.store_org_name, sum: 0, count: 0 };
    clients.set(o.store_org, { name: c.name, sum: c.sum + Number(o.total), count: c.count + 1 });
  }
  const top = [...clients.values()].sort((a, b) => b.sum - a.sum).slice(0, 6);

  const { products, low, best } = useMemo(() => {
    const list = catalog.data?.products ?? [];
    const stats = catalog.data?.stats ?? new Map();
    const lowList: { id: string; name: string; label: string; free: number; out: boolean }[] = [];
    const sums = list.map((p) => {
      const own = catalog.data?.variants.get(p.id) ?? [];
      for (const v of own) {
        const state = v.active ? variantState(v, stats.get(v.id)) : 'ok';
        if (state === 'low' || state === 'out') {
          const s = stats.get(v.id);
          lowList.push({ id: p.id, name: p.name, label: v.label, free: Number(s?.stock ?? 0) - Number(s?.reserved ?? 0), out: state === 'out' });
        }
      }
      return { product: p, sum: totals(own, stats) };
    });
    return {
      products: list.length,
      low: lowList.sort((a, b) => a.free - b.free),
      best: sums.filter((s) => s.sum.sold30 > 0).sort((a, b) => b.sum.sold30 - a.sum.sold30).slice(0, 6),
    };
  }, [catalog.data]);

  return (
    <>
      <div className="page-head">
        <CompanyAvatar name={org.name} logo={org.logo_url} size={40} />
        <h1>{org.name}</h1>
        <span className="muted">Кабинет компании · {branches.length > 1 ? `филиалов: ${branches.length}` : branches[0]?.name}</span>
      </div>
      <div className="stat-grid">
        <Stat label="Новые заказы: подтвердите" value={String(all.filter((o) => o.status === 'new').length)} to="/orders" />
        <Stat label="Подтверждены: отгрузите" value={String(all.filter((o) => o.status === 'confirmed').length)} to="/orders" />
        <Stat label="Отгружено за 30 дней" value={moneyShort(revenue)} unit={org.currency} />
        <Stat label="Магазинов-клиентов" value={String(clients.size)} />
        <Stat label="Товаров в каталоге" value={catalog.data ? String(products) : '…'} to="/catalog" />
        <Stat label="Заканчиваются на складе" value={catalog.data ? String(low.length) : '…'} to="/stock" />
      </div>

      {catalog.data && products === 0 && (
        <div className="card banner">
          <span className="grow"><b>Начните с каталога.</b> Магазины видят компанию на площадке, но заказать пока нечего.</span>
          <Link className="btn primary" to="/catalog">Добавить товары</Link>
        </div>
      )}
      {company && !company.description && products > 0 && (
        <div className="card banner">
          <span className="grow">Расскажите магазинам о компании: логотип, описание и условия доставки повышают доверие к заказу.</span>
          <Link className="btn" to="/company">Заполнить профиль</Link>
        </div>
      )}

      <div className="dash-row">
        <div className="card">
          <div className="card-head"><h2>Ждут вашего действия</h2><span className="spacer" /><Link to="/orders">Все заказы</Link></div>
          {todo.length === 0 && <div className="empty">{orders.loading ? 'Загрузка…' : 'Все заказы обработаны'}</div>}
          {todo.slice(0, 8).map((o) => (
            <div className="list-row" key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
              <span className={`badge ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>
              <span className="grow"><a>№ {o.number}</a> · {o.store_org_name}{o.store_city && <span className="muted"> · {o.store_city}</span>}</span>
              <span className="muted">{dateTime(o.created_at)}</span>
              <b className="num" style={{ minWidth: 90, textAlign: 'right' }}>{money(o.total)}</b>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h2>Заканчиваются на складе</h2><span className="spacer" /><Link to="/stock">Склад</Link></div>
          {low.length === 0 && <div className="empty">{catalog.loading && !catalog.data ? 'Загрузка…' : 'Запаса хватает'}</div>}
          {low.slice(0, 8).map((l) => (
            <div className="list-row" key={l.id + l.label} style={{ cursor: 'pointer' }} onClick={() => navigate(`/catalog/${l.id}`)}>
              <span className="grow"><a>{l.name}</a>{l.label && ` · ${l.label}`}</span>
              <span className={`badge ${l.out ? 'danger' : 'warn'}`}>{l.out ? 'нет в наличии' : `осталось ${fmtQty(l.free)}`}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="dash-row" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-head"><h2>Лучше всего продаётся</h2><span className="spacer" /><span className="muted">30 дней</span></div>
          {best.length === 0 && <div className="empty">{catalog.loading && !catalog.data ? 'Загрузка…' : 'Отгрузок за месяц не было'}</div>}
          {best.map(({ product: p, sum }) => (
            <div className="list-row" key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/catalog/${p.id}`)}>
              <span className="grow"><a>{p.name}</a></span>
              <span className="muted">отгружено {fmtQty(sum.sold30)}</span>
              <span className="muted" style={{ minWidth: 110, textAlign: 'right' }}>{sum.free == null ? 'без учёта' : `свободно ${fmtQty(sum.free)}`}</span>
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

function Stat({ label, value, unit, to }: { label: string; value: string; unit?: string; to?: string }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
    </>
  );
  return to ? <Link className="stat stat-btn" to={to}>{body}</Link> : <div className="stat">{body}</div>;
}
