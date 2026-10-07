import { fromDateInput, toDateInput } from '../lib/format';
import { DateInput } from './DateInput';

/** Период в днях включительно, в формате полей type="date". */
export interface Period {
  from: string;
  to: string;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export const PRESETS: { label: string; make: () => Period }[] = [
  { label: 'Сегодня', make: () => ({ from: toDateInput(daysAgo(0)), to: toDateInput(daysAgo(0)) }) },
  { label: 'Вчера', make: () => ({ from: toDateInput(daysAgo(1)), to: toDateInput(daysAgo(1)) }) },
  { label: 'Неделя', make: () => ({ from: toDateInput(daysAgo(6)), to: toDateInput(daysAgo(0)) }) },
  { label: 'Месяц', make: () => ({ from: toDateInput(daysAgo(29)), to: toDateInput(daysAgo(0)) }) },
  { label: '3 месяца', make: () => ({ from: toDateInput(daysAgo(89)), to: toDateInput(daysAgo(0)) }) },
];

export const lastDays = (n: number): Period => ({ from: toDateInput(daysAgo(n - 1)), to: toDateInput(daysAgo(0)) });

/** Границы для запроса: начало первого дня и начало дня после последнего. */
export function periodRange(p: Period): { from: string; to: string } {
  const end = fromDateInput(p.to);
  end.setDate(end.getDate() + 1);
  return { from: fromDateInput(p.from).toISOString(), to: end.toISOString() };
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="period">
      <div className="segmented">
        {PRESETS.map((p) => {
          const v = p.make();
          const active = v.from === value.from && v.to === value.to;
          return (
            <button key={p.label} className={active ? 'active' : ''} onClick={() => onChange(v)}>
              {p.label}
            </button>
          );
        })}
      </div>
      <DateInput value={value.from} max={value.to} range={value} onChange={(from) => onChange({ ...value, from })} aria-label="Начало периода" />
      <span className="muted">—</span>
      <DateInput value={value.to} min={value.from} range={value} onChange={(to) => onChange({ ...value, to })} aria-label="Конец периода" />
    </div>
  );
}
