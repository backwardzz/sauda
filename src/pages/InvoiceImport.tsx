import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { money, qty as fmtQty, round2 } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { decodeInvoice, invoiceUnit, type InvoiceItem } from '../lib/invoice';
import { useContractors } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { q } from '../lib/supabase';
import type { Product } from '../lib/types';
import { toast } from '../ui/toast';
import { useAction } from '../ui/useAction';
import { activeProductsQuery, importProducts } from '../api/products';
import { addSupplier } from '../api/org';
import { addSupplyLine, createSupplyDoc } from '../api/docs';

const NEW = '__new__';

/** Товары организации по штрихкодам накладной: основным и дополнительным. */
async function findProducts(orgId: string, codes: string[]): Promise<Map<string, Product>> {
  const byCode = new Map<string, Product>();
  const safe = [...new Set(codes)].filter((c) => /^[\w-]+$/.test(c));
  for (let i = 0; i < safe.length; i += 200) {
    const part = safe.slice(i, i + 200);
    const base = () => activeProductsQuery(orgId);
    const [main, extra] = await Promise.all([
      q<Product[]>(base().in('barcode', part)),
      q<Product[]>(base().overlaps('extra_barcodes', part)),
    ]);
    for (const p of extra) for (const c of p.extra_barcodes) if (part.includes(c)) byCode.set(c, p);
    for (const p of main) byCode.set(p.barcode, p);
  }
  return byCode;
}

export function InvoiceImport() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { org, store } = useWorkspace();
  const suppliers = useContractors(org.id, 'supplier');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [busy, run] = useAction();

  const parsed = useMemo(() => {
    try {
      return { invoice: decodeInvoice(params.get('d') ?? ''), error: null };
    } catch (e) {
      return { invoice: null, error: (e as Error).message };
    }
  }, [params]);
  const invoice = parsed.invoice;

  const found = useQuery(
    async () => (invoice ? findProducts(org.id, invoice.items.map((i) => i.barcode)) : new Map<string, Product>()),
    [org.id, invoice],
  );

  if (!invoice) {
    return (
      <>
        <div className="page-head"><h1>Накладная из фото</h1></div>
        <div className="card empty error-text">{parsed.error}</div>
      </>
    );
  }

  const list = suppliers.data ?? [];
  const guess = list.find((s) => s.name.trim().toLowerCase() === invoice.supplier.toLowerCase());
  const chosen = supplier ?? guess?.id ?? (invoice.supplier ? NEW : '');
  const map = found.data ?? new Map<string, Product>();
  const missing = invoice.items.filter((i) => !map.has(i.barcode));
  const total = round2(invoice.items.reduce((s, i) => s + i.qty * i.price, 0));
  const comment = [invoice.number && `Накладная № ${invoice.number}`, invoice.date && `от ${invoice.date}`].filter(Boolean).join(' ');

  const create = async () => {
    if (!chosen) return toast.error('Выберите поставщика');
    await run(async () => {
      let supplierId = chosen;
      if (chosen === NEW) {
        supplierId = (await addSupplier(org.id, invoice.supplier)).id;
      }
      let products = map;
      if (createMissing && missing.length) {
        await importProducts(org.id, null,
          missing.map((i) => ({ name: i.name || i.barcode, barcode: i.barcode, unit: invoiceUnit(i.unit), purchase_price: i.price })));
        products = await findProducts(org.id, invoice.items.map((i) => i.barcode));
      }

      // два штрихкода одного товара складываются в одну строку: цена — средняя по количеству
      const lines = new Map<string, { qty: number; cost: number }>();
      for (const i of invoice.items) {
        const p = products.get(i.barcode);
        if (!p || p.kind !== 'product') continue;
        const line = lines.get(p.id) ?? { qty: 0, cost: 0 };
        lines.set(p.id, { qty: line.qty + i.qty, cost: line.cost + i.qty * i.price });
      }
      if (!lines.size) throw new Error('Ни одного товара накладной нет в базе');

      const doc = await createSupplyDoc(store.id, comment, supplierId);
      for (const [productId, l] of lines) {
        await addSupplyLine(doc, productId, l.qty, l.cost);
      }
      toast.ok(`Черновик приёмки создан: товаров ${lines.size}. Проверьте и проведите.`);
      navigate(`/docs/supply/${doc}`, { replace: true });
    }, { keepBusy: true });
  };

  const willAdd = invoice.items.length - (createMissing ? 0 : missing.length);

  return (
    <>
      <div className="page-head">
        <h1>Накладная из фото</h1>
        <span className="muted">{[invoice.supplier, comment].filter(Boolean).join(' · ')}</span>
      </div>

      <div className="card filter-grid">
        <label className="field">
          <span>Поставщик <b>*</b></span>
          <select value={chosen} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Выберите поставщика</option>
            {invoice.supplier && !guess && <option value={NEW}>Создать: {invoice.supplier}</option>}
            {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Магазин</span>
          <input value={store.name} disabled />
        </label>
        {missing.length > 0 && (
          <label className="check-row" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            Создать товары, которых нет в базе: {missing.length}
          </label>
        )}
      </div>

      <div className="toolbar">
        <button className="btn primary" disabled={busy || found.loading || willAdd === 0} onClick={create}>Создать приёмку</button>
        <span className="muted">
          В черновик попадёт строк: {willAdd} из {invoice.items.length}. Остатки изменятся только после проведения.
        </span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Штрихкод</th>
              <th>Название в накладной</th>
              <th>Товар в базе</th>
              <th className="right">Количество</th>
              <th className="right">Цена, {org.currency}</th>
              <th className="right">Сумма, {org.currency}</th>
            </tr>
          </thead>
          <tbody>
            {found.error ? (
              <tr><td colSpan={6} className="table-note error-text">{found.error}</td></tr>
            ) : (
              invoice.items.map((i: InvoiceItem, n) => {
                const p = map.get(i.barcode);
                return (
                  <tr key={`${i.barcode}:${n}`} className={!p && !found.loading ? 'row-low' : ''}>
                    <td className="num">{i.barcode}</td>
                    <td>{i.name}</td>
                    <td>
                      {found.loading ? <span className="muted">…</span>
                        : p ? p.name
                        : <span className="badge warn">{createMissing ? 'нет в базе — будет создан' : 'нет в базе — пропустим'}</span>}
                    </td>
                    <td className="right">{fmtQty(i.qty)} {i.unit}</td>
                    <td className="right">{money(i.price)}</td>
                    <td className="right">{money(i.qty * i.price)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Итого: строк {invoice.items.length}</td>
              <td className="right">{fmtQty(invoice.items.reduce((s, i) => s + i.qty, 0))}</td>
              <td />
              <td className="right">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
