import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ROLE_LABEL } from '../lib/types';
import { Icon } from '../ui/Icon';

interface Section {
  label: string;
  to?: string;
  items?: { label: string; to: string }[];
}

const MANAGER_NAV: Section[] = [
  { label: 'Главная', to: '/' },
  {
    label: 'Отчёты',
    items: [
      { label: 'Статистика продаж', to: '/reports/sales' },
      { label: 'Отчёты по сменам', to: '/reports/shifts' },
      { label: 'Отчёты по кассирам', to: '/reports/cashiers' },
      { label: 'Отчёты по скидкам', to: '/reports/discounts' },
      { label: 'Прибыли и убытки', to: '/reports/pnl' },
      { label: 'ABC-анализ', to: '/reports/abc' },
    ],
  },
  {
    label: 'Продажи',
    items: [
      { label: 'Чеки', to: '/sales' },
      { label: 'Возвраты покупателей', to: '/returns' },
      { label: 'Отменённые товары', to: '/canceled' },
    ],
  },
  {
    label: 'Закупки',
    items: [{ label: 'Приёмка', to: '/docs/supply' }],
  },
  {
    label: 'Товары',
    items: [
      { label: 'Список товаров', to: '/products' },
      { label: 'Быстрые товары', to: '/quick' },
      { label: 'Склад', to: '/stock' },
      { label: 'Оприходование', to: '/docs/posting' },
      { label: 'Списание', to: '/docs/writeoff' },
      { label: 'Перемещение', to: '/docs/transfer' },
      { label: 'Инвентаризация', to: '/docs/inventory' },
    ],
  },
  {
    label: 'Контрагенты',
    items: [
      { label: 'Покупатели', to: '/customers' },
      { label: 'Поставщики', to: '/suppliers' },
    ],
  },
  {
    label: 'Управление',
    items: [
      { label: 'Пользователи', to: '/users' },
      { label: 'Кассы', to: '/registers' },
      { label: 'Торговые точки', to: '/stores' },
    ],
  },
];

const CASHIER_NAV: Section[] = [
  { label: 'Чеки', to: '/sales' },
  { label: 'Возвраты', to: '/returns' },
];

export function Layout() {
  const { user, org, role, canManage, memberships, stores, store, setStoreId, setOrgId, signOut } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setOpen(null), [location.pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const nav = canManage ? MANAGER_NAV : CASHIER_NAV;
  const name = (user?.user_metadata?.full_name as string) || user?.email || '';

  return (
    <div className="app">
      <header className="topbar" ref={bar}>
        <Link to="/" className="brand"><span className="brand-mark">S</span>Sauda</Link>
        {nav.map((s) =>
          s.to ? (
            <NavLink key={s.label} to={s.to} end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {s.label}
            </NavLink>
          ) : (
            <div className="nav-item" key={s.label}>
              <button
                className={`nav-link ${s.items!.some((i) => location.pathname.startsWith(i.to)) ? 'active' : ''}`}
                onClick={() => setOpen(open === s.label ? null : s.label)}
                aria-expanded={open === s.label}
              >
                {s.label}
                <Icon name="down" size={14} />
              </button>
              {open === s.label && (
                <div className="nav-menu">
                  {s.items!.map((i) => (
                    <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                      {i.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        <span className="spacer" />
        <button className="btn primary" onClick={() => navigate('/pos')}>
          <Icon name="cart" size={16} />
          Касса
        </button>
        {stores.length > 1 && (
          <select value={store?.id ?? ''} onChange={(e) => setStoreId(e.target.value)} aria-label="Торговая точка">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="nav-item">
          <button className="user-chip" onClick={() => setOpen(open === 'user' ? null : 'user')}>
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <span>{name}</span>
          </button>
          {open === 'user' && (
            <div className="nav-menu" style={{ left: 'auto', right: 0 }}>
              <div style={{ padding: '6px 10px 8px' }}>
                <div><b>{org?.name}</b></div>
                <div className="muted">{store?.name} · {role ? ROLE_LABEL[role] : ''}</div>
                <div className="muted">{user?.email}</div>
              </div>
              {memberships.length > 1 &&
                memberships.filter((m) => m.org.id !== org?.id).map((m) => (
                  <button key={m.org.id} className="menu-item" onClick={() => setOrgId(m.org.id)}>
                    <Icon name="swap" size={16} />
                    {m.org.name}
                  </button>
                ))}
              <button className="menu-item" onClick={signOut}>
                <Icon name="logout" size={16} />
                Выйти
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
