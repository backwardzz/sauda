const moneyFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

export const money = (n: unknown) => moneyFmt.format(Number(n) || 0);
/** Без копеек, если сумма целая: для плиток и подписей на графиках. */
export const moneyShort = (n: unknown) => compactFmt.format(Number(n) || 0);
export const qty = (n: unknown) => qtyFmt.format(Number(n) || 0);
export const pct = (n: unknown) => `${compactFmt.format(Number(n) || 0)}%`;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Число из поля ввода: принимает запятую и пробелы-разделители. */
export function parseNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const n = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function dateOnly(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Значение для <input type="date"> в местном времени. */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function markupPct(purchase: number, sale: number): number {
  return purchase > 0 ? round2(((sale - purchase) / purchase) * 100) : 0;
}

export function marginPct(revenue: number, profit: number): number {
  return revenue > 0 ? round2((profit / revenue) * 100) : 0;
}
