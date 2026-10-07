import { useEffect, useRef, useState } from 'react';
import { fromDateInput, toDateInput } from '../lib/format';
import { Icon } from './Icon';

/**
 * Поле даты со своим календарём вместо системного: системный календарь браузера не оформить
 * под Sauda, а в тёмной теме он вообще другого цвета. Значение — строка «ГГГГ-ММ-ДД», как у type="date".
 * range подсвечивает выбранный период (для пары полей «с — по»).
 */
interface Props {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  range?: { from: string; to: string };
  'aria-label'?: string;
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const show = (v: string) => (v ? v.split('-').reverse().join('.') : '');

/** 42 дня (6 недель) сетки месяца, неделя с понедельника. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function DateInput({ value, onChange, min, max, range, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const base = value ? fromDateInput(value) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = value ? fromDateInput(value) : new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
    // value в зависимостях не нужен: месяц выставляется при открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shift = (n: number) => setView(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  const allowed = (v: string) => (!min || v >= min) && (!max || v <= max);
  const today = toDateInput(new Date());
  const pick = (v: string) => { if (!allowed(v)) return; onChange(v); setOpen(false); };

  return (
    <div className="date-input" ref={box}>
      <button type="button" className={`date-field ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={rest['aria-label'] ? `${rest['aria-label']}: ${show(value)}` : undefined}>
        <span className="num">{show(value) || 'дд.мм.гггг'}</span>
        <Icon name="calendar" size={16} />
      </button>
      {open && (
        <div className="calendar" role="dialog" aria-label={rest['aria-label'] ?? 'Календарь'}>
          <div className="calendar-head">
            <button type="button" className="icon-btn small" onClick={() => shift(-1)} aria-label="Предыдущий месяц"><Icon name="back" size={16} /></button>
            <b>{MONTHS[view.m]} {view.y}</b>
            <button type="button" className="icon-btn small" onClick={() => shift(1)} aria-label="Следующий месяц"><Icon name="forward" size={16} /></button>
          </div>
          <div className="calendar-grid">
            {WEEKDAYS.map((w, i) => <span key={w} className={`calendar-wd ${i > 4 ? 'weekend' : ''}`}>{w}</span>)}
            {monthGrid(view.y, view.m).map((d) => {
              const v = toDateInput(d);
              const inRange = range && v >= range.from && v <= range.to;
              const cls = [
                'calendar-day',
                d.getMonth() !== view.m && 'other',
                inRange && 'in-range',
                range && v === range.from && 'range-start',
                range && v === range.to && 'range-end',
                v === value && 'selected',
                v === today && 'today',
              ].filter(Boolean).join(' ');
              return (
                <button key={v} type="button" className={cls} disabled={!allowed(v)} onClick={() => pick(v)}
                  aria-pressed={v === value} aria-label={`${d.getDate()} ${MONTHS_OF[d.getMonth()]} ${d.getFullYear()}`}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="calendar-foot">
            <button type="button" className="btn ghost small" disabled={!allowed(today)} onClick={() => pick(today)}>Сегодня</button>
          </div>
        </div>
      )}
    </div>
  );
}
