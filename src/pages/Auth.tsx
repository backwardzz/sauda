import { useState, type FormEvent } from 'react';
import { db, errorText } from '../lib/supabase';

/** Короткий логин без «@» (например, dev) — вход в аккаунт <логин>@sauda.test, который создаёт сидер. */
const loginEmail = (login: string) => (login.includes('@') ? login : `${login}@sauda.test`);

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email: loginEmail(email.trim()), password });
        if (error) throw error;
      } else {
        const { data, error } = await db.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) setNotice('Мы отправили письмо со ссылкой. Подтвердите почту и войдите.');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div>
          <div className="brand"><span className="brand-mark">S</span>Sauda</div>
          <p className="muted">Учёт и касса для магазинов, каталог и заказы для поставщиков</p>
        </div>
        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
        </div>
        {mode === 'register' && (
          <label className="field">
            <span>Имя и фамилия</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>{mode === 'login' ? 'Почта или логин' : 'Почта'}</span>
          <input
            type={mode === 'login' ? 'text' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'username' : 'email'}
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        {notice && <p className="ok-text">{notice}</p>}
        <button className="btn primary large" disabled={busy}>
          {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </form>
    </div>
  );
}
