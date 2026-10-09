import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { generateBarcode } from '../lib/barcode';
import { dateTime, markupPct, parseNum, qty, round2 } from '../lib/format';
import { useChanged, useQuery } from '../lib/hooks';
import { fullProductName } from '../lib/productAttrs';
import { categoryTree, useCategories, useContractors, useQuickGroups } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q } from '../lib/supabase';
import { MOVE_REASON, PACK_UNITS, PACKAGES, SIZE_UNITS, UNITS, type PackUnit, type Product, type SizeUnit, type StockMove, type Unit } from '../lib/types';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Confirm } from '../ui/Modal';
import { toast } from '../ui/toast';
import { CategoryModal } from './CategoryModal';

interface Form {
  /** Название без объёма, процента и упаковки: они в своих полях. */
  title: string;
  size: string;
  sizeUnit: SizeUnit;
  percent: string;
  packQty: string;
  packUnit: PackUnit;
  packageName: string;
  unit: Unit;
  barcode: string;
  extra: string;
  sku: string;
  minStock: string;
  purchase: string;
  markup: string;
  sale: string;
  wholesale: string;
  category: string;
  supplier: string;
  quickGroup: string;
  quickName: string;
}

const EMPTY: Form = {
  title: '', size: '', sizeUnit: 'г', percent: '', packQty: '', packUnit: 'шт', packageName: '', unit: 'шт', barcode: '', extra: '', sku: '', minStock: '', purchase: '', markup: '', sale: '',
  wholesale: '', category: '', supplier: '', quickGroup: '', quickName: '',
};

const str = (n: number | null | undefined) => (n == null || n === 0 ? '' : String(n));

function toForm(p: Product): Form {
  return {
    title: p.title, size: p.size_value == null ? '' : String(p.size_value), sizeUnit: p.size_unit ?? 'г',
    percent: p.percent == null ? '' : String(p.percent), packQty: p.pack_qty == null ? '' : String(p.pack_qty),
    packUnit: p.pack_unit ?? 'шт', packageName: p.package ?? '', unit: p.unit, barcode: p.barcode, extra: p.extra_barcodes.join(', '), sku: p.sku,
    minStock: p.min_stock == null ? '' : String(p.min_stock),
    purchase: str(p.purchase_price), markup: str(markupPct(p.purchase_price, p.sale_price)), sale: str(p.sale_price),
    wholesale: str(p.wholesale_price), category: p.category_id ?? '', supplier: p.supplier_id ?? '',
    quickGroup: p.quick_group_id ?? '', quickName: p.quick_name,
  };
}

export function ProductCard() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { org, store, stores } = useWorkspace();
  const isService = params.get('kind') === 'service';
  const categories = useCategories(org.id);
  const suppliers = useContractors(org.id, 'supplier');
  const quickGroups = useQuickGroups(org.id);

  const [form, setForm] = useState<Form>(EMPTY);
  const [tab, setTab] = useState<'main' | 'moves'>('main');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [catModal, setCatModal] = useState(false);

  const product = useQuery(
    async () => (id ? q<Product>(db.from('products').select('*').eq('id', id).eq('org_id', org.id).single()) : null),
    [id, org.id],
  );
  const stock = useQuery(
    async () => (id ? q<{ store_id: string; qty: number }[]>(db.from('stock').select('store_id, qty').eq('product_id', id)) : []),
    [id],
  );
  const moves = useQuery(
    async () =>
      id && tab === 'moves'
        ? q<StockMove[]>(
            db.from('stock_moves').select('id, delta, qty_after, reason, ref_number, created_at')
              .eq('product_id', id).eq('store_id', store.id).order('id', { ascending: false }).limit(200),
          )
        : [],
    [id, tab, store.id],
  );

  if (useChanged([product.data, id], true)) {
    if (product.data) setForm(toForm(product.data));
    else if (!id) setForm(EMPTY);
  }

  const kind = product.data?.kind ?? (isService ? 'service' : 'product');
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Закупочная, наценка и продажная связаны: меняется одно — пересчитывается парное.
  const setPurchase = (v: string) => {
    const m = parseNum(form.markup);
    set({ purchase: v, ...(m > 0 && parseNum(v) > 0 ? { sale: String(round2(parseNum(v) * (1 + m / 100))) } : {}) });
  };
  const setMarkup = (v: string) => {
    const p = parseNum(form.purchase);
    set({ markup: v, ...(p > 0 ? { sale: String(round2(p * (1 + parseNum(v) / 100))) } : {}) });
  };
  const setSale = (v: string) => {
    const p = parseNum(form.purchase);
    set({ sale: v, ...(p > 0 ? { markup: String(markupPct(p, parseNum(v))) } : {}) });
  };
  const setCategory = (catId: string) => {
    const cat = (categories.data ?? []).find((c) => c.id === catId);
    if (!id && cat && cat.markup_pct > 0 && !form.markup) {
      const p = parseNum(form.purchase);
      set({ category: catId, markup: String(cat.markup_pct), ...(p > 0 ? { sale: String(round2(p * (1 + cat.markup_pct / 100))) } : {}) });
    } else set({ category: catId });
  };

  const attrs = {
    title: form.title.trim(),
    size_value: parseNum(form.size) > 0 ? parseNum(form.size) : null,
    size_unit: parseNum(form.size) > 0 ? form.sizeUnit : null,
    percent: form.percent.trim() === '' ? null : parseNum(form.percent),
    pack_qty: parseNum(form.packQty) > 0 ? Math.round(parseNum(form.packQty)) : null,
    pack_unit: parseNum(form.packQty) > 0 ? form.packUnit : null,
    package: form.packageName.trim() || null,
  };
  const fullName = fullProductName(attrs);

  const save = async () => {
    if (!form.title.trim()) return toast.error('Укажите название');
    const pct = form.percent.trim() === '' ? null : parseNum(form.percent);
    if (pct != null && (pct < 0 || pct > 100)) return toast.error('Процент — от 0 до 100');
    if (!form.barcode.trim()) return toast.error('Укажите штрихкод или сгенерируйте внутренний');
    setBusy(true);
    try {
      const row = {
        org_id: org.id,
        kind,
        // name соберёт база из названия и полей ниже; здесь — то же самое для новой записи
        name: fullName,
        ...attrs,
        unit: form.unit,
        barcode: form.barcode.trim(),
        extra_barcodes: [...new Set(form.extra.split(/[;,\s]+/).map((c) => c.trim()).filter(Boolean))],
        sku: form.sku.trim(),
        min_stock: form.minStock.trim() === '' ? null : parseNum(form.minStock),
        purchase_price: parseNum(form.purchase),
        sale_price: parseNum(form.sale),
        wholesale_price: parseNum(form.wholesale),
        category_id: form.category || null,
        supplier_id: form.supplier || null,
        quick_group_id: form.quickGroup || null,
        quick_name: form.quickName.trim(),
      };
      if (id) await q(db.from('products').update(row).eq('id', id));
      else await q(db.from('products').insert(row));
      toast.ok(id ? 'Изменения сохранены' : kind === 'service' ? 'Услуга создана' : 'Товар создан');
      navigate('/products');
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await q(db.from('products').update({ archived: true, quick_group_id: null }).eq('id', id));
      toast.ok('Товар удалён');
      navigate('/products');
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const moveColumns: Column<StockMove>[] = [
    { key: 'date', title: 'Дата', render: (m) => dateTime(m.created_at) },
    { key: 'reason', title: 'Операция', render: (m) => `${MOVE_REASON[m.reason]}${m.ref_number ? ` № ${m.ref_number}` : ''}` },
    {
      key: 'delta', title: 'Изменение', align: 'right',
      render: (m) => <span className={m.delta < 0 ? 'error-text' : 'ok-text'}>{m.delta > 0 ? '+' : ''}{qty(m.delta)}</span>,
    },
    { key: 'after', title: 'Остаток после', align: 'right', render: (m) => qty(m.qty_after) },
  ];

  if (id && product.loading) return <div className="empty">Загрузка…</div>;
  if (id && (product.error || !product.data)) return <div className="empty">Товар не найден</div>;

  const noun = kind === 'service' ? 'Услуга' : 'Товар';

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/products')} aria-label="Назад к списку"><Icon name="back" /></button>
        <h1>{noun} <span className="muted" style={{ fontWeight: 400 }}>| {id ? 'Редактирование' : 'Создание'}</span></h1>
      </div>

      {id && kind === 'product' && (
        <div className="tabs">
          <button className={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')}>Основное</button>
          <button className={tab === 'moves' ? 'active' : ''} onClick={() => setTab('moves')}>История движения товара</button>
        </div>
      )}

      {tab === 'moves' ? (
        <>
          <p className="muted" style={{ marginBottom: 10 }}>Магазин: {store.name}. Показаны последние 200 операций.</p>
          <DataTable id="product-moves" columns={moveColumns} rows={moves.data ?? []} rowKey={(m) => String(m.id)}
            loading={moves.loading} error={moves.error} empty="Движений по товару ещё не было" />
        </>
      ) : (
        <>
          <div className="toolbar">
            <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
            {id && <button className="btn danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Удалить</button>}
            <button className="btn" onClick={() => navigate('/products')}>Закрыть</button>
          </div>

          <div className="card pad" style={{ maxWidth: 860 }}>
            <div className="section-title">Основная информация</div>
            <div className="form-grid">
              <label className="field wide">
                <span>Название <b>*</b></span>
                <input value={form.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!id}
                  placeholder="без объёма и упаковки: Coca-Cola" />
              </label>
              <div className="field">
                <span>Объём / вес</span>
                <div className="input-group">
                  <input value={form.size} onChange={(e) => set({ size: e.target.value })} inputMode="decimal" placeholder="0,5" />
                  <select value={form.sizeUnit} onChange={(e) => set({ sizeUnit: e.target.value as SizeUnit })} aria-label="Единица объёма или веса">
                    {SIZE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <label className="field">
                <span>Процент (жирность, крепость)</span>
                <input value={form.percent} onChange={(e) => set({ percent: e.target.value })} inputMode="decimal" placeholder="2,5" />
              </label>
              <div className="field">
                <span>Количество в упаковке</span>
                <div className="input-group">
                  <input value={form.packQty} onChange={(e) => set({ packQty: e.target.value })} inputMode="numeric" placeholder="25" />
                  <select value={form.packUnit} onChange={(e) => set({ packUnit: e.target.value as PackUnit })} aria-label="Чего в упаковке">
                    {PACK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <label className="field">
                <span>Упаковка</span>
                <input value={form.packageName} onChange={(e) => set({ packageName: e.target.value })} list="product-packages" placeholder="ж/б, ст/б, ПЭТ" maxLength={20} />
                <datalist id="product-packages">{PACKAGES.map((p) => <option key={p} value={p} />)}</datalist>
              </label>
              <p className="hint wide">На чеке и в поиске: <b>{fullName || '—'}</b></p>
              <label className="field">
                <span>Единица измерения <b>*</b></span>
                <select value={form.unit} onChange={(e) => set({ unit: e.target.value as Unit })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <div className="field">
                <span>Штрихкод <b>*</b></span>
                <div className="input-group">
                  <input value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} inputMode="numeric" />
                  <button type="button" className="btn" onClick={() => set({ barcode: generateBarcode(form.unit) })}>Сгенерировать</button>
                </div>
              </div>
              <label className="field">
                <span>Дополнительные штрихкоды</span>
                <input value={form.extra} onChange={(e) => set({ extra: e.target.value })} placeholder="через запятую" />
              </label>
              <label className="field">
                <span>Артикул</span>
                <input value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
              </label>
              {kind === 'product' && (
                <label className="field">
                  <span>Критический остаток</span>
                  <input className="num-input" value={form.minStock} onChange={(e) => set({ minStock: e.target.value })} inputMode="decimal" placeholder="не отслеживать" />
                </label>
              )}
            </div>
            {form.unit === 'кг' && (
              <p className="hint" style={{ marginTop: 8 }}>
                Весовой штрихкод: первые 7 цифр — код товара, следующие 5 весы заменяют весом в граммах. Касса сама прочитает вес с этикетки.
              </p>
            )}

            <div className="section-title">Цены, {org.currency}</div>
            <div className="form-grid">
              <label className="field">
                <span>Закупочная цена</span>
                <input className="num-input" value={form.purchase} onChange={(e) => setPurchase(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Наценка, %</span>
                <input className="num-input" value={form.markup} onChange={(e) => setMarkup(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Продажная цена</span>
                <input className="num-input" value={form.sale} onChange={(e) => setSale(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Оптовая цена</span>
                <input className="num-input" value={form.wholesale} onChange={(e) => set({ wholesale: e.target.value })} inputMode="decimal" />
              </label>
            </div>

            <div className="section-title">Категории и быстрые товары</div>
            <div className="form-grid">
              <div className="field">
                <span>Категория</span>
                <div className="input-group">
                  <select className="grow" value={form.category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Без категории</option>
                    {tree.map(({ cat, depth }) => <option key={cat.id} value={cat.id}>{depth ? '— ' : ''}{cat.name}</option>)}
                  </select>
                  <button type="button" className="btn" onClick={() => setCatModal(true)} aria-label="Создать категорию"><Icon name="plus" size={16} /></button>
                </div>
              </div>
              <label className="field">
                <span>Поставщик</span>
                <select value={form.supplier} onChange={(e) => set({ supplier: e.target.value })}>
                  <option value="">Не указан</option>
                  {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Группа быстрых товаров</span>
                <select value={form.quickGroup} onChange={(e) => set({ quickGroup: e.target.value })}>
                  <option value="">Не показывать на кассе</option>
                  {(quickGroups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Короткое название для кассы</span>
                <input value={form.quickName} onChange={(e) => set({ quickName: e.target.value })} disabled={!form.quickGroup} placeholder={fullName} />
              </label>
            </div>

            {id && kind === 'product' && (
              <>
                <div className="section-title">Остатки</div>
                <div className="row wrap">
                  {stores.map((s) => (
                    <span className="badge" key={s.id}>
                      {s.name}: {qty((stock.data ?? []).find((r) => r.store_id === s.id)?.qty ?? 0)} {form.unit}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {confirmDelete && (
        <Confirm title={`Удалить: ${fullName}`} text="Товар исчезнет из списка и с кассы. История продаж и движения сохранится."
          confirmLabel="Удалить" danger busy={busy} onConfirm={remove} onClose={() => setConfirmDelete(false)} />
      )}
      {catModal && (
        <CategoryModal orgId={org.id} categories={categories.data ?? []} onClose={() => setCatModal(false)}
          onSaved={(c) => {
            setCatModal(false);
            categories.reload();
            if (c) set({ category: c.id });
          }} />
      )}
    </>
  );
}
