import { useState, type FormEvent } from 'react';
import { db, errorText, q } from '../lib/supabase';
import { useSession } from '../lib/session';

/** Первый вход: у пользователя ещё нет компании и нет приглашений. */
export function Onboarding() {
  const { user, reload, signOut } = useSession();
  const [kind, setKind] = useState<'store' | 'supplier'>('store');
  const [business, setBusiness] = useState<'grocery' | 'pharmacy'>('grocery');
  const [fresh, setFresh] = useState(true);
  const [company, setCompany] = useState('');
  const [storeName, setStoreName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await q(db.rpc('create_org', { p_name: company, p_store: storeName || company, p_kind: kind, p_business: business }));
      // новому магазину сразу предлагаются пакеты ходовых товаров
      if (kind === 'store' && business === 'grocery' && fresh) window.location.hash = '#/catalog/starter';
      await reload();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div>
          <h1>Кто вы?</h1>
          <p className="muted">
            Если вас пригласили в существующую компанию, войдите с той почтой, на которую пришло приглашение.
          </p>
        </div>
        <div className="choice">
          <button type="button" className={kind === 'store' ? 'active' : ''} onClick={() => setKind('store')}>
            <b>Магазин</b>
            <span>Учёт товаров, касса, отчёты, заказы поставщикам</span>
          </button>
          <button type="button" className={kind === 'supplier' ? 'active' : ''} onClick={() => setKind('supplier')}>
            <b>Поставщик</b>
            <span>Завод, дистрибьютор, торговый представитель: каталог и заказы магазинов</span>
          </button>
        </div>
        {kind === 'store' && (
          <div className="field">
            <span>Чем торгуете</span>
            <div className="choice small">
              <button type="button" className={business === 'grocery' ? 'active' : ''} onClick={() => setBusiness('grocery')}>
                <b>Продукты и товары для дома</b>
              </button>
              <button type="button" className={business === 'pharmacy' ? 'active' : ''} onClick={() => setBusiness('pharmacy')}>
                <b>Аптека <span className="badge warn">скоро</span></b>
              </button>
            </div>
            {business === 'pharmacy' && (
              <p className="hint">
                Раздел для аптек в разработке: справочника лекарств, учёта серий и сроков годности пока нет.
                Зарегистрироваться можно уже сейчас — будут доступны обычный учёт товаров, касса и отчёты.
              </p>
            )}
          </div>
        )}
        <label className="field">
          <span>Название компании</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} required autoFocus
            placeholder={kind === 'supplier' ? 'ТОО «Молочный завод»' : business === 'pharmacy' ? 'ТОО «Аптека Здоровье»' : 'ИП Иванов'} />
        </label>
        {kind === 'store' && (
          <label className="field">
            <span>{business === 'pharmacy' ? 'Название первой аптеки' : 'Название первого магазина'}</span>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder={business === 'pharmacy' ? 'Аптека на Абая' : 'Магазин на Абая'} />
          </label>
        )}
        {kind === 'store' && business === 'grocery' && (
          <label className="check-row">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
            <span>У меня новый магазин — предложить пакет ходовых товаров</span>
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary large" disabled={busy}>Продолжить</button>
        <button type="button" className="btn ghost" onClick={signOut}>
          Выйти из {user?.email}
        </button>
      </form>
    </div>
  );
}
