import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cityName, useCities } from '../../lib/cities';
import { formatPhone } from '../../lib/format';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Store } from '../../lib/types';
import { CitySelect } from '../../ui/CitySelect';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

const EMPTY = { name: '', city: null as number | null, address: '', phone: '' };

export function Stores() {
  const { org, stores, registers, reload } = useWorkspace();
  const cities = useCities();
  const [edit, setEdit] = useState<Store | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

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

  const open = (s: Store | 'new') => {
    // новая точка чаще всего в том же городе, что и первая
    setForm(s === 'new' ? { ...EMPTY, city: stores[0]?.city_id ?? null } : { name: s.name, city: s.city_id, address: s.address, phone: s.phone });
    setEdit(s);
  };

  const save = () => {
    if (!form.name.trim()) return toast.error('Укажите название');
    if (form.city == null) return toast.error('Выберите город: по нему компании подбирают ближайший филиал');
    const row = { org_id: org.id, name: form.name.trim(), city_id: form.city, address: form.address.trim(), phone: formatPhone(form.phone) };
    void run(async () => {
      if (edit === 'new') {
        const created = await q<Store>(db.from('stores').insert(row).select().single());
        await q(db.from('registers').insert({ org_id: org.id, store_id: created.id, name: 'Касса 1' }));
      } else if (edit) {
        await q(db.from('stores').update(row).eq('id', edit.id));
      }
    }, edit === 'new' ? 'Торговая точка создана, к ней добавлена «Касса 1»' : 'Сохранено');
  };

  const columns: Column<Store>[] = [
    { key: 'name', title: 'Название', fixed: true, render: (s) => <a>{s.name}</a> },
    { key: 'city', title: 'Город', value: (s) => cityName(cities, s.city_id), render: (s) => cityName(cities, s.city_id) || <span className="badge warn">не указан</span> },
    { key: 'address', title: 'Адрес', value: (s) => s.address },
    { key: 'phone', title: 'Телефон', value: (s) => s.phone },
    { key: 'registers', title: 'Касс', align: 'right', value: (s) => registers.filter((r) => r.store_id === s.id).length },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Торговые точки</h1>
        <span className="muted">{org.name} · название и реквизиты — в <Link to="/profile">профиле магазина</Link></span>
      </div>

      <div className="toolbar">
        <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />Торговая точка</button>
      </div>
      <DataTable id="stores" columns={columns} rows={stores} rowKey={(s) => s.id} onRowClick={open} />

      {edit && (
        <Modal
          title={edit === 'new' ? 'Новая торговая точка' : 'Торговая точка'}
          onClose={() => setEdit(null)}
          width={520}
          footer={
            <>
              {edit !== 'new' && stores.length > 1 && (
                <button className="btn danger" disabled={busy}
                  onClick={() => run(() => q(db.from('stores').delete().eq('id', (edit as Store).id)), 'Торговая точка удалена')}>
                  Удалить
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => setEdit(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <label className="field wide">
              <span>Название <b>*</b></span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </label>
            <div className="field">
              <span>Город <b>*</b></span>
              <CitySelect value={form.city} onChange={(city) => setForm({ ...form, city })} aria-label="Город" />
            </div>
            <label className="field">
              <span>Телефон</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onBlur={() => setForm({ ...form, phone: formatPhone(form.phone) })}
                inputMode="tel" placeholder="+7 701 000 00 00" />
            </label>
            <label className="field wide">
              <span>Адрес</span>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="пр. Абая, 10" />
            </label>
            <p className="hint wide">
              Город, адрес и телефон компания видит в заказе этой точки.
              {edit !== 'new' && ' Точку с продажами или складскими документами удалить нельзя.'}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
