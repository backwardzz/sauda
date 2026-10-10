import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatPhone } from '../lib/format';
import { useSession } from '../lib/session';
import { db, errorText } from '../lib/supabase';
import { Captcha, CAPTCHA_KEY } from '../ui/Captcha';
import { CitySelect } from '../ui/CitySelect';
import { PhoneInput } from '../ui/PhoneInput';

/** Короткий логин без «@» (например, dev) — вход в аккаунт <логин>@sauda.test, который создаёт сидер. */
const loginEmail = (login: string) => (login.includes('@') ? login : `${login}@sauda.test`);

/** Куда вернуться по ссылке из письма: адрес сайта без «#…» (на Pages сайт лежит в подпапке). */
const confirmUrl = () => window.location.origin + window.location.pathname;

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
/** Вход через Google включается после настройки провайдера в Supabase (README, раздел «Вход через Google»). */
const GOOGLE = env.VITE_GOOGLE_AUTH === '1';

/** Длина кода из письма: должна совпадать с настройкой сервера (auth.email.otp_length). */
const CODE_LENGTH = 6;
export const PASSWORD_MIN = 8;
/** Версия текстов оферты и политики: при их изменении согласие спрашивается заново. */
export const TERMS_VERSION = '2026-10-10';

/** Требования к новому паролю: что выполнено, а что ещё нет. */
export function passwordChecks(p: string) {
  return [
    { ok: p.length >= PASSWORD_MIN, text: `не короче ${PASSWORD_MIN} символов` },
    { ok: /\p{L}/u.test(p), text: 'есть буквы' },
    { ok: /\d/.test(p), text: 'есть цифры' },
  ];
}

/** Строка требований под полем пароля: зелёным — выполненное. */
export function PasswordHint({ value }: { value: string }) {
  return (
    <span className="hint pw-checks">
      {passwordChecks(value).map((c) => (
        <span key={c.text} className={value && c.ok ? 'ok-text' : ''}>{value && c.ok ? '✓' : '·'} {c.text}</span>
      ))}
    </span>
  );
}

type Mode = 'login' | 'register' | 'reset';
type Kind = 'store' | 'company' | 'employee' | 'branch';

const SOURCES = ['Знакомые или коллеги', 'Instagram', 'TikTok', 'WhatsApp или Telegram', 'Поиск в интернете', 'Представитель компании-поставщика', 'Другое'];

/** Какую вкладку открыть: из демо кнопка «Зарегистрироваться» ведёт сразу на регистрацию. */
export const AUTH_MODE_KEY = 'sauda:auth-mode';
const startMode = (): Mode => {
  try {
    return sessionStorage.getItem(AUTH_MODE_KEY) === 'register' ? 'register' : 'login';
  } catch {
    return 'login';
  }
};

export function AuthPage() {
  const { setRecovering } = useSession();
  const [mode, setMode] = useState<Mode>(startMode);
  // флаг одноразовый: при следующем открытии — снова вход
  useEffect(() => {
    try { sessionStorage.removeItem(AUTH_MODE_KEY); } catch { /* без хранилища */ }
  }, []);
  const [kind, setKind] = useState<Kind>('store');
  const [business, setBusiness] = useState<'grocery' | 'pharmacy'>('grocery');
  const [fullName, setFullName] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [source, setSource] = useState('');
  const [promo, setPromo] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // письмо с кодом ушло: вместо формы показывается окно ввода кода (подтверждение почты или восстановление пароля)
  const [sentTo, setSentTo] = useState<{ email: string; type: 'signup' | 'recovery' } | null>(null);
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const captchaToken = captcha ?? undefined;
  const needCaptcha = Boolean(CAPTCHA_KEY) && !captcha;
  // токен капчи одноразовый: после любого запроса проверка проходит заново
  const nextCaptcha = () => { setCaptcha(null); setRound((r) => r + 1); };
  // Карточка плавно меняет размер, когда меняется её содержимое (вход ↔ регистрация, «Сотрудник» прячет поля):
  // перед изменением запоминается размер, после отрисовки карточка анимируется от старого размера к новому.
  const card = useRef<HTMLFormElement>(null);
  const sizeBefore = useRef<{ w: number; h: number } | null>(null);
  const morph = (change: () => void) => {
    const el = card.current;
    sizeBefore.current = el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
    change();
  };
  useLayoutEffect(() => {
    const el = card.current;
    const from = sizeBefore.current;
    sizeBefore.current = null;
    if (!el || !from || !el.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // быстрый второй щелчок: прежняя анимация ещё идёт и исказила бы замер конечного размера
    for (const a of [...el.getAnimations(), ...(el.firstElementChild?.getAnimations() ?? [])]) a.cancel();
    const to = { w: el.offsetWidth, h: el.offsetHeight };
    if (from.w === to.w && from.h === to.h) return;
    const frame = (s: { w: number; h: number }) => ({ width: `${s.w}px`, height: `${s.h}px`, maxWidth: 'none', overflow: 'hidden' });
    const timing = { duration: 380, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
    // Содержимое сразу стоит в конечной раскладке и не перестраивается, пока карточка меняет ширину: иначе текст
    // каждый кадр переносится по-новому. Его ширина измеряется до старта анимации карточки — пока она конечная.
    const inner = el.firstElementChild as HTMLElement | null;
    const hold = inner ? { width: `${inner.offsetWidth}px`, flexShrink: 0 } : null;
    el.animate([frame(from), frame(to)], timing);
    // карточка открывает содержимое, как шторка, и оно проявляется
    if (inner && hold) inner.animate([{ ...hold, opacity: 0 }, { ...hold, opacity: 1, offset: 0.6 }, { ...hold, opacity: 1 }], timing);
  });
  const go = (m: Mode) => morph(() => { setMode(m); setError(null); setNotice(null); });
  // сотрудник по приглашению и филиал компании не заводят свою организацию: только имя, почта и пароль
  const employee = kind === 'employee' || kind === 'branch';

  const sendRecovery = (to: string) =>
    db.auth.resetPasswordForEmail(to, { redirectTo: confirmUrl(), captchaToken });

  const resend = async () => {
    if (!sentTo) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = sentTo.type === 'signup'
      ? await db.auth.resend({ type: 'signup', email: sentTo.email, options: { emailRedirectTo: confirmUrl(), captchaToken } })
      : await sendRecovery(sentTo.email);
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
    // после кода восстановления сессия появляется сразу: флаг держит экран «новый пароль» вместо кабинета
    if (sentTo.type === 'recovery') setRecovering(true);
    const { error } = await db.auth.verifyOtp({ email: sentTo.email, token: code, type: sentTo.type });
    setBusy(false);
    if (error) {
      if (sentTo.type === 'recovery') setRecovering(false);
      setError(errorText(error));
    }
  };

  // демо: анонимный вход, магазин с товарами и продажами создаёт база (start_demo), его открывает App
  const demo = async () => {
    setError(null);
    if (needCaptcha) return setError('Подтвердите, что вы не робот');
    setBusy(true);
    const { error } = await db.auth.signInAnonymously({ options: { captchaToken } });
    setBusy(false);
    nextCaptcha();
    if (error) setError(errorText(error));
  };

  const google = async () => {
    setError(null);
    if (mode === 'register' && !agree) return setError('Отметьте согласие с офертой и политикой конфиденциальности');
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: confirmUrl() } });
    if (error) setError(errorText(error));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'register') {
      if (!employee && city == null) return setError('Выберите город');
      const weak = passwordChecks(password).find((c) => !c.ok);
      if (weak) return setError(`Пароль: ${weak.text}`);
      if (password !== password2) return setError('Пароли не совпадают');
      if (!agree) return setError('Отметьте согласие с офертой и политикой конфиденциальности');
    }
    if (needCaptcha) return setError('Подтвердите, что вы не робот');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email: loginEmail(email.trim()), password, options: { captchaToken } });
        if (error) throw error;
      } else if (mode === 'reset') {
        const { error } = await sendRecovery(email.trim());
        if (error) throw error;
        // письмо уходит только на существующий адрес, но ответ одинаковый — чтобы адреса нельзя было перебирать
        setSentTo({ email: email.trim(), type: 'recovery' });
        setCode('');
      } else {
        const { data, error } = await db.auth.signUp({
          email: email.trim(),
          password,
          // выбор запоминается в профиле: следующий шаг (данные магазина или компании) откроется уже заполненным
          options: {
            emailRedirectTo: confirmUrl(),
            captchaToken,
            data: {
              full_name: fullName.trim(),
              account_kind: kind,
              ...(employee ? {} : { org_name: name.trim(), city_id: city, phone: formatPhone(phone) }),
              ...(kind === 'store' ? { business } : {}),
              source,
              promo: promo.trim().toUpperCase(),
              terms_version: TERMS_VERSION,
              terms_accepted_at: new Date().toISOString(),
            },
          },
        });
        if (error) throw error;
        // на занятый адрес сервер отвечает так же, как на новый, только без способов входа — чтобы адреса нельзя было перебирать
        if (data.user && data.user.identities?.length === 0) throw new Error('User already registered');
        if (!data.session) {
          setSentTo({ email: email.trim(), type: 'signup' });
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
    const recovery = sentTo.type === 'recovery';
    return (
      <div className="auth">
        <form className="auth-card stack" onSubmit={verify}>
          <div>
            <div className="brand"><span className="brand-mark">S</span>Sauda</div>
            <h2>{recovery ? 'Восстановление пароля' : 'Введите код из письма'}</h2>
          </div>
          <p>
            {recovery ? 'Если такой аккаунт есть, мы отправили ' : 'Мы отправили '}
            {CODE_LENGTH}-значный код на <b>{sentTo.email}</b>.
            {recovery && ' После кода вы зададите новый пароль.'}
          </p>
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
            <button type="button" className="link-btn" onClick={() => { setSentTo(null); go('login'); }}>
              Вернуться ко входу
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="auth">
        <form ref={card} className="auth-card morph" onSubmit={submit}>
          <div className="stack auth-inner">
            <div>
              <div className="brand"><span className="brand-mark">S</span>Sauda</div>
              <h2>Восстановление пароля</h2>
              <p className="muted">Укажите почту аккаунта — пришлём код, чтобы задать новый пароль.</p>
            </div>
            <label className="field">
              <span>Почта</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" />
            </label>
            <Captcha round={round} onToken={setCaptcha} />
            {error && <p className="error-text">{error}</p>}
            <button className="btn primary large" disabled={busy}>Прислать код</button>
            <div className="auth-links">
              <button type="button" className="link-btn" onClick={() => go('login')}>Вернуться ко входу</button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="auth">
      <form ref={card} className={`auth-card morph ${mode === 'register' ? 'wide' : ''}`} onSubmit={submit}>
        <div className="stack auth-inner">
          <div>
            <div className="brand"><span className="brand-mark">S</span>Sauda</div>
            <p className="muted">Учёт и касса для магазинов, каталог, склад и заказы для компаний</p>
          </div>
          <div className="segmented">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => go('login')}>Вход</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => go('register')}>Регистрация</button>
          </div>
          {mode === 'register' && (
            <>
              <div className="field">
                <span>Кто вы?</span>
                <div className="choice">
                  <button type="button" className={kind === 'store' ? 'active' : ''} onClick={() => morph(() => setKind('store'))}>
                    <b>Магазин</b>
                    <span>Учёт товаров, касса, заказы у компаний</span>
                  </button>
                  <button type="button" className={kind === 'company' ? 'active' : ''} onClick={() => morph(() => setKind('company'))}>
                    <b>Компания</b>
                    <span>Производитель или дистрибьютор: каталог, склад и заказы магазинов</span>
                  </button>
                  <button type="button" className={kind === 'branch' ? 'active' : ''} onClick={() => morph(() => setKind('branch'))}>
                    <b>Филиал компании</b>
                    <span>Склад или филиал: свой кабинет с заказами, остатками и ценами</span>
                  </button>
                  <button type="button" className={kind === 'employee' ? 'active' : ''} onClick={() => morph(() => setKind('employee'))}>
                    <b>Сотрудник</b>
                    <span>Меня пригласили в магазин или компанию</span>
                  </button>
                </div>
              </div>
              {employee && (
                <p className="hint">
                  {kind === 'branch'
                    ? 'Компанию и свой филиал выберете на следующем шаге. Кабинет откроется, когда владелец компании одобрит заявку.'
                    : 'Укажите почту, на которую владелец отправил приглашение: после входа вы сразу попадёте в его магазин или компанию.'}
                </p>
              )}
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
                </div>
              )}
              <label className="field">
                <span>Ваше имя</span>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" placeholder="Айгерим Сапарова" />
              </label>
              {!employee && (
                <>
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
            {mode === 'register' && <PasswordHint value={password} />}
          </label>
          {mode === 'login' && (
            <div className="auth-links" style={{ justifyContent: 'flex-end', marginTop: -4 }}>
              <button type="button" className="link-btn" onClick={() => go('reset')}>Забыли пароль?</button>
            </div>
          )}
          {mode === 'register' && (
            <>
              <label className="field">
                <span>Пароль ещё раз</span>
                <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} required autoComplete="new-password" />
                {password2 && (
                  <span className={`hint ${password2 === password ? 'ok-text' : 'error-text'}`}>
                    {password2 === password ? '✓ пароли совпадают' : 'пароли не совпадают'}
                  </span>
                )}
              </label>
              {!employee && (
                <div className="form-grid">
                  <label className="field">
                    <span>Откуда узнали о Sauda</span>
                    <select value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="">Не скажу</option>
                      {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Промокод</span>
                    <input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="если есть" autoComplete="off" maxLength={32} />
                  </label>
                </div>
              )}
              <label className="check-row">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  Принимаю <Link to="/terms" target="_blank">условия оферты</Link> и{' '}
                  <Link to="/privacy" target="_blank">политику конфиденциальности</Link>, согласен на обработку персональных данных
                </span>
              </label>
            </>
          )}
          <Captcha round={round} onToken={setCaptcha} />
          {error && <p className="error-text">{error}</p>}
          {notice && <p className="ok-text">{notice}</p>}
          <button className="btn primary large" disabled={busy}>
            {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
          {mode === 'login' && (
            <>
              <div className="auth-or"><span>или</span></div>
              <button type="button" className="btn large" disabled={busy} onClick={demo}>Попробовать без регистрации</button>
              <p className="hint" style={{ textAlign: 'center' }}>Откроется демо-магазин с товарами и продажами: можно пробить чек и посмотреть отчёты</p>
            </>
          )}
          {GOOGLE && (
            <>
              {mode !== 'login' && <div className="auth-or"><span>или</span></div>}
              <button type="button" className="btn large" onClick={google}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                {mode === 'login' ? 'Войти через Google' : 'Зарегистрироваться через Google'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
