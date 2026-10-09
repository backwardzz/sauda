import { useState } from 'react';
import { money } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useQuickGroups } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q } from '../lib/supabase';
import type { Product, QuickGroup } from '../lib/types';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { ProductSearch } from '../ui/ProductSearch';
import { toast } from '../ui/toast';

export function QuickProducts() {
  const { org } = useWorkspace();
  const groups = useQuickGroups(org.id);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [edit, setEdit] = useState<QuickGroup | 'new' | null>(null);
  const [groupName, setGroupName] = useState('');
  const [adding, setAdding] = useState(false);
  const [rename, setRename] = useState<Product | null>(null);
  const [quickName, setQuickName] = useState('');

  const list = groups.data ?? [];
  const current = list.find((g) => g.id === groupId) ?? list[0] ?? null;
  if (current && current.id !== groupId) setGroupId(current.id);

  const items = useQuery(
    async () =>
      current
        ? q<Product[]>(
            db.from('products').select('*').eq('org_id', org.id).eq('quick_group_id', current.id)
              .eq('archived', false).order('quick_sort').order('name'),
          )
        : [],
    [org.id, current?.id],
  );

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.ok(ok);
    } catch (e) {
      toast.error(e);
    }
  };

  const saveGroup = () =>
    run(async () => {
      if (!groupName.trim()) throw new Error('Укажите название группы');
      if (edit === 'new') {
        const g = await q<QuickGroup>(
          db.from('quick_groups').insert({ org_id: org.id, name: groupName.trim(), sort: list.length }).select().single(),
        );
        setGroupId(g.id);
      } else if (edit) {
        await q(db.from('quick_groups').update({ name: groupName.trim() }).eq('id', edit.id));
      }
      setEdit(null);
      groups.reload();
    });

  const deleteGroup = () =>
    run(async () => {
      if (!edit || edit === 'new') return;
      await q(db.from('quick_groups').delete().eq('id', edit.id));
      setEdit(null);
      groups.reload();
    }, 'Группа удалена, товары убраны с кассы');

  const moveGroup = (g: QuickGroup, dir: -1 | 1) =>
    run(async () => {
      const i = list.findIndex((x) => x.id === g.id);
      const other = list[i + dir];
      if (!other) return;
      const order = list.map((x) => x.id);
      [order[i], order[i + dir]] = [order[i + dir], order[i]];
      await Promise.all(order.map((id, sort) => q(db.from('quick_groups').update({ sort }).eq('id', id))));
      groups.reload();
    });

  const moveItem = (p: Product, dir: -1 | 1) =>
    run(async () => {
      const rows = items.data ?? [];
      const i = rows.findIndex((x) => x.id === p.id);
      if (!rows[i + dir]) return;
      const order = rows.map((x) => x.id);
      [order[i], order[i + dir]] = [order[i + dir], order[i]];
      await Promise.all(order.map((id, quick_sort) => q(db.from('products').update({ quick_sort }).eq('id', id))));
      items.reload();
    });

  const addProduct = (p: Product) =>
    run(async () => {
      if (!current) return;
      await q(db.from('products').update({ quick_group_id: current.id, quick_sort: (items.data ?? []).length }).eq('id', p.id));
      items.reload();
    }, `Добавлено: ${p.name}`);

  const removeProduct = (p: Product) =>
    run(async () => {
      await q(db.from('products').update({ quick_group_id: null }).eq('id', p.id));
      items.reload();
    });

  const saveName = () =>
    run(async () => {
      if (!rename) return;
      await q(db.from('products').update({ quick_name: quickName.trim() }).eq('id', rename.id));
      setRename(null);
      items.reload();
    });

  const columns: Column<Product>[] = [
    { key: 'name', title: 'Наименование', fixed: true, render: (p) => <b style={{ fontWeight: 550 }}>{p.quick_name || p.name}</b> },
    { key: 'barcode', title: 'Штрихкод', render: (p) => <span className="num">{p.barcode}</span> },
    { key: 'original', title: 'Оригинальное название', value: (p) => p.name },
    { key: 'price', title: 'Цена', align: 'right', render: (p) => money(p.sale_price) },
    {
      key: 'actions', title: '', fixed: true, width: '140px',
      render: (p) => (
        <div className="cell-actions">
          <button className="icon-btn small" onClick={() => moveItem(p, -1)} aria-label="Выше"><Icon name="up" size={15} /></button>
          <button className="icon-btn small" onClick={() => moveItem(p, 1)} aria-label="Ниже"><Icon name="down" size={15} /></button>
          <button className="icon-btn small" onClick={() => { setRename(p); setQuickName(p.quick_name); }} aria-label="Изменить название"><Icon name="edit" size={15} /></button>
          <button className="icon-btn small danger" onClick={() => removeProduct(p)} aria-label="Убрать из быстрых"><Icon name="x" size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Быстрые товары</h1>
        <span className="muted">Плитки на экране кассы для товаров без штрихкода и ходовых позиций</span>
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!current} onClick={() => setAdding(true)}><Icon name="plus" size={16} />Быстрый товар</button>
        <button className="btn" onClick={() => { setEdit('new'); setGroupName(''); }}><Icon name="plus" size={16} />Группа</button>
      </div>

      {list.length === 0 && !groups.loading ? (
        <div className="card empty">Создайте первую группу, например «Выпечка» или «Овощи», и добавьте в неё товары.</div>
      ) : (
        <div className="split">
          <div className="card side-list">
            {list.map((g) => (
              <div className="row" key={g.id} style={{ gap: 0 }}>
                <button className={`grow ${current?.id === g.id ? 'active' : ''}`} onClick={() => setGroupId(g.id)}>{g.name}</button>
                <button className="icon-btn small" onClick={() => moveGroup(g, -1)} aria-label="Выше"><Icon name="up" size={14} /></button>
                <button className="icon-btn small" onClick={() => moveGroup(g, 1)} aria-label="Ниже"><Icon name="down" size={14} /></button>
                <button className="icon-btn small" onClick={() => { setEdit(g); setGroupName(g.name); }} aria-label="Изменить группу"><Icon name="edit" size={14} /></button>
              </div>
            ))}
          </div>
          <DataTable id="quick" columns={columns} rows={items.data ?? []} rowKey={(p) => p.id} loading={items.loading}
            error={items.error} empty="В группе пока нет товаров" />
        </div>
      )}

      {edit && (
        <Modal
          title={edit === 'new' ? 'Новая группа' : 'Изменение названия группы'}
          onClose={() => setEdit(null)}
          width={420}
          footer={
            <>
              {edit !== 'new' && <button className="btn danger" onClick={deleteGroup}>Удалить</button>}
              <span className="spacer" />
              <button className="btn" onClick={() => setEdit(null)}>Отмена</button>
              <button className="btn primary" onClick={saveGroup}>{edit === 'new' ? 'Создать' : 'Изменить'}</button>
            </>
          }
        >
          <label className="field">
            <span>Название группы</span>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && saveGroup()} />
          </label>
        </Modal>
      )}

      {adding && current && (
        <Modal title={`Добавить в группу «${current.name}»`} onClose={() => setAdding(false)} width={520}
          footer={<button className="btn" onClick={() => setAdding(false)}>Готово</button>}>
          <div style={{ minHeight: 220 }}>
            <ProductSearch orgId={org.id} onPick={addProduct} autoFocus />
            <p className="hint" style={{ marginTop: 10 }}>Найдите товар по названию или штрихкоду. Можно добавить несколько подряд.</p>
          </div>
        </Modal>
      )}

      {rename && (
        <Modal title="Изменение быстрого товара" onClose={() => setRename(null)} width={420}
          footer={
            <>
              <button className="btn" onClick={() => setRename(null)}>Отмена</button>
              <button className="btn primary" onClick={saveName}>Изменить</button>
            </>
          }>
          <label className="field">
            <span>Короткое название на кассе</span>
            <input value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder={rename.name} autoFocus onKeyDown={(e) => e.key === 'Enter' && saveName()} />
          </label>
        </Modal>
      )}
    </>
  );
}
