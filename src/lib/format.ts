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

/** Казахстанский номер в едином виде: «87010001122» и «7010001122» → «+7 701 000 11 22». Остальное — как ввели. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const n = d.length === 11 && (d[0] === '7' || d[0] === '8') ? d.slice(1) : d.length === 10 ? d : null;
  return n ? `+7 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : raw.trim();
}

/** «1 товар», «2 товара», «5 товаров». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
