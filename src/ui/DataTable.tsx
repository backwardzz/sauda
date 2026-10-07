import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStored } from '../lib/hooks';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  title: string;
  render?: (row: T) => ReactNode;
  /** Значение для вывода по умолчанию и для сортировки на клиенте. */
  value?: (row: T) => string | number | null | undefined;
  align?: 'right' | 'center';
  sortable?: boolean;
  /** Скрыт, пока пользователь не включит его в настройке столбцов. */
  optional?: boolean;
  /** Нельзя скрыть. */
  fixed?: boolean;
  width?: string;
}

export interface Sort {
  key: string;
  dir: 'asc' | 'desc';
}

interface Props<T> {
  /** Ключ, под которым запоминается видимость столбцов. */
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  empty?: string;
  /** Сортировка на сервере: передайте оба свойства. Без них таблица сортирует сама. */
  sort?: Sort | null;
  onSort?: (s: Sort) => void;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  selected?: Set<string>;
  onSelect?: (s: Set<string>) => void;
  footer?: Partial<Record<string, ReactNode>>;
}

export function DataTable<T>(props: Props<T>) {
  const { id, columns, rows, rowKey, loading, error, empty = 'Нет данных', onRowClick, rowClass, selected, onSelect, footer } = props;
  const [hidden, setHidden] = useStored<Record<string, boolean>>(`sauda:cols:${id}`, {});
  const [localSort, setLocalSort] = useState<Sort | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // меню столбцов привязано к окну, а не к таблице: иначе в короткой таблице его обрезает рамка с прокруткой
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const toggleMenu = () => {
    const r = menuRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setMenu((m) => !m);
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const hide = (e: Event) => {
      if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [menu]);

  const isHidden = (c: Column<T>) => !c.fixed && (hidden[c.key] ?? Boolean(c.optional));
  const visible = columns.filter((c) => !isHidden(c));
  const serverSort = Boolean(props.onSort);
  const sort = serverSort ? props.sort ?? null : localSort;

  const sorted = useMemo(() => {
    if (serverSort || !localSort) return rows;
    const col = columns.find((c) => c.key === localSort.key);
    if (!col?.value) return rows;
    const dir = localSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.value!(a);
      const y = col.value!(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'ru', { numeric: true }) * dir;
    });
  }, [rows, columns, localSort, serverSort]);

  const toggleSort = (c: Column<T>) => {
    if (!c.sortable) return;
    const next: Sort = { key: c.key, dir: sort?.key === c.key && sort.dir === 'asc' ? 'desc' : 'asc' };
    if (props.onSort) props.onSort(next);
    else setLocalSort(next);
  };

  const allSelected = !!selected && sorted.length > 0 && sorted.every((r) => selected.has(rowKey(r)));
  const toggleAll = () => {
    if (!selected || !onSelect) return;
    const next = new Set(selected);
    sorted.forEach((r) => (allSelected ? next.delete(rowKey(r)) : next.add(rowKey(r))));
    onSelect(next);
  };
  const toggleOne = (key: string) => {
    if (!selected || !onSelect) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelect(next);
  };

  const span = visible.length + (onSelect ? 1 : 0) + 1;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {onSelect && (
              <th className="cell-check">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выбрать все" />
              </th>
            )}
            {visible.map((c) => (
              <th
                key={c.key}
                className={[c.align ?? '', c.sortable ? 'sortable' : ''].join(' ')}
                style={{ width: c.width }}
                onClick={() => toggleSort(c)}
              >
                {c.title}
                {sort?.key === c.key && <span className="sort-mark">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
            <th className="cell-gear">
              <div className="popover-anchor" ref={menuRef}>
                <button className="icon-btn small" onClick={toggleMenu} aria-label="Настроить столбцы">
                  <Icon name="gear" size={15} />
                </button>
                {menu && (
                  <div className="popover fixed" style={menuPos}>
                    <div className="popover-title">Столбцы</div>
                    {columns.filter((c) => !c.fixed).map((c) => (
                      <label key={c.key} className="check-row">
                        <input
                          type="checkbox"
                          checked={!isHidden(c)}
                          onChange={() => setHidden({ ...hidden, [c.key]: !isHidden(c) })}
                        />
                        {c.title}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {error ? (
            <tr><td colSpan={span} className="table-note error-text">{error}</td></tr>
          ) : loading && rows.length === 0 ? (
            <tr><td colSpan={span} className="table-note">Загрузка…</td></tr>
          ) : sorted.length === 0 ? (
            <tr><td colSpan={span} className="table-note">{empty}</td></tr>
          ) : (
            sorted.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={[onRowClick ? 'clickable' : '', rowClass?.(row) ?? '', selected?.has(key) ? 'selected' : ''].join(' ')}
                  onClick={() => onRowClick?.(row)}
                >
                  {onSelect && (
                    <td className="cell-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected?.has(key) ?? false} onChange={() => toggleOne(key)} />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} className={c.align ?? ''}>
                      {c.render ? c.render(row) : (c.value?.(row) ?? '')}
                    </td>
                  ))}
                  <td />
                </tr>
              );
            })
          )}
        </tbody>
        {footer && sorted.length > 0 && (
          <tfoot>
            <tr>
              {onSelect && <td />}
              {visible.map((c) => (
                <td key={c.key} className={c.align ?? ''}>{footer[c.key] ?? ''}</td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
}

export function Pager({ page, pageSize, total, onPage, onPageSize }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="pager">
      <span className="muted">{from}–{to} из {total}</span>
      <div className="pager-controls">
        {onPageSize && (
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Строк на странице">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} строк</option>)}
          </select>
        )}
        <button className="btn small" disabled={page === 0} onClick={() => onPage(page - 1)}>Назад</button>
        <span className="muted">{page + 1} / {pages}</span>
        <button className="btn small" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Вперёд</button>
      </div>
    </div>
  );
}
