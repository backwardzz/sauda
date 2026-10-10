import { useState, type FormEvent } from 'react';
import { useSession } from '../lib/session';
import { db, errorText } from '../lib/supabase';
import { passwordChecks, PasswordHint } from './Auth';

/** Вход по коду или ссылке восстановления: сначала новый пароль, потом кабинет. */
export function NewPassword() {
  const { user, setRecovering, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const weak = passwordChecks(password).find((c) => !c.ok);
    if (weak) return setError(`Пароль: ${weak.text}`);
    if (password !== password2) return setError('Пароли не совпадают');
    setBusy(true);
    const { error } = await db.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(errorText(error));
    setRecovering(false);
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div>
          <div className="brand"><span className="brand-mark">S</span>Sauda</div>
          <h2>Новый пароль</h2>
          <p className="muted">Для {user?.email}</p>
        </div>
        <label className="field">
          <span>Новый пароль</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="new-password" />
          <PasswordHint value={password} />
        </label>
        <label className="field">
          <span>Пароль ещё раз</span>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required autoComplete="new-password" />
          {password2 && (
            <span className={`hint ${password2 === password ? 'ok-text' : 'error-text'}`}>
              {password2 === password ? '✓ пароли совпадают' : 'пароли не совпадают'}
            </span>
          )}
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary large" disabled={busy}>Сохранить и войти</button>
        <button type="button" className="btn ghost" onClick={signOut}>Отмена</button>
      </form>
    </div>
  );
}
