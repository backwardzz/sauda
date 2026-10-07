import { useState, type FormEvent } from 'react';
import { formatPhone } from '../lib/format';
import { db, errorText } from '../lib/supabase';
import type { OrgKind } from '../lib/types';
import { Captcha, CAPTCHA_KEY } from '../ui/Captcha';
import { CitySelect } from '../ui/CitySelect';
import { PhoneInput } from '../ui/PhoneInput';

/** Короткий логин без «@» (например, dev) — вход в аккаунт <логин>@sauda.test, который создаёт сидер. */
const loginEmail = (login: string) => (login.includes('@') ? login : `${login}@sauda.test`);

/** Куда вернуться по ссылке из письма: адрес сайта без «#…» (на Pages сайт лежит в подпапке). */
const confirmUrl = () => window.location.origin + window.location.pathname;

/** Длина кода из письма: должна совпадать с настройкой сервера (auth.email.otp_length). */
const CODE_LENGTH = 6;
const PASSWORD_MIN = 8;

/** Чем плох новый пароль, или null, если он подходит. */
function passwordProblem(p: string): string | null {
  if (p.length < PASSWORD_MIN) return `Пароль слишком короткий: нужно минимум ${PASSWORD_MIN} символов`;
  if (!/\p{L}/u.test(p) || !/\d/.test(p)) return 'В пароле должны быть и буквы, и цифры';
  return null;
}

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
  const [password2, setPassword2] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // адрес, на который ушло письмо с кодом: вместо формы показывается окно ввода кода
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const captchaToken = captcha ?? undefined;
  const needCaptcha = Boolean(CAPTCHA_KEY) && !captcha;
  // токен капчи одноразовый: после любого запроса проверка проходит заново
  const nextCaptcha = () => { setCaptcha(null); setRound((r) => r + 1); };

  const resend = async () => {
    if (!sentTo) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await db.auth.resend({ type: 'signup', email: sentTo, options: { emailRedirectTo: confirmUrl(), captchaToken } });
    setBusy(false);
    nextCaptcha();
    if (error) setError(errorText(error));
    else setNotice('Письмо отправлено ещё раз');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    // после верного кода сессия появляется сама, и приложение открывает следующий шаг
    const { error } = await db.auth.verifyOtp({ email: sentTo, token: code, type: 'signup' });
    setBusy(false);
    if (error) setError(errorText(error));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'register') {
      if (city == null) return setError('Выберите город');
      const weak = passwordProblem(password);
      if (weak) return setError(weak);
      if (password !== password2) return setError('Пароли не совпадают');
    }
    if (needCaptcha) return setError('Подтвердите, что вы не робот');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email: loginEmail(email.trim()), password, options: { captchaToken } });
        if (error) throw error;
      } else {
        const { data, error } = await db.auth.signUp({
          email: email.trim(),
          password,
          // выбор запоминается в профиле: следующий шаг (данные магазина или компании) откроется уже заполненным
          options: {
            emailRedirectTo: confirmUrl(),
            captchaToken,
            data: { org_name: name.trim(), account_kind: kind, city_id: city, phone: formatPhone(phone) },
          },
        });
        if (error) throw error;
        // на занятый адрес сервер отвечает так же, как на новый, только без способов входа — чтобы адреса нельзя было перебирать
        if (data.user && data.user.identities?.length === 0) throw new Error('User already registered');
        if (!data.session) {
          setSentTo(email.trim());
          setCode('');
          setPassword('');
          setPassword2('');
        }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      nextCaptcha();
    }
  };

  if (sentTo) {
    return (
      <div className="auth">
        <form className="auth-card stack" onSubmit={verify}>
          <div>
            <div className="brand"><span className="brand-mark">S</span>Sauda</div>
            <h2>Введите код из письма</h2>
          </div>
          <p>Мы отправили {CODE_LENGTH}-значный код на <b>{sentTo}</b>.</p>
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`\\d{${CODE_LENGTH}}`}
            title={`Код из письма: ${CODE_LENGTH} цифр`}
            placeholder={'0'.repeat(CODE_LENGTH)}
            aria-label="Код из письма"
          />
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="ok-text">{notice}</p>}
          <button className="btn primary large" disabled={busy || code.length < CODE_LENGTH}>Подтвердить</button>
          <p className="hint">Письма нет? Проверьте папку «Спам» или отправьте код ещё раз.</p>
          <Captcha round={round} onToken={setCaptcha} />
          <div className="auth-links">
            <button type="button" className="link-btn" disabled={busy || needCaptcha} onClick={resend}>Отправить код ещё раз</button>
            <button type="button" className="link-btn" onClick={() => { setSentTo(null); setError(null); setNotice(null); setMode('login'); }}>
              Вернуться ко входу
            </button>
          </div>
        </form>
      </div>
    );
  }

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
              <span>{kind === 'store' ? 'Название магазина' : 'Название компании'}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="organization"
                placeholder={kind === 'store' ? 'ИП Иванов' : 'ТОО «Молочный завод»'} />
            </label>
            <div className="form-grid">
              <div className="field">
                <span>Город</span>
                <CitySelect value={city} onChange={setCity} aria-label="Город" />
              </div>
              <label className="field">
                <span>Телефон</span>
                <PhoneInput value={phone} onChange={setPhone} required autoComplete="tel" />
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
            minLength={mode === 'login' ? 6 : PASSWORD_MIN}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && <span className="hint">Не короче {PASSWORD_MIN} символов, с буквами и цифрами</span>}
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Пароль ещё раз</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required autoComplete="new-password" />
          </label>
        )}
        <Captcha round={round} onToken={setCaptcha} />
        {error && <p className="error-text">{error}</p>}
        {notice && <p className="ok-text">{notice}</p>}
        <button className="btn primary large" disabled={busy}>
          {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </form>
    </div>
  );
}
