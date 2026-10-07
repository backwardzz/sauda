import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Готовые варианты. Вписать можно и своё значение. */
  options: string[];
  placeholder?: string;
  'aria-label'?: string;
}

/** Поле с подсказками: можно выбрать из списка или вписать своё. Список в оформлении площадки, а не системный. */
export function SuggestInput({ value, onChange, options, placeholder, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // пока поле только открыли, показываются все варианты; отбор начинается с первой набранной буквы
  const [typed, setTyped] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const list = useMemo(() => {
    const term = typed ? value.trim().toLowerCase() : '';
    if (!term) return options;
    const starts = options.filter((o) => o.toLowerCase().startsWith(term));
    return [...starts, ...options.filter((o) => !starts.includes(o) && o.toLowerCase().includes(term))];
  }, [options, value, typed]);

  const pick = (o: string) => {
    onChange(o);
    setOpen(false);
  };
  const show = () => { setOpen(true); setTyped(false); setActive(-1); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.max(0, Math.min(list.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open && list[active]) {
      e.preventDefault();
      pick(list[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="combo" ref={box}>
      <input
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && list.length > 0}
        aria-autocomplete="list"
        aria-label={rest['aria-label']}
        autoComplete="off"
        onFocus={show}
        onClick={show}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {open && list.length > 0 && (
        <div className="combo-list" role="listbox">
          {list.map((o, i) => (
            <button type="button" key={o} role="option" aria-selected={o === value}
              className={[i === active ? 'active' : '', o === value ? 'selected' : ''].join(' ')}
              onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span>{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
