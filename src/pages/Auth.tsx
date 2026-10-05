import { useState, type FormEvent } from 'react';
import { formatPhone } from '../lib/format';
import { db, errorText } from '../lib/supabase';
import type { OrgKind } from '../lib/types';
import { CitySelect } from '../ui/CitySelect';

/** Короткий логин без «@» (например, dev) — вход в аккаунт <логин>@sauda.test, который создаёт сидер. */
const loginEmail = (login: string) => (login.includes('@') ? login : `${login}@sauda.test`);

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [kind, setKind] = useState<OrgKind>('store');
  const [name, setName] = useState('');
  const [city, setCity] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'register' && city == null) return setError('Выберите город');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email: loginEmail(email.trim()), password });
        if (error) throw error;
      } else {
        const { data, error } = await db.auth.signUp({
          email: email.trim(),
          password,
          // выбор запоминается в профиле: следующий шаг (данные магазина или компании) откроется уже заполненным
          options: { data: { full_name: name.trim(), account_kind: kind, city_id: city, phone: formatPhone(phone) } },
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
          <p className="muted">Учёт и касса для магазинов, каталог, склад и заказы для компаний</p>
        </div>
        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Регистрация</button>
        </div>
        {mode === 'register' && (
          <>
            <div className="field">
              <span>Кто вы?</span>
              <div className="choice">
                <button type="button" className={kind === 'store' ? 'active' : ''} onClick={() => setKind('store')}>
                  <b>Магазин</b>
                  <span>Учёт товаров, касса, заказы у компаний</span>
                </button>
                <button type="button" className={kind === 'company' ? 'active' : ''} onClick={() => setKind('company')}>
                  <b>Компания</b>
                  <span>Производитель или дистрибьютор: каталог, склад и заказы магазинов</span>
                </button>
              </div>
            </div>
            <label className="field">
              <span>Имя и фамилия</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </label>
            <div className="form-grid">
              <div className="field">
                <span>Город</span>
                <CitySelect value={city} onChange={setCity} aria-label="Город" />
              </div>
              <label className="field">
                <span>Телефон</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))}
                  required inputMode="tel" autoComplete="tel" placeholder="+7 701 000 00 00" />
              </label>
            </div>
          </>
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
