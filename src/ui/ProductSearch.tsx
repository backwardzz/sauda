import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { findByBarcode, searchProducts } from '../lib/barcode';
import { money } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import type { Product } from '../lib/types';
import { Icon } from './Icon';
import { toast } from './toast';

interface Props {
  orgId: string;
  onPick: (product: Product, qty?: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Не предлагать услуги (для складских документов). */
  goodsOnly?: boolean;
}

export interface ProductSearchHandle {
  focus: () => void;
}

/** Поле «название или штрихкод»: Enter ищет точный штрихкод (так работает сканер), набор текста — подсказки. */
export const ProductSearch = forwardRef<ProductSearchHandle, Props>(function ProductSearch(
  { orgId, onPick, placeholder = 'Название или штрихкод', autoFocus, goodsOnly },
  ref,
) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(text, 250);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  useEffect(() => {
    let alive = true;
    if (debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    searchProducts(orgId, debounced)
      .then((list) => {
        if (!alive) return;
        setResults(goodsOnly ? list.filter((p) => p.kind === 'product') : list);
        setActive(0);
      })
      .catch(() => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [debounced, orgId, goodsOnly]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const pick = (p: Product, q?: number) => {
    onPick(p, q);
    setText('');
    setResults([]);
    setOpen(false);
    input.current?.focus();
  };

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      const hit = await findByBarcode(orgId, value);
      if (hit && !(goodsOnly && hit.product.kind !== 'product')) return pick(hit.product, hit.qty);
      if (results.length) return pick(results[Math.min(active, results.length - 1)]);
      const found = await searchProducts(orgId, value, 1);
      if (found.length && !(goodsOnly && found[0].kind !== 'product')) return pick(found[0]);
      toast.error(`Товар не найден: ${value}`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="product-search" ref={box}>
      <span className="search-icon"><Icon name="search" size={16} /></span>
      <input
        ref={input}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((p, i) => (
            <button key={p.id} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
              <span className="search-name">{p.name}</span>
              <span className="muted">{p.barcode}</span>
              <span className="num">{money(p.sale_price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
