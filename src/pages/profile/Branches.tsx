import { useMemo, useState } from 'react';
import { cityName, useCities } from '../../lib/cities';
import { formatPhone, plural } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Branch } from '../../lib/types';
import { CitySelect } from '../../ui/CitySelect';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

const EMPTY = { name: '', city: null as number | null, address: '', phone: '', manager: '', hours: '', main: false };

/** Филиалы компании по городам. Заказ магазина попадает в филиал его города, иначе — в главный. */
export function Branches() {
  const { org, role, branches, reload } = useOrg();
  const cities = useCities();
  const owner = role === 'owner';
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  // чем занят каждый филиал: позиции на складе и заказы в работе
  const load = useQuery(async () => {
    const [stock, orders] = await Promise.all([
      q<{ branch_id: string }[]>(db.from('company_stock').select('branch_id').eq('org_id', org.id).gt('qty', 0).limit(20000)),
      q<{ branch_id: string | null }[]>(db.from('orders').select('branch_id').eq('supplier_org', org.id).in('status', ['new', 'confirmed']).limit(5000)),
    ]);
    const count = (rows: { branch_id: string | null }[]) => rows.reduce<Record<string, number>>((m, r) => (r.branch_id ? { ...m, [r.branch_id]: (m[r.branch_id] ?? 0) + 1 } : m), {});
    return { stock: count(stock), orders: count(orders) };
  }, [org.id, branches]);

  const byCity = useMemo(() => {
    const groups = new Map<number, Branch[]>();
    for (const b of branches) groups.set(b.city_id, [...(groups.get(b.city_id) ?? []), b]);
    // город главного филиала — первым, остальные по алфавиту
    return [...groups].sort(([a, la], [b, lb]) => Number(lb.some((x) => x.is_main)) - Number(la.some((x) => x.is_main)) || cityName(cities, a).localeCompare(cityName(cities, b), 'ru'));
  }, [branches, cities]);

  const open = (b: Branch | 'new') => {
    setForm(b === 'new' ? EMPTY : { name: b.name, city: b.city_id, address: b.address, phone: b.phone, manager: b.manager_name, hours: b.work_hours, main: b.is_main });
    setEdit(b);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(ok);
      setEdit(null);
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (form.city == null) return toast.error('Выберите город');
    const row = {
      city_id: form.city, name: form.name.trim() || `Филиал в городе ${cityName(cities, form.city)}`, address: form.address.trim(),
      phone: formatPhone(form.phone), manager_name: form.manager.trim(), work_hours: form.hours.trim(),
    };
    void run(async () => {
      const id = edit === 'new'
        ? (await q<Branch>(db.from('company_branches').insert({ org_id: org.id, ...row }).select().single())).id
        : (await q(db.from('company_branches').update(row).eq('id', (edit as Branch).id)), (edit as Branch).id);
      if (form.main && !(edit !== 'new' && (edit as Branch).is_main)) await q(db.rpc('set_main_branch', { p_branch: id }));
    }, edit === 'new' ? 'Филиал добавлен' : 'Сохранено');
  };

  return (
    <>
      <div className="row" style={{ margin: '22px 0 10px' }}>
        <h2>Филиалы</h2>
        <span className="muted">{branches.length} {plural(branches.length, 'филиал', 'филиала', 'филиалов')} · {byCity.length} {plural(byCity.length, 'город', 'города', 'городов')}</span>
        <span className="spacer" />
        {owner && <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />Филиал</button>}
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        У каждого филиала свой склад. Заказ магазина приходит в филиал его города, а если такого нет — в главный.
      </p>

      {byCity.map(([cityId, list]) => (
        <div key={cityId} className="branch-city">
          <div className="section-title row"><Icon name="pin" size={15} />{cityName(cities, cityId) || 'Город'}</div>
          <div className="branch-grid">
            {list.map((b) => (
              <div className="card branch-card" key={b.id}>
                <div className="row">
                  <b className="grow">{b.name}</b>
                  {b.is_main && <span className="badge accent">главный</span>}
                  {owner && <button className="icon-btn small" onClick={() => open(b)} aria-label={`Изменить: ${b.name}`}><Icon name="edit" size={15} /></button>}
                </div>
                <div className="branch-lines">
                  {b.address && <span><Icon name="building" size={14} />{b.address}</span>}
                  {b.phone && <span><Icon name="phone" size={14} /><a href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}>{b.phone}</a></span>}
                  {b.manager_name && <span><Icon name="users" size={14} />{b.manager_name}</span>}
                  {b.work_hours && <span><Icon name="clock" size={14} />{b.work_hours}</span>}
                  {!b.address && !b.phone && <span className="muted">Адрес и телефон не указаны</span>}
                </div>
                <div className="row wrap muted branch-foot">
                  <span>на складе: {load.data?.stock[b.id] ?? 0} поз.</span>
                  <span>заказов в работе: {load.data?.orders[b.id] ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {edit && (
        <Modal title={edit === 'new' ? 'Новый филиал' : 'Филиал'} onClose={() => setEdit(null)} width={560}
          footer={
            <>
              {edit !== 'new' && !edit.is_main && (
                <button className="btn danger" disabled={busy} onClick={() => run(() => q(db.rpc('delete_company_branch', { p_branch: (edit as Branch).id })), 'Филиал удалён')}>
                  Удалить
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => setEdit(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
            </>
          }>
          <div className="form-grid">
            <div className="field">
              <span>Город <b>*</b></span>
              <CitySelect value={form.city} onChange={(city) => set({ city })} autoFocus={edit === 'new'} aria-label="Город" />
            </div>
            <label className="field">
              <span>Название</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={form.city ? `Филиал в городе ${cityName(cities, form.city)}` : 'Склад на Рыскулова'} />
            </label>
            <label className="field wide">
              <span>Адрес</span>
              <input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="ул. Рыскулова, 57" />
            </label>
            <label className="field">
              <span>Телефон</span>
              <input value={form.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={() => set({ phone: formatPhone(form.phone) })} inputMode="tel" placeholder="+7 701 000 00 00" />
            </label>
            <label className="field">
              <span>Руководитель филиала</span>
              <input value={form.manager} onChange={(e) => set({ manager: e.target.value })} />
            </label>
            <label className="field wide">
              <span>Часы работы</span>
              <input value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="пн–сб, 9:00–18:00" />
            </label>
            <label className="check-row wide">
              <input type="checkbox" checked={form.main} disabled={edit !== 'new' && edit.is_main} onChange={(e) => set({ main: e.target.checked })} />
              Главный филиал: принимает заказы из городов, где у компании нет своего филиала
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
