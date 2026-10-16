import { useMemo, useState } from 'react';
import { cityLabel, cityName, useCities } from '../../lib/cities';
import { formatPhone, parseNum, plural } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import type { Branch } from '../../lib/types';
import { CitySelect } from '../../ui/CitySelect';
import { PhoneInput } from '../../ui/PhoneInput';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { PhoneLink } from '../../ui/PhoneLink';
import { toast } from '../../ui/toast';
import { useAction } from '../../ui/useAction';
import { addBranch, deleteBranch, listBranchZones, listBusyBranches, listStockedBranches, setBranchZones, setMainBranch, updateBranch } from '../../api/company';

const EMPTY = {
  name: '', city: null as number | null, address: '', phone: '', manager: '', hours: '', main: false,
  markup: '', minOrder: '', delivery: '', regions: [] as number[], zoneCities: [] as number[],
};

/** Филиалы компании по городам. Заказ магазина попадает в филиал его города, иначе — в главный. */
export function Branches() {
  const { org, role, canManage, branchId, branches, reload } = useOrg();
  const cities = useCities();
  const owner = role === 'owner';
  // руководитель филиала правит карточку своего филиала; город, зону доставки и «главный» меняет владелец
  const canEdit = (b: Branch) => owner || (canManage && branchId === b.id);
  const [edit, setEdit] = useState<Branch | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, act] = useAction();
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  // чем занят каждый филиал: позиции на складе и заказы в работе
  const load = useQuery(async () => {
    const [stock, orders] = await Promise.all([
      listStockedBranches(org.id),
      listBusyBranches(org.id),
    ]);
    const count = (rows: { branch_id: string | null }[]) => rows.reduce<Record<string, number>>((m, r) => (r.branch_id ? { ...m, [r.branch_id]: (m[r.branch_id] ?? 0) + 1 } : m), {});
    return { stock: count(stock), orders: count(orders) };
  }, [org.id, branches]);

  const byCity = useMemo(() => {
    const order = (id: number) => cities.findIndex((c) => c.id === id);
    const groups = new Map<number, Branch[]>();
    for (const b of branches) groups.set(b.city_id, [...(groups.get(b.city_id) ?? []), b]);
    // город главного филиала — первым, остальные в порядке справочника: по областям, внутри области по алфавиту
    return [...groups].sort(([a, la], [b, lb]) => Number(lb.some((x) => x.is_main)) - Number(la.some((x) => x.is_main)) || order(a) - order(b));
  }, [branches, cities]);

  // зоны обслуживания: области целиком и отдельные города, куда возит филиал
  const zones = useQuery(() => listBranchZones(org.id), [org.id, branches]);
  const regions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const c of cities) if (c.region_sort > 0 && !seen.has(c.region_id)) seen.set(c.region_id, c.region);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [cities]);
  const zoneText = (b: Branch) => {
    const own = (zones.data ?? []).filter((z) => z.branch_id === b.id);
    const names = [
      ...own.filter((z) => z.region_id != null).map((z) => regions.find((r) => r.id === z.region_id)?.name ?? ''),
      ...own.filter((z) => z.city_id != null).map((z) => cityName(cities, z.city_id)),
    ].filter(Boolean);
    return names.join(', ');
  };

  const open = (b: Branch | 'new') => {
    const own = b === 'new' ? [] : (zones.data ?? []).filter((z) => z.branch_id === b.id);
    setForm(b === 'new' ? EMPTY : {
      name: b.name, city: b.city_id, address: b.address, phone: b.phone, manager: b.manager_name, hours: b.work_hours, main: b.is_main,
      markup: Number(b.markup_pct) ? String(Number(b.markup_pct)) : '', minOrder: b.min_order == null ? '' : String(Number(b.min_order)), delivery: b.delivery_note,
      regions: own.flatMap((z) => (z.region_id != null ? [z.region_id] : [])), zoneCities: own.flatMap((z) => (z.city_id != null ? [z.city_id] : [])),
    });
    setEdit(b);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    await act(async () => {
      await fn();
      toast.ok(ok);
      setEdit(null);
      await reload();
    });
  };

  const save = () => {
    if (form.city == null) return toast.error('Выберите город');
    const markup = form.markup.trim() === '' ? 0 : Number(form.markup.replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(markup) || markup <= -100 || markup > 500) return toast.error('Надбавка — число в процентах, например 8 или -5');
    const row = {
      ...(owner ? { city_id: form.city } : {}), name: form.name.trim() || `Филиал в городе ${cityName(cities, form.city)}`, address: form.address.trim(),
      phone: formatPhone(form.phone), manager_name: form.manager.trim(), work_hours: form.hours.trim(),
      markup_pct: markup, min_order: form.minOrder.trim() === '' ? null : Math.max(parseNum(form.minOrder), 0), delivery_note: form.delivery.trim(),
    };
    void run(async () => {
      const id = edit === 'new'
        ? (await addBranch(org.id, form.city, row)).id
        : (await updateBranch(row, (edit as Branch).id), (edit as Branch).id);
      if (!owner) return;
      await setBranchZones(id, form.regions, form.zoneCities);
      if (form.main && !(edit !== 'new' && (edit as Branch).is_main)) await setMainBranch(id);
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
          <div className="section-title row"><Icon name="pin" size={15} />{cityLabel(cities, cityId) || 'Город'}</div>
          <div className="branch-grid">
            {list.map((b) => (
              <div className="card branch-card" key={b.id}>
                <div className="row">
                  <b className="grow">{b.name}</b>
                  {b.is_main && <span className="badge accent">главный</span>}
                  {canEdit(b) && <button className="icon-btn small" onClick={() => open(b)} aria-label={`Изменить: ${b.name}`}><Icon name="edit" size={15} /></button>}
                </div>
                <div className="branch-lines">
                  {b.address && <span><Icon name="building" size={14} />{b.address}</span>}
                  {b.phone && <span><Icon name="phone" size={14} /><PhoneLink phone={b.phone} /></span>}
                  {b.manager_name && <span><Icon name="users" size={14} />{b.manager_name}</span>}
                  {b.work_hours && <span><Icon name="clock" size={14} />{b.work_hours}</span>}
                  {!b.address && !b.phone && <span className="muted">Адрес и телефон не указаны</span>}
                  {zoneText(b) && <span title="Зона обслуживания"><Icon name="truck" size={14} />{zoneText(b)}</span>}
                  {(Number(b.markup_pct) !== 0 || b.min_order != null) && (
                    <span>
                      <Icon name="tag" size={14} />
                      {[Number(b.markup_pct) !== 0 && `цены ${Number(b.markup_pct) > 0 ? '+' : ''}${Number(b.markup_pct)}%`, b.min_order != null && `заказ от ${Number(b.min_order)} ${org.currency}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
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
        <Modal title={edit === 'new' ? 'Новый филиал' : 'Филиал'} onClose={() => setEdit(null)} width={640}
          footer={
            <>
              {owner && edit !== 'new' && !edit.is_main && (
                <button className="btn danger" disabled={busy} onClick={() => run(() => deleteBranch((edit as Branch).id), 'Филиал удалён')}>
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
              {owner
                ? <CitySelect value={form.city} onChange={(city) => set({ city })} autoFocus={edit === 'new'} aria-label="Город" />
                : <input value={cityLabel(cities, form.city ?? 0)} disabled title="Город филиала меняет владелец компании" />}
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
              <PhoneInput value={form.phone} onChange={(phone) => set({ phone })} />
            </label>
            <label className="field">
              <span>Руководитель филиала</span>
              <input value={form.manager} onChange={(e) => set({ manager: e.target.value })} />
            </label>
            <label className="field wide">
              <span>Часы работы</span>
              <input value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="пн–сб, 9:00–18:00" />
            </label>
            <div className="section-title wide" style={{ marginBottom: 0 }}>Цены и условия этого склада</div>
            <label className="field">
              <span>Надбавка ко всему прайсу, %</span>
              <input value={form.markup} onChange={(e) => set({ markup: e.target.value })} inputMode="decimal" placeholder="0 — цены как у компании" />
            </label>
            <label className="field">
              <span>Минимальный заказ, {org.currency}</span>
              <input value={form.minOrder} onChange={(e) => set({ minOrder: e.target.value })} inputMode="decimal" placeholder="как у компании" />
            </label>
            <label className="field wide">
              <span>Доставка</span>
              <input value={form.delivery} onChange={(e) => set({ delivery: e.target.value })} placeholder="как у компании" />
            </label>
            <p className="hint wide">Цену на отдельный товар для этого склада можно задать в разделе «Склад» → «Цены».</p>

            {owner && (
            <>
            <div className="section-title wide" style={{ marginBottom: 0 }}>Куда возит этот склад</div>
            <p className="hint wide">Свой город обслуживается всегда. Отметьте области и добавьте города, магазины которых тоже получают товар и цены этого склада. Остальные города обслуживает главный филиал.</p>
            <div className="zone-box wide">
              {regions.map((r) => (
                <label key={r.id} className="check-row">
                  <input type="checkbox" checked={form.regions.includes(r.id)}
                    onChange={(e) => set({ regions: e.target.checked ? [...form.regions, r.id] : form.regions.filter((x) => x !== r.id) })} />
                  {r.name}
                </label>
              ))}
            </div>
            <div className="field wide">
              <span>Отдельные города</span>
              <CitySelect value={null} onChange={(c) => c != null && !form.zoneCities.includes(c) && set({ zoneCities: [...form.zoneCities, c] })} placeholder="Добавить город" aria-label="Добавить город в зону" />
              {form.zoneCities.length > 0 && (
                <div className="zone-chips">
                  {form.zoneCities.map((c) => (
                    <span key={c} className="badge accent">
                      {cityName(cities, c)}
                      <button type="button" onClick={() => set({ zoneCities: form.zoneCities.filter((x) => x !== c) })} aria-label={`Убрать город: ${cityName(cities, c)}`}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <label className="check-row wide">
              <input type="checkbox" checked={form.main} disabled={edit !== 'new' && edit.is_main} onChange={(e) => set({ main: e.target.checked })} />
              Главный филиал: принимает заказы из городов, где у компании нет своего филиала
            </label>
            </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
