import { useEffect, useMemo, useRef, useState } from 'react';
import { useCities } from '../lib/cities';
import type { City } from '../lib/types';

interface Props {
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Показать вариант «Все города»: поле работает как отбор, а не как обязательный выбор. */
  allowAll?: boolean;
  'aria-label'?: string;
}

/** Выбор города с поиском: города республиканского значения — первыми, у остальных подписана область. */
export function CitySelect({ value, onChange, placeholder = 'Начните вводить название', disabled, autoFocus, allowAll, ...rest }: Props) {
  const cities = useCities();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const selected = cities.find((c) => c.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const list = useMemo(() => {
    const term = text.trim().toLowerCase();
    if (!term) return cities;
    const starts: City[] = [];
    const rest: City[] = [];
    for (const c of cities) {
      const name = c.name.toLowerCase();
      if (name.startsWith(term)) starts.push(c);
      else if (name.includes(term) || c.region.toLowerCase().includes(term)) rest.push(c);
    }
    return [...starts, ...rest];
  }, [cities, text]);

  const pick = (c: City | null) => {
    onChange(c?.id ?? null);
    setOpen(false);
    setText('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.max(0, Math.min(list.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (list[active]) pick(list[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setText('');
    }
  };

  return (
    <div className="combo" ref={box}>
      <input
        value={open ? text : (selected?.name ?? '')}
        placeholder={selected && open ? selected.name : allowAll ? 'Все города' : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={rest['aria-label']}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {open && (
        <div className="combo-list" role="listbox">
          {allowAll && !text.trim() && (
            <button type="button" className={value == null ? 'selected' : ''} onClick={() => pick(null)}>Все города</button>
          )}
          {list.length === 0 && <div className="combo-empty">{cities.length ? 'Такого города нет в списке' : 'Загрузка…'}</div>}
          {list.map((c, i) => (
            <button
              type="button"
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              className={[i === active ? 'active' : '', c.id === value ? 'selected' : ''].join(' ')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
            >
              <span>{c.name}</span>
              {c.region && <span className="muted">{c.region}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
