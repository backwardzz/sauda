import { useState, type FormEvent } from 'react';
import { db, errorText, q } from '../lib/supabase';
import { useSession } from '../lib/session';

/** Первый вход: у пользователя ещё нет организации и нет приглашений. */
export function Onboarding() {
  const { user, reload, signOut } = useSession();
  const [company, setCompany] = useState('');
  const [storeName, setStoreName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await q(db.rpc('create_org', { p_name: company, p_store: storeName || company }));
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
          <h1>Создайте компанию</h1>
          <p className="muted">
            К ней привяжутся магазины, товары и сотрудники. Если вас пригласили в существующую компанию,
            войдите с той почтой, на которую пришло приглашение.
          </p>
        </div>
        <label className="field">
          <span>Название компании</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} required autoFocus placeholder="ИП Иванов" />
        </label>
        <label className="field">
          <span>Название первого магазина</span>
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Магазин на Абая" />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary large" disabled={busy}>Продолжить</button>
        <button type="button" className="btn ghost" onClick={signOut}>
          Выйти из {user?.email}
        </button>
      </form>
    </div>
  );
}
