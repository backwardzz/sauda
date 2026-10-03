import { db, q, safeTerm } from './supabase';
import type { Product, Unit } from './types';

function ean13Check(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/**
 * Внутренний штрихкод EAN-13. Префикс 20 — штучный товар; 21 — весовой:
 * 21 + 5 цифр кода товара + 5 цифр веса в граммах (в карточке нули, весы подставляют вес).
 */
export function generateBarcode(unit: Unit): string {
  const body = unit === 'кг' ? `21${randomDigits(5)}00000` : `20${randomDigits(10)}`;
  return body + ean13Check(body);
}

export interface Lookup {
  product: Product;
  /** Вес из весового штрихкода, кг. */
  qty?: number;
}

export async function findByBarcode(orgId: string, raw: string): Promise<Lookup | null> {
  const code = raw.trim();
  if (!code) return null;
  const base = () => db.from('products').select('*').eq('org_id', orgId).eq('archived', false);

  const plain = /^[\w-]+$/.test(code);
  const exact = await q<Product[]>(
    plain ? base().or(`barcode.eq.${code},extra_barcodes.cs.{${code}}`).limit(1) : base().eq('barcode', code).limit(1),
  );
  if (exact.length) return { product: exact[0] };

  if (/^2[1-9]\d{11}$/.test(code)) {
    const weighed = await q<Product[]>(base().eq('unit', 'кг').like('barcode', `${code.slice(0, 7)}%`).limit(1));
    const grams = Number(code.slice(7, 12));
    if (weighed.length && grams > 0) return { product: weighed[0], qty: grams / 1000 };
  }
  return null;
}

export async function searchProducts(orgId: string, text: string, limit = 12): Promise<Product[]> {
  const term = safeTerm(text);
  if (!term) return [];
  return q<Product[]>(
    db.from('products').select('*').eq('org_id', orgId).eq('archived', false)
      .or(`name.ilike.%${term}%,barcode.ilike.${term}%,sku.ilike.${term}%`)
      .order('name').limit(limit),
  );
}
