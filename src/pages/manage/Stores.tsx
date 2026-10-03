import { useEffect, useState } from 'react';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Store } from '../../lib/types';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

export function Stores() {
  const { org, role, stores, registers, reload } = useWorkspace();
  const [edit, setEdit] = useState<Store | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', address: '' });
  const [company, setCompany] = useState(org.name);
  const [busy, setBusy] = useState(false);

  useEffect(() => setCompany(org.name), [org.name]);

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
    setForm(s === 'new' ? { name: '', address: '' } : { name: s.name, address: s.address });
    setEdit(s);
  };

  const save = () => {
    if (!form.name.trim()) return toast.error('Укажите название');
    const row = { org_id: org.id, name: form.name.trim(), address: form.address.trim() };
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
    { key: 'address', title: 'Адрес', value: (s) => s.address },
    { key: 'registers', title: 'Касс', align: 'right', value: (s) => registers.filter((r) => r.store_id === s.id).length },
  ];

  return (
    <>
      <div className="page-head"><h1>Торговые точки</h1></div>

      <div className="card pad" style={{ maxWidth: 560, marginBottom: 16 }}>
        <div className="section-title">Компания</div>
        <div className="input-group">
          <input value={company} onChange={(e) => setCompany(e.target.value)} disabled={role !== 'owner'} aria-label="Название компании" />
          {role === 'owner' && (
            <button className="btn" disabled={busy || !company.trim() || company.trim() === org.name}
              onClick={() => run(() => q(db.from('orgs').update({ name: company.trim() }).eq('id', org.id)), 'Название компании изменено')}>
              Сохранить
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />Торговая точка</button>
      </div>
      <DataTable id="stores" columns={columns} rows={stores} rowKey={(s) => s.id} onRowClick={open} />

      {edit && (
        <Modal
          title={edit === 'new' ? 'Новая торговая точка' : 'Торговая точка'}
          onClose={() => setEdit(null)}
          width={460}
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
          <div className="stack">
            <label className="field">
              <span>Название <b>*</b></span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </label>
            <label className="field">
              <span>Адрес</span>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            {edit !== 'new' && <p className="hint">Точку с продажами или складскими документами удалить нельзя.</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
