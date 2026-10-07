import { useRef, useState } from 'react';
import { generateBarcode } from '../../lib/barcode';
import { parseNum } from '../../lib/format';
import { findPhoto, removeProductPhoto, uploadProductPhoto } from '../../lib/photo';
import { useCompany } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { UNITS, type CompanyProduct, type Unit, type Variant } from '../../lib/types';
import { fullName, sizeHints, splitName } from '../../lib/variants';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { ProductImage } from '../../ui/ProductImage';
import { SuggestInput } from '../../ui/SuggestInput';
import { toast } from '../../ui/toast';

interface Row {
  key: number;
  id?: string;
  label: string;
  barcode: string;
  unit: Unit;
  price: string;
  pack: string;
  active: boolean;
  track: boolean;
  min: string;
  /** филиал → остаток, как введён */
  stock: Record<string, string>;
}

interface Props {
  /** Без товара — новый. */
  product?: CompanyProduct;
  variants?: Variant[];
  stock?: Map<string, Record<string, number>>;
  /** Копия: поля те же, штрихкоды и остатки пустые. */
  duplicate?: boolean;
  categories: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
}

let nextKey = 1;
const blank = (from?: Row): Row => ({
  key: nextKey++, label: '', barcode: '', unit: from?.unit ?? 'шт', price: from?.price ?? '', pack: from?.pack ?? '1',
  active: true, track: from?.track ?? true, min: '', stock: {},
});

/** Товар со всеми видами в одном окне: фасовки, цены и остатки по филиалам сохраняются разом. */
export function ProductEditor({ product, variants = [], stock, duplicate, categories, onClose, onSaved }: Props) {
  const { org, branches } = useCompany();
  const isNew = !product || duplicate;
  const [form, setForm] = useState({
    name: product ? (duplicate ? `${product.name} (копия)` : product.name) : '',
    category: product?.category ?? '', description: product?.description ?? '', image: product?.image_url ?? '',
  });
  const [rows, setRows] = useState<Row[]>(() =>
    variants.length
      ? variants.map((v) => ({
          key: nextKey++, id: duplicate ? undefined : v.id, label: v.label, barcode: duplicate ? '' : v.barcode, unit: v.unit,
          price: String(Number(v.price)), pack: String(Number(v.pack_qty)), active: v.active, track: v.track_stock,
          min: v.min_stock == null ? '' : String(Number(v.min_stock)),
          stock: duplicate || !v.track_stock ? {} : Object.fromEntries(branches.map((b) => [b.id, String(stock?.get(v.id)?.[b.id] ?? 0)])),
        }))
      : [blank()],
  );
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  /** Ссылки на фото, загруженные с компьютера в этом окне. */
  const uploaded = useRef(new Set<string>());

  const patch = (key: number, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const add = (label = '') =>
    setRows((list) => {
      const tail = list[list.length - 1];
      // подсказка фасовки сначала заполняет пустую строку, а не плодит новые
      if (label && tail && !tail.id && !tail.label.trim() && !tail.barcode.trim()) return list.map((r) => (r === tail ? { ...r, label } : r));
      return [...list, { ...blank(tail), label }];
    });
  const last = rows[rows.length - 1];
  const hints = sizeHints(rows.map((r) => r.label), last?.unit ?? 'шт');

  // штрихкод из общего каталога площадки подсказывает название, категорию и единицу
  const lookup = async (row: Row) => {
    const code = row.barcode.trim();
    if (!code || (form.name.trim() && row.label.trim())) return;
    const found = await q<{ name: string; unit: Unit; category: string; subcategory: string } | null>(
      db.from('catalog_products').select('name, unit, category, subcategory').eq('barcode', code).maybeSingle(),
    ).catch(() => null);
    if (!found) return;
    const parts = splitName(found.name);
    setForm((f) => ({ ...f, name: f.name.trim() || parts.product, category: f.category.trim() || found.subcategory || found.category }));
    patch(row.key, { label: row.label.trim() || parts.label, unit: found.unit });
    toast.ok(`Нашли в общем каталоге: ${found.name}`);
  };

  const photo = async () => {
    const code = rows.map((r) => r.barcode.trim()).find((c) => /^\d{8,14}$/.test(c) && !c.startsWith('2'));
    if (!code) return toast.error('Сначала укажите заводской штрихкод одного из видов');
    setLooking(true);
    const url = await findPhoto(code);
    setLooking(false);
    if (!url) return toast.error('В открытых базах фото этого товара нет: вставьте ссылку на своё');
    setForm((f) => ({ ...f, image: url }));
  };

  // Фото с компьютера: файл уходит в хранилище, ссылка подставляется в товар.
  // У существующего товара она записывается сразу, у нового — вместе с остальными полями при публикации.
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadProductPhoto(org.id, f);
      const before = form.image.trim();
      setForm((cur) => ({ ...cur, image: url }));
      if (!isNew) {
        await q(db.from('company_products').update({ image_url: url }).eq('id', product!.id));
        toast.ok('Фото загружено и сохранено в товаре');
        onSaved(product!.id);
      } else toast.ok('Фото загружено: оно сохранится вместе с товаром');
      // прежний файл убираем, только если он загружен в этом же окне: у копии товара фото общее с оригиналом
      if (uploaded.current.has(before)) void removeProductPhoto(before);
      uploaded.current.add(url);
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const save = async (more: boolean) => {
    if (!form.name.trim()) return toast.error('Укажите название товара');
    if (form.image.trim() && !/^https:\/\//i.test(form.image.trim()) && !uploaded.current.has(form.image.trim()) && form.image.trim() !== product?.image_url) {
      return toast.error('Ссылка на фото должна начинаться с https://');
    }
    const labels = rows.map((r) => r.label.trim().toLowerCase());
    if (rows.length > 1 && new Set(labels).size < labels.length) return toast.error('У видов должны быть разные подписи: например, «0,5 л» и «1 л»');
    setBusy(true);
    try {
      const id = await q<string>(db.rpc('save_company_product', {
        p_org: org.id,
        p_product: { id: isNew ? null : product!.id, name: form.name, category: form.category, description: form.description, image_url: form.image.trim() },
        p_variants: rows.map((r) => ({
          id: r.id ?? null, label: r.label,
          // пустой штрихкод — внутренний код: товар без заводского кода тоже можно продавать
          barcode: r.barcode.trim() || generateBarcode(r.unit), unit: r.unit, price: parseNum(r.price),
          pack_qty: parseNum(r.pack) > 0 ? parseNum(r.pack) : 1, active: r.active, track_stock: r.track,
          min_stock: r.track && r.min.trim() ? Math.max(parseNum(r.min), 0) : null,
          stock: r.track ? Object.fromEntries(Object.entries(r.stock).filter(([, v]) => v.trim() !== '').map(([b, v]) => [b, Math.max(parseNum(v), 0)])) : null,
        })),
      }));
      toast.ok(isNew ? `Товар опубликован: ${form.name.trim()}` : 'Сохранено');
      onSaved(id);
      if (more) {
        setForm({ name: '', category: form.category, description: '', image: '' });
        setRows([blank(last)]);
      } else onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'Новый товар' : `Товар: ${product!.name}`} onClose={onClose} width={1040 + Math.max(branches.length - 1, 0) * 90}
      footer={
        <>
          <span className="hint grow" style={{ alignSelf: 'center' }}>Магазины увидят виды, отмеченные «в продаже».</span>
          <button className="btn" onClick={onClose}>Отмена</button>
          {isNew && <button className="btn" disabled={busy} onClick={() => save(true)}>Сохранить и добавить ещё</button>}
          <button className="btn primary" disabled={busy} onClick={() => save(false)}>{isNew ? 'Опубликовать' : 'Сохранить'}</button>
        </>
      }>
      <div className="editor-top">
        <ProductImage src={form.image.trim()} alt="" key={form.image} />
        <div className="form-grid grow">
          <label className="field">
            <span>Название товара <b>*</b></span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Coca-Cola" />
          </label>
          <div className="field">
            <span>Категория</span>
            <SuggestInput value={form.category} onChange={(category) => setForm((cur) => ({ ...cur, category }))} options={categories} placeholder="Напитки" aria-label="Категория" />
          </div>
          <div className="field wide">
            <span>Фото товара: с компьютера, по штрихкоду или ссылкой</span>
            <div className="input-group">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
              <button type="button" className="btn" disabled={uploading} onClick={() => file.current?.click()} title="Картинка PNG, JPG или WebP: сожмётся сама">
                <Icon name="upload" size={16} />{uploading ? 'Загружаем…' : 'С компьютера'}
              </button>
              <button type="button" className="btn" disabled={looking} onClick={photo} title="Ищет фото по заводскому штрихкоду в открытых базах товаров">
                <Icon name="search" size={16} />{looking ? 'Ищем…' : 'Найти по штрихкоду'}
              </button>
              <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="или ссылка https://…" inputMode="url" aria-label="Ссылка на фото" />
            </div>
          </div>
          <label className="field wide">
            <span>Описание</span>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Состав, срок годности, условия хранения — что важно знать магазину" />
          </label>
        </div>
      </div>

      <div className="section-title">Виды товара: фасовки со своим штрихкодом, ценой и остатком</div>
      <div className="table-wrap">
        <table className="table variant-table compact">
          <thead>
            <tr>
              <th>Вид</th>
              <th>Штрихкод</th>
              <th>Ед.</th>
              <th className="right">В упаковке</th>
              <th className="right">Цена, {org.currency}</th>
              <th className="center" title="Заказать можно не больше свободного остатка">Учёт остатка</th>
              {branches.map((b) => <th key={b.id} className="right" title={`Остаток на складе: ${b.name}`}>{branches.length > 1 ? b.name : 'Остаток'}</th>)}
              <th className="right" title="Остаток, при котором вид помечается «заканчивается»">Мало, если ≤</th>
              <th className="center">В продаже</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><input className="cell-label" value={r.label} onChange={(e) => patch(r.key, { label: e.target.value })} placeholder={rows.length > 1 ? '0,5 л' : 'если видов несколько'} aria-label="Вид" /></td>
                <td>
                  <div className="input-group">
                    <input className="cell-barcode" value={r.barcode} onChange={(e) => patch(r.key, { barcode: e.target.value })} onBlur={() => lookup(r)}
                      inputMode="numeric" placeholder="заводской или пусто" aria-label={`Штрихкод: ${fullName(form.name, r.label)}`} />
                    <button type="button" className="icon-btn" onClick={() => patch(r.key, { barcode: generateBarcode(r.unit) })} title="Сгенерировать внутренний штрихкод" aria-label="Сгенерировать штрихкод">
                      <Icon name="bolt" size={15} />
                    </button>
                  </div>
                </td>
                <td>
                  <select value={r.unit} onChange={(e) => patch(r.key, { unit: e.target.value as Unit })} aria-label="Единица измерения">
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td><input className="num-input cell-num" value={r.pack} onChange={(e) => patch(r.key, { pack: e.target.value })} inputMode="decimal" aria-label="В упаковке" /></td>
                <td><input className="num-input cell-num" value={r.price} onChange={(e) => patch(r.key, { price: e.target.value })} inputMode="decimal" placeholder="0" aria-label="Цена" /></td>
                <td className="center"><input type="checkbox" checked={r.track} onChange={(e) => patch(r.key, { track: e.target.checked })} aria-label="Учитывать остаток" /></td>
                {branches.map((b) => (
                  <td key={b.id}>
                    <input className="num-input cell-num" value={r.track ? (r.stock[b.id] ?? '') : ''} disabled={!r.track} placeholder={r.track ? '0' : '∞'}
                      onChange={(e) => patch(r.key, { stock: { ...r.stock, [b.id]: e.target.value } })} inputMode="decimal" aria-label={`Остаток, ${b.name}`} />
                  </td>
                ))}
                <td><input className="num-input cell-num" value={r.track ? r.min : ''} disabled={!r.track} onChange={(e) => patch(r.key, { min: e.target.value })} inputMode="decimal" placeholder="—" aria-label="Порог остатка" /></td>
                <td className="center"><input type="checkbox" checked={r.active} onChange={(e) => patch(r.key, { active: e.target.checked })} aria-label="В продаже" /></td>
                <td>
                  <button type="button" className="icon-btn small danger" disabled={rows.length === 1} onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Убрать вид">
                    <Icon name="x" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={() => add()}><Icon name="plus" size={16} />Добавить вид</button>
        {hints.slice(0, 6).map((h) => <button type="button" key={h} className="btn ghost small" onClick={() => add(h)}>+ {h}</button>)}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Штрихкод, который уже есть в общем каталоге площадки, сам подставит название и категорию. Без учёта остатка вид всегда в наличии.
      </p>
    </Modal>
  );
}
