import { useRef, useState } from 'react';
import { generateBarcode } from '../../lib/barcode';
import { money, parseNum, qty as fmtQty } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { parseImport } from '../../lib/importParse';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { UNITS, type SupplierProduct, type Unit } from '../../lib/types';
import { exportXlsx, readXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { ProductImage } from '../../ui/ProductImage';
import { toast } from '../../ui/toast';

const EMPTY = { name: '', barcode: '', unit: 'шт' as Unit, category: '', price: '', pack: '1', image: '', available: true };

/** Каталог поставщика: то, что видят и заказывают магазины. */
export function SupplierCatalog() {
  const { org, canManage } = useOrg();
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<SupplierProduct | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const list = useQuery(
    () => q<SupplierProduct[]>(db.from('supplier_products').select('*').eq('org_id', org.id).eq('archived', false).order('category').order('name').limit(5000)),
    [org.id],
  );
  const all = list.data ?? [];
  const categories = [...new Set(all.map((p) => p.category).filter(Boolean))];
  const term = search.trim().toLowerCase();
  const rows = all.filter((p) => !term || p.name.toLowerCase().includes(term) || p.barcode.includes(term) || p.category.toLowerCase().includes(term));

  const open = (p: SupplierProduct | 'new') => {
    setForm(p === 'new' ? EMPTY : { name: p.name, barcode: p.barcode, unit: p.unit, category: p.category, price: String(p.price), pack: String(p.pack_qty), image: p.image_url, available: p.available });
    setEdit(p);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(ok);
      setEdit(null);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!form.name.trim() || !form.barcode.trim()) return toast.error('Укажите название и штрихкод');
    if (form.image.trim() && !/^https:\/\//i.test(form.image.trim())) return toast.error('Ссылка на фото должна начинаться с https://');
    const row = {
      org_id: org.id, name: form.name.trim(), barcode: form.barcode.trim(), unit: form.unit, category: form.category.trim(),
      price: parseNum(form.price), pack_qty: parseNum(form.pack) > 0 ? parseNum(form.pack) : 1, image_url: form.image.trim(), available: form.available,
    };
    void run(
      () => (edit === 'new' ? q(db.from('supplier_products').insert(row)) : q(db.from('supplier_products').update(row).eq('id', (edit as SupplierProduct).id))),
      edit === 'new' ? 'Товар добавлен в каталог' : 'Сохранено',
    );
  };

  const toggle = (p: SupplierProduct) =>
    run(() => q(db.from('supplier_products').update({ available: !p.available }).eq('id', p.id)), p.available ? 'Отмечено: нет в наличии' : 'Снова в наличии');

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const { items } = parseImport(await readXlsx(f));
      const total = { created: 0, updated: 0 };
      for (let i = 0; i < items.length; i += 500) {
        const res = await q<typeof total>(db.rpc('import_supplier_products', {
          p_org: org.id,
          // цена для магазинов: продажная из файла, а если её нет — закупочная
          p_rows: items.slice(i, i + 500).map((r) => ({ name: r.name, barcode: r.barcode, unit: r.unit, price: r.sale_price ?? r.purchase_price, category: r.category, pack_qty: r.qty })),
        }));
        total.created += res.created;
        total.updated += res.updated;
      }
      toast.ok(`Каталог обновлён: новых ${total.created}, изменено ${total.updated}`);
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const columns: Column<SupplierProduct>[] = [
    { key: 'name', title: 'Товар', fixed: true, sortable: true, value: (p) => p.name, render: (p) => <span className="row"><ProductImage src={p.image_url} alt="" className="small" /><a>{p.name}</a></span> },
    { key: 'barcode', title: 'Штрихкод', render: (p) => <span className="num">{p.barcode}</span> },
    { key: 'category', title: 'Категория', sortable: true, value: (p) => p.category },
    { key: 'pack', title: 'Упаковка', align: 'right', render: (p) => (Number(p.pack_qty) !== 1 ? `по ${fmtQty(p.pack_qty)} ${p.unit}` : p.unit) },
    { key: 'price', title: `Цена, ${org.currency}`, align: 'right', sortable: true, value: (p) => Number(p.price), render: (p) => money(p.price) },
    {
      key: 'available', title: 'Наличие',
      render: (p) => (
        <button className={`badge ${p.available ? 'ok' : 'danger'}`} style={{ border: 0, cursor: canManage ? 'pointer' : 'default' }} disabled={!canManage || busy}
          onClick={(e) => { e.stopPropagation(); void toggle(p); }} title="Нажмите, чтобы переключить">
          {p.available ? 'В наличии' : 'Нет в наличии'}
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Каталог</h1>
        <span className="muted">Товаров: {all.length}. Его видят все магазины на площадке.</span>
      </div>
      <div className="toolbar">
        {canManage && <button className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />Товар</button>}
        <input className="search" type="search" placeholder="Название, штрихкод или категория" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        {canManage && (
          <>
            <input ref={file} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => importFile(e.target.files?.[0])} />
            <button className="btn" disabled={busy} onClick={() => file.current?.click()} title="Столбцы: Название, Штрихкод, Ед. изм, Продажная цена, Категория, Кол-во (в упаковке)">
              <Icon name="upload" size={16} />Загрузить из Excel
            </button>
          </>
        )}
        <button className="btn" onClick={() => all.length && exportXlsx(`Каталог ${org.name}`, 'Каталог', all.map((p) => ({
          'Название': p.name, 'Штрихкод': p.barcode, 'Ед. изм': p.unit, 'Продажная цена': Number(p.price), 'Категория': p.category, 'Кол-во': Number(p.pack_qty),
        }))).catch(toast.error)}><Icon name="download" size={16} />Скачать</button>
      </div>
      <DataTable id="supplier-catalog" columns={columns} rows={rows} rowKey={(p) => p.id} loading={list.loading} error={list.error}
        empty={term ? 'Ничего не найдено' : 'Каталог пуст. Добавьте товары по одному или загрузите прайс из Excel.'} onRowClick={canManage ? open : undefined} />

      {edit && (
        <Modal title={edit === 'new' ? 'Новый товар каталога' : 'Товар каталога'} onClose={() => setEdit(null)}
          footer={
            <>
              {edit !== 'new' && (
                <button className="btn danger" disabled={busy} onClick={() => run(() => q(db.from('supplier_products').update({ archived: true }).eq('id', (edit as SupplierProduct).id)), 'Товар убран из каталога')}>
                  Убрать из каталога
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => setEdit(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
            </>
          }>
          <div className="form-grid">
            <label className="field wide">
              <span>Название <b>*</b></span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </label>
            <div className="field wide">
              <span>Штрихкод <b>*</b></span>
              <div className="input-group">
                <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} inputMode="numeric" />
                <button type="button" className="btn" onClick={() => setForm({ ...form, barcode: generateBarcode(form.unit) })}>Сгенерировать</button>
              </div>
              <span className="hint">По штрихкоду магазин находит товар у себя: укажите заводской, если он есть.</span>
            </div>
            <label className="field">
              <span>Цена для магазинов, {org.currency}</span>
              <input className="num-input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
            </label>
            <label className="field">
              <span>Единица измерения</span>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="field">
              <span>В упаковке, {form.unit}</span>
              <input className="num-input" value={form.pack} onChange={(e) => setForm({ ...form, pack: e.target.value })} inputMode="decimal" />
            </label>
            <label className="field">
              <span>Категория</span>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} list="supplier-categories" />
              <datalist id="supplier-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <div className="field wide">
              <span>Фото товара (ссылка)</span>
              <div className="row">
                <ProductImage src={form.image.trim()} alt="" className="small" key={form.image} />
                <input className="grow" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://…" inputMode="url" />
              </div>
            </div>
            <label className="check-row wide">
              <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} />
              В наличии: магазины могут заказывать
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
