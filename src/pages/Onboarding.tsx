import { useState, type FormEvent } from 'react';
import { db, errorText, q } from '../lib/supabase';
import { useSession } from '../lib/session';

/** Первый вход: у пользователя ещё нет компании и нет приглашений. */
export function Onboarding() {
  const { user, reload, signOut } = useSession();
  const [kind, setKind] = useState<'store' | 'supplier'>('store');
  const [company, setCompany] = useState('');
  const [storeName, setStoreName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await q(db.rpc('create_org', { p_name: company, p_store: storeName || company, p_kind: kind }));
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
        <label className="field">
          <span>Название компании</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} required autoFocus
            placeholder={kind === 'store' ? 'ИП Иванов' : 'ТОО «Молочный завод»'} />
        </label>
        {kind === 'store' && (
          <label className="field">
            <span>Название первого магазина</span>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Магазин на Абая" />
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
