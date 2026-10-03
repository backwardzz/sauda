import { useEffect, useState } from 'react';
import { errorText } from '../lib/supabase';

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

let nextId = 1;
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

function push(kind: Toast['kind'], text: string) {
  const t = { id: nextId++, kind, text };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, kind === 'error' ? 6000 : 3000);
}

export const toast = {
  ok: (text: string) => push('ok', text),
  error: (e: unknown) => push('error', errorText(e)),
};

export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}
