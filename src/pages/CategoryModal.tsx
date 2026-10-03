import { useState } from 'react';
import { parseNum } from '../lib/format';
import { db, q } from '../lib/supabase';
import type { Category } from '../lib/types';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';

interface Props {
  orgId: string;
  category?: Category;
  categories: Category[];
  onClose: () => void;
  onSaved: (c?: Category) => void;
}

export function CategoryModal({ orgId, category, categories, onClose, onSaved }: Props) {
  const [name, setName] = useState(category?.name ?? '');
  const [markup, setMarkup] = useState(String(category?.markup_pct ?? 0));
  const [parent, setParent] = useState(category?.parent_id ?? '');
  const [busy, setBusy] = useState(false);
  const roots = categories.filter((c) => !c.parent_id && c.id !== category?.id);
  const hasChildren = !!category && categories.some((c) => c.parent_id === category.id);

  const save = async () => {
    if (!name.trim()) return toast.error('Укажите название категории');
    setBusy(true);
    try {
      const row = { org_id: orgId, name: name.trim(), markup_pct: parseNum(markup), parent_id: parent || null };
      const saved = category
        ? await q<Category>(db.from('categories').update(row).eq('id', category.id).select().single())
        : await q<Category>(db.from('categories').insert(row).select().single());
      toast.ok(category ? 'Категория сохранена' : 'Категория создана');
      onSaved(saved);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!category) return;
    setBusy(true);
    try {
      await q(db.from('categories').delete().eq('id', category.id));
      toast.ok('Категория удалена, товары остались без категории');
      onSaved();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={category ? 'Категория' : 'Создание категории'}
      onClose={onClose}
      width={440}
      footer={
        <>
          {category && <button className="btn danger" disabled={busy} onClick={remove}>Удалить</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Название <b>*</b></span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Наценка на товары категории, %</span>
          <input className="num-input" value={markup} onChange={(e) => setMarkup(e.target.value)} inputMode="decimal" />
        </label>
        {!hasChildren && (
          <label className="field">
            <span>Входит в категорию</span>
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— это основная категория —</option>
              {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <p className="hint">Наценка подставляется в продажную цену, когда у нового товара указана закупочная.</p>
      </div>
    </Modal>
  );
}
