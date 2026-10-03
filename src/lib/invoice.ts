// Накладная, переданная из приложения «Накладные в Sauda» (распознавание фото).
// Данные едут в адресе после #, то есть не покидают браузер: /#/invoice?d=<base64url(JSON)>.

export interface InvoiceItem {
  barcode: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
}

export interface InvoicePayload {
  supplier: string;
  number: string;
  date: string;
  items: InvoiceItem[];
}

export function encodeInvoice(p: InvoicePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...p }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeInvoice(d: string): InvoicePayload {
  let raw: unknown;
  try {
    const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/'));
    raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    throw new Error('Ссылка с накладной повреждена. Отправьте накладную ещё раз.');
  }
  const o = raw as { supplier?: unknown; number?: unknown; date?: unknown; items?: unknown };
  if (!Array.isArray(o.items)) throw new Error('В ссылке нет строк накладной.');
  const items = (o.items as Record<string, unknown>[])
    .map((i) => ({
      barcode: String(i.barcode ?? '').trim(),
      name: String(i.name ?? '').trim(),
      unit: String(i.unit ?? '').trim(),
      qty: Number(i.qty),
      price: Number(i.price),
    }))
    .filter((i) => i.barcode && Number.isFinite(i.qty) && i.qty > 0)
    .map((i) => ({ ...i, price: Number.isFinite(i.price) && i.price > 0 ? i.price : 0 }));
  if (!items.length) throw new Error('В накладной нет строк со штрихкодом и количеством.');
  return { supplier: String(o.supplier ?? '').trim(), number: String(o.number ?? '').trim(), date: String(o.date ?? '').trim(), items };
}

/** Единица накладной → единица учёта: всё, что не вес, литры и метры, считается штуками. */
export function invoiceUnit(unit: string): 'шт' | 'кг' | 'л' | 'м' {
  const u = unit.toLowerCase().replace(/\./g, '').trim();
  if (/^(кг|килог)/.test(u)) return 'кг';
  if (/^(л|литр)$/.test(u) || u.startsWith('литр')) return 'л';
  if (/^(м|метр)$/.test(u) || u.startsWith('метр')) return 'м';
  return 'шт';
}
