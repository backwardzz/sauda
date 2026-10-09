import { useState } from 'react';
import { useChanged } from '../lib/hooks';
import { parseNum } from '../lib/format';
import { toast } from './toast';

interface Props {
  value: number | null;
  /** Сохраняет новое значение; при ошибке поле возвращается к прежнему. */
  onSave: (n: number) => Promise<unknown>;
  /** Стёрли значение. Без обработчика пустое поле просто возвращается к прежнему числу. */
  onClear?: () => Promise<unknown>;
  disabled?: boolean;
  placeholder?: string;
  'aria-label': string;
}

const show = (v: number | null) => (v == null ? '' : String(Number(v)));

/** Число прямо в таблице: правится на месте, сохраняется по Enter или при уходе из поля, Esc отменяет. */
export function NumCell({ value, onSave, onClear, disabled, placeholder, ...rest }: Props) {
  const [text, setText] = useState(show(value));
  const [busy, setBusy] = useState(false);
  if (useChanged([value])) setText(show(value));

  const commit = async () => {
    const n = Math.max(parseNum(text), 0);
    const clear = text.trim() === '' && value != null && !!onClear;
    if (!clear && (text.trim() === '' || n === Number(value ?? NaN))) return setText(show(value));
    setBusy(true);
    try {
      await (clear ? onClear!() : onSave(n));
    } catch (e) {
      toast.error(e);
      setText(show(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <input
      className="num-input cell-num"
      value={text}
      disabled={disabled || busy}
      placeholder={placeholder}
      inputMode="decimal"
      aria-label={rest['aria-label']}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setText(show(value));
        }
      }}
    />
  );
}
