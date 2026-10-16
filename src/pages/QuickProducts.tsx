import { useState } from 'react';
import { money } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useQuickGroups } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import type { Product, QuickGroup } from '../lib/types';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { ProductSearch } from '../ui/ProductSearch';
import { toast } from '../ui/toast';
import { addQuickGroup, addToQuickGroup, deleteQuickGroup, listQuickProducts, removeFromQuickGroup, renameQuickGroup, saveQuickName, setQuickGroupSort, setQuickSort } from '../api/products';

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
        ? listQuickProducts(org.id, current.id)
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
        const g = await addQuickGroup(org.id, groupName, list.length);
        setGroupId(g.id);
      } else if (edit) {
        await renameQuickGroup(groupName, edit.id);
      }
      setEdit(null);
      groups.reload();
    });

  const deleteGroup = () =>
    run(async () => {
      if (!edit || edit === 'new') return;
      await deleteQuickGroup(edit.id);
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
      await Promise.all(order.map((id, sort) => setQuickGroupSort(sort, id)));
      groups.reload();
    });

  const moveItem = (p: Product, dir: -1 | 1) =>
    run(async () => {
      const rows = items.data ?? [];
      const i = rows.findIndex((x) => x.id === p.id);
      if (!rows[i + dir]) return;
      const order = rows.map((x) => x.id);
      [order[i], order[i + dir]] = [order[i + dir], order[i]];
      await Promise.all(order.map((id, quick_sort) => setQuickSort(quick_sort, id)));
      items.reload();
    });

  const addProduct = (p: Product) =>
    run(async () => {
      if (!current) return;
      await addToQuickGroup(p.id, current.id, (items.data ?? []).length);
      items.reload();
    }, `Добавлено: ${p.name}`);

  const removeProduct = (p: Product) =>
    run(async () => {
      await removeFromQuickGroup(p.id);
      items.reload();
    });

  const saveName = () =>
    run(async () => {
      if (!rename) return;
      await saveQuickName(quickName, rename.id);
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
