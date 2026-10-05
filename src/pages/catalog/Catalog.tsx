import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDebounced, useQuery, useStored } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { CatalogItem } from '../../lib/starter';
import { Pager } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

interface CategoryRow {
  category: string;
  subcategory: string;
  cnt: number;
}

type Row = CatalogItem & { total: number };

/** Заглушка для аптек: справочника лекарств ещё нет. */
export function PharmacyStub({ title }: { title: string }) {
  return (
    <>
      <div className="page-head"><h1>{title}</h1><span className="badge warn">в разработке</span></div>
      <div className="card empty">
        <p><b>Справочник лекарственных средств готовится.</b></p>
        <p style={{ marginTop: 6 }}>
          Пока товары можно добавить вручную или загрузить из Excel в разделе <Link to="/products">«Список товаров»</Link>.
        </p>
      </div>
    </>
  );
}

/** Общий справочник товаров: магазин находит товар и добавляет его в свой список вместе с категорией. */
export function Catalog() {
  const { org } = useWorkspace();
  return org.business === 'pharmacy' ? <PharmacyStub title="Каталог товаров" /> : <CatalogList />;
}

function CatalogList() {
  const { org } = useWorkspace();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  /** null — все товары, '' — без категории */
  const [category, setCategory] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useStored('sauda:catalog:onlyNew', false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useStored('sauda:catalog:pageSize', 50);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(0), [term, category, sub, onlyNew, pageSize]);

  const cats = useQuery(() => q<CategoryRow[]>(db.rpc('catalog_categories', { p_org: org.id })), [org.id]);
  const list = useQuery(
    () => q<Row[]>(db.rpc('catalog_search', {
      p_org: org.id, p_term: term, p_category: category, p_subcategory: sub, p_only_new: onlyNew,
      p_limit: pageSize, p_offset: page * pageSize,
    })),
    [org.id, term, category, sub, onlyNew, page, pageSize],
  );

  const tree = useMemo(() => {
    const roots = new Map<string, { total: number; subs: CategoryRow[] }>();
    for (const r of cats.data ?? []) {
      const root = roots.get(r.category) ?? { total: 0, subs: [] };
      root.total += Number(r.cnt);
      if (r.subcategory) root.subs.push(r);
      roots.set(r.category, root);
    }
    // товары без категории — в конце списка
    return [...roots].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru')));
  }, [cats.data]);
  const totalAll = tree.reduce((s, [, r]) => s + r.total, 0);

  const rows = list.data ?? [];
  const total = Number(rows[0]?.total ?? 0);
  const free = rows.filter((r) => !r.mine);
  const allPicked = free.length > 0 && free.every((r) => picked.has(r.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const togglePage = () => {
    const next = new Set(picked);
    free.forEach((r) => (allPicked ? next.delete(r.id) : next.add(r.id)));
    setPicked(next);
  };

  const add = async (ids: string[]) => {
    setBusy(true);
    try {
      const res = await q<{ created: number; skipped: number }>(db.rpc('add_catalog_products', { p_org: org.id, p_ids: ids }));
      toast.ok(
        `Добавлено товаров: ${res.created}` + (res.skipped ? `, уже были: ${res.skipped}` : '') +
          '. Цены укажите при приёмке или в карточке товара.',
      );
      // отметки, поставленные пока шёл запрос, сохраняются
      setPicked((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      list.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const select = (c: string | null, s: string | null = null) => {
    setCategory(c);
    setSub(s);
  };

  return (
    <div className={picked.size ? 'with-cartbar' : ''}>
      <div className="page-head">
        <h1>Каталог товаров</h1>
        <span className="muted">Общий справочник: {totalAll || '…'} товаров со штрихкодами. Отметьте нужные — они появятся в вашем списке.</span>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Название или штрихкод"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <label className="check-row">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Скрыть те, что у меня уже есть
        </label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => navigate('/catalog/starter')}>
          <Icon name="bolt" size={16} />У меня новый магазин
        </button>
      </div>

      <div className="split">
        <div className="card side-list">
          <button className={category === null ? 'active' : ''} onClick={() => select(null)}>
            <span className="grow">Все товары</span><span className="side-count">{totalAll || ''}</span>
          </button>
          {tree.map(([name, root]) => (
            <div key={name}>
              <button className={category === name && sub === null ? 'active' : ''} onClick={() => select(name)}>
                <span className="grow">{name || 'Без категории'}</span>
                <span className="side-count">{root.total}</span>
              </button>
              {category === name && root.subs.map((s) => (
                <button key={s.subcategory} className={`side-sub ${sub === s.subcategory ? 'active' : ''}`} onClick={() => select(name, s.subcategory)}>
                  <span className="grow">{s.subcategory}</span>
                  <span className="side-count">{s.cnt}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="cell-check">
                    <input type="checkbox" checked={allPicked} disabled={!free.length} onChange={togglePage} aria-label="Выбрать все на странице" />
                  </th>
                  <th>Название товара</th>
                  <th>Штрихкод</th>
                  <th>Ед. изм</th>
                  <th>Категория</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {list.error ? (
                  <tr><td colSpan={6} className="table-note error-text">{list.error}</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-note">
                      {list.loading ? 'Загрузка…' : term || category !== null || onlyNew ? 'Ничего не найдено' : 'Справочник пока пуст'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className={picked.has(r.id) ? 'selected clickable' : r.mine ? '' : 'clickable'} onClick={() => !r.mine && toggle(r.id)}>
                      <td className="cell-check">
                        <input type="checkbox" checked={r.mine || picked.has(r.id)} disabled={r.mine} readOnly aria-label={`Выбрать: ${r.name}`} />
                      </td>
                      <td>{r.name}</td>
                      <td className="num">{r.barcode}</td>
                      <td>{r.unit}</td>
                      <td className="muted">{[r.category, r.subcategory].filter(Boolean).join(' · ')}</td>
                      <td className="right" onClick={(e) => e.stopPropagation()}>
                        {r.mine ? (
                          <span className="badge ok"><Icon name="check" size={13} />уже у вас</span>
                        ) : (
                          <button className="btn small" disabled={busy} onClick={() => add([r.id])}>
                            <Icon name="plus" size={14} />Добавить
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
        </div>
      </div>

      {picked.size > 0 && (
        <div className="cartbar">
          <div>
            <b>Выбрано товаров: {picked.size}</b>
            <div className="muted">Добавятся в «Список товаров» с категориями, без цен и остатков</div>
          </div>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => setPicked(new Set())}>Сбросить</button>
          <button className="btn primary large" disabled={busy} onClick={() => add([...picked])}>Добавить в мои товары</button>
        </div>
      )}
    </div>
  );
}
