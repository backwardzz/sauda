import { useState } from 'react';
import { useContractors } from '../../lib/refs';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Contractor } from '../../lib/types';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

const META = {
  customer: { title: 'Покупатели', one: 'Покупатель', empty: 'Покупателей пока нет. Добавьте постоянных клиентов, чтобы видеть их покупки в отчётах.' },
  supplier: { title: 'Поставщики', one: 'Поставщик', empty: 'Поставщиков пока нет. Укажите поставщика в карточке товара, чтобы видеть продажи по поставщикам.' },
};

export function Contractors({ kind }: { kind: Contractor['kind'] }) {
  const { org } = useWorkspace();
  const list = useContractors(org.id, kind);
  const [edit, setEdit] = useState<Contractor | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', comment: '' });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = META[kind];

  const open = (c: Contractor | 'new') => {
    setForm(c === 'new' ? { name: '', phone: '', comment: '' } : { name: c.name, phone: c.phone, comment: c.comment });
    setEdit(c);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error('Укажите название');
    setBusy(true);
    try {
      const row = { org_id: org.id, kind, name: form.name.trim(), phone: form.phone.trim(), comment: form.comment.trim() };
      if (edit === 'new') await q(db.from('contractors').insert(row));
      else if (edit) await q(db.from('contractors').update(row).eq('id', edit.id));
      setEdit(null);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!edit || edit === 'new') return;
    setBusy(true);
    try {
      await q(db.from('contractors').delete().eq('id', edit.id));
      setEdit(null);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const term = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term));
  const columns: Column<Contractor>[] = [
    { key: 'name', title: 'Название', fixed: true, sortable: true, value: (c) => c.name, render: (c) => <a>{c.name}</a> },
    { key: 'phone', title: 'Телефон', value: (c) => c.phone },
    { key: 'comment', title: 'Комментарий', value: (c) => c.comment },
  ];

  return (
    <>
      <div className="page-head"><h1>{meta.title}</h1></div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />{meta.one}</button>
        <input className="search" type="search" placeholder="Поиск по названию или телефону" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataTable id={`contractors-${kind}`} columns={columns} rows={rows} rowKey={(c) => c.id} loading={list.loading}
        error={list.error} empty={term ? 'Ничего не найдено' : meta.empty} onRowClick={open} />

      {edit && (
        <Modal
          title={edit === 'new' ? `${meta.one}: создание` : meta.one}
          onClose={() => setEdit(null)}
          width={460}
          footer={
            <>
              {edit !== 'new' && <button className="btn danger" disabled={busy} onClick={remove}>Удалить</button>}
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
              <span>Телефон</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
            </label>
            <label className="field">
              <span>Комментарий</span>
              <textarea rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
