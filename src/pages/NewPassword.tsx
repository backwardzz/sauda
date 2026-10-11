import { useState, type FormEvent } from 'react';
import { useSession } from '../lib/session';
import { db, errorText } from '../lib/supabase';
import { passwordError, PasswordHint, PasswordRepeat } from './Auth';
import { useAction } from '../ui/useAction';

/** Вход по коду или ссылке восстановления: сначала новый пароль, потом кабинет. */
export function NewPassword() {
  const { user, setRecovering, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, run] = useAction();
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const bad = passwordError(password, password2);
    if (bad) return setError(bad);
    await run(async () => {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      setRecovering(false);
    }, { onError: (e) => setError(errorText(e)) });
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
        <PasswordRepeat value={password2} password={password} onChange={setPassword2} />
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary large" disabled={busy}>Сохранить и войти</button>
        <button type="button" className="btn ghost" onClick={signOut}>Отмена</button>
      </form>
    </div>
  );
}
