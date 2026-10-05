import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { STARTER_PACKS, type StarterItem } from '../../lib/starter';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { PharmacyStub } from './Catalog';

/** «У меня новый магазин»: пакеты ходовых товаров из общего справочника, чтобы не заводить базу с нуля. */
export function NewStore() {
  const { org } = useWorkspace();
  return org.business === 'pharmacy' ? <PharmacyStub title="У меня новая аптека" /> : <StarterPacks />;
}

function StarterPacks() {
  const { org } = useWorkspace();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useQuery(() => q<StarterItem[]>(db.rpc('starter_products', { p_org: org.id })), [org.id]);

  const packs = useMemo(
    () => STARTER_PACKS
      .map((p) => ({ ...p, items: (items.data ?? []).filter((i) => i.starter_pack === p.key) }))
      .filter((p) => p.items.length),
    [items.data],
  );

  // при первом открытии отмечены все пакеты, кроме необязательных (табак, алкоголь)
  useEffect(() => {
    if (picked || !items.data) return;
    const optional = new Set(STARTER_PACKS.filter((p) => p.optional).map((p) => p.key));
    setPicked(new Set(items.data.filter((i) => !i.mine && !optional.has(i.starter_pack)).map((i) => i.id)));
  }, [items.data, picked]);

  const chosen = picked ?? new Set<string>();
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setPicked(next);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await q<{ created: number; skipped: number }>(db.rpc('add_catalog_products', { p_org: org.id, p_ids: [...chosen] }));
      toast.ok(`Добавлено товаров: ${res.created}. Цены и остатки внесите приёмкой или в карточке товара.`);
      navigate('/products');
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <div className="with-cartbar">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate('/catalog')} aria-label="К каталогу товаров"><Icon name="back" /></button>
        <h1>У меня новый магазин</h1>
      </div>
      <p className="muted" style={{ marginBottom: 14, maxWidth: 760 }}>
        Чтобы не заводить базу с нуля, возьмите готовые пакеты ходовых товаров: названия, штрихкоды и категории уже заполнены.
        Снимите отметку с пакета или отдельных товаров, которыми не торгуете. Остальное найдётся в{' '}
        <a onClick={() => navigate('/catalog')} style={{ cursor: 'pointer' }}>каталоге</a>.
      </p>

      {items.error ? (
        <div className="card empty error-text">{items.error}</div>
      ) : items.loading && !items.data ? (
        <div className="card empty">Загрузка…</div>
      ) : packs.length === 0 ? (
        <div className="card empty">Пакеты товаров ещё не подготовлены</div>
      ) : (
        <div className="pack-grid">
          {packs.map((p) => {
            const free = p.items.filter((i) => !i.mine);
            const on = free.filter((i) => chosen.has(i.id)).length;
            const mine = p.items.length - free.length;
            return (
              <div className={`card pack-card ${on ? 'active' : ''}`} key={p.key}>
                <label className="pack-head">
                  <input
                    type="checkbox"
                    checked={on > 0 && on === free.length}
                    ref={(el) => { if (el) el.indeterminate = on > 0 && on < free.length; }}
                    disabled={!free.length}
                    onChange={(e) => toggle(free.map((i) => i.id), e.target.checked)}
                  />
                  <span className="grow">
                    <b>{p.title}</b>
                    <span className="hint">{p.hint}</span>
                  </span>
                </label>
                <div className="pack-foot">
                  <span className="muted">
                    {free.length ? `выбрано ${on} из ${free.length}` : 'все товары уже у вас'}
                    {mine > 0 && free.length > 0 && ` · ${mine} уже у вас`}
                  </span>
                  <span className="spacer" />
                  <button className="btn ghost small" onClick={() => setOpen(open === p.key ? null : p.key)} aria-expanded={open === p.key}>
                    Состав<Icon name={open === p.key ? 'up' : 'down'} size={14} />
                  </button>
                </div>
                {open === p.key && (
                  <div className="pack-items">
                    {p.items.map((i) => (
                      <label className="check-row" key={i.id}>
                        <input
                          type="checkbox"
                          checked={i.mine || chosen.has(i.id)}
                          disabled={i.mine}
                          onChange={(e) => toggle([i.id], e.target.checked)}
                        />
                        <span className="grow">{i.name}</span>
                        {i.mine && <span className="badge ok">уже у вас</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="cartbar">
        <div>
          <b>Выбрано товаров: {chosen.size}</b>
          <div className="muted">Добавятся в «Список товаров» с категориями, без цен и остатков</div>
        </div>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => navigate('/')}>Не сейчас</button>
        <button className="btn primary large" disabled={busy || !chosen.size} onClick={submit}>
          Добавить {chosen.size || ''} в мои товары
        </button>
      </div>
    </div>
  );
}
