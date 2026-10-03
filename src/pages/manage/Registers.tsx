import { useState } from 'react';
import { dateTime } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Register, Shift } from '../../lib/types';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

const EMPTY = { name: '', store_id: '', active: true, receipt_header: '', receipt_footer: 'Спасибо за покупку!' };

export function Registers() {
  const { org, store, stores, registers, reload } = useWorkspace();
  const [edit, setEdit] = useState<Register | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const openShifts = useQuery(
    () => q<Pick<Shift, 'register_id' | 'opened_at' | 'number'>[]>(
      db.from('shifts').select('register_id, opened_at, number').eq('org_id', org.id).is('closed_at', null),
    ),
    [org.id],
  );

  const open = (r: Register | 'new') => {
    setForm(r === 'new'
      ? { ...EMPTY, store_id: store.id, name: `Касса ${registers.length + 1}` }
      : { name: r.name, store_id: r.store_id, active: r.active, receipt_header: r.receipt_header, receipt_footer: r.receipt_footer });
    setEdit(r);
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
    if (!form.name.trim()) return toast.error('Укажите название кассы');
    const row = { ...form, name: form.name.trim(), org_id: org.id };
    void run(
      () => (edit === 'new' ? q(db.from('registers').insert(row)) : q(db.from('registers').update(row).eq('id', (edit as Register).id))),
      edit === 'new' ? 'Касса успешно создана' : 'Касса сохранена',
    );
  };

  const columns: Column<Register>[] = [
    { key: 'name', title: 'Название', fixed: true, render: (r) => <a>{r.name}</a> },
    { key: 'store', title: 'Торговая точка', value: (r) => stores.find((s) => s.id === r.store_id)?.name ?? '' },
    { key: 'active', title: 'Статус активности', render: (r) => <span className={`badge ${r.active ? 'ok' : ''}`}>{r.active ? 'Активна' : 'Не активна'}</span> },
    {
      key: 'shift', title: 'Смена',
      render: (r) => {
        const s = (openShifts.data ?? []).find((x) => x.register_id === r.id);
        return s ? `№ ${s.number}, открыта ${dateTime(s.opened_at)}` : <span className="muted">закрыта</span>;
      },
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Управление кассами</h1>
        <span className="muted">Касса открывается в браузере: кнопка «Касса» в верхней панели</span>
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />Создать кассу</button>
      </div>
      <DataTable id="registers" columns={columns} rows={registers} rowKey={(r) => r.id} onRowClick={open} empty="Касс пока нет" />

      {edit && (
        <Modal
          title={edit === 'new' ? 'Создание кассы' : 'Редактирование кассы'}
          onClose={() => setEdit(null)}
          footer={
            <>
              {edit !== 'new' && (
                <button className="btn danger" disabled={busy}
                  onClick={() => run(() => q(db.from('registers').delete().eq('id', (edit as Register).id)), 'Касса удалена')}>
                  Удалить
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => setEdit(null)}>Отменить</button>
              <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="section-title">Общие настройки</div>
          <div className="form-grid">
            <label className="field">
              <span>Название <b>*</b></span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </label>
            <label className="field">
              <span>Торговая точка</span>
              <select value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} disabled={edit !== 'new'}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="check-row wide">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Касса активна: на ней можно открывать смены
            </label>
          </div>
          <div className="section-title">Настройка чека</div>
          <div className="stack">
            <label className="field">
              <span>Заголовок чека</span>
              <input value={form.receipt_header} onChange={(e) => setForm({ ...form, receipt_header: e.target.value })} placeholder={org.name} />
            </label>
            <label className="field">
              <span>Текст внизу чека</span>
              <input value={form.receipt_footer} onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })} />
            </label>
          </div>
          {edit !== 'new' && <p className="hint" style={{ marginTop: 12 }}>Кассу с проведёнными сменами удалить нельзя — отключите её, сняв отметку «активна».</p>}
        </Modal>
      )}
    </>
  );
}
