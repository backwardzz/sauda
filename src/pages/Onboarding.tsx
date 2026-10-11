import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatPhone } from '../lib/format';
import { db, errorText, q } from '../lib/supabase';
import { useSession } from '../lib/session';
import { TERMS_VERSION } from './Auth';
import { BranchJoin } from './BranchJoin';
import type { OrgKind } from '../lib/types';
import { CitySelect } from '../ui/CitySelect';
import { PhoneInput } from '../ui/PhoneInput';

/** auto — организация создаётся сама; lost — приглашение не найдено; form — те же вопросы, что в регистрации; branch — заявка филиала. */
type View = 'auto' | 'lost' | 'form' | 'branch';

/**
 * Первый вход: у пользователя ещё нет магазина или компании и нет приглашений.
 * После обычной регистрации организация создаётся сама из данных формы, и человек ничего здесь не видит.
 * Приглашённому без приглашения показывается короткий экран с выбором, что делать дальше.
 */
export function Onboarding() {
  const { user, reload, signOut } = useSession();
  const navigate = useNavigate();
  const meta = (user?.user_metadata ?? {}) as {
    account_kind?: string; city_id?: number; phone?: string; full_name?: string; name?: string; org_name?: string;
    business?: string; terms_version?: string;
  };
  // зарегистрировался во вкладке «Меня пригласили», а приглашения на эту почту нет
  const lostEmployee = meta.account_kind === 'employee';
  // вход через Google проходит без формы регистрации: согласие спрашивается здесь
  const needTerms = meta.terms_version !== TERMS_VERSION;
  const [agree, setAgree] = useState(false);
  const [kind, setKind] = useState<OrgKind>(meta.account_kind === 'company' || meta.account_kind === 'supplier' ? 'company' : 'store');
  const [business, setBusiness] = useState<'grocery' | 'pharmacy'>(meta.business === 'pharmacy' ? 'pharmacy' : 'grocery');
  const [name, setName] = useState(meta.org_name ?? '');
  const [city, setCity] = useState<number | null>(typeof meta.city_id === 'number' ? meta.city_id : null);
  const [phone, setPhone] = useState(meta.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => {
    if (meta.account_kind === 'branch') return 'branch';
    if (lostEmployee) return 'lost';
    const complete = (meta.account_kind === 'store' || meta.account_kind === 'company') && !!meta.org_name?.trim() && typeof meta.city_id === 'number';
    return complete && !needTerms ? 'auto' : 'form';
  });
  const started = useRef(false);

  const isStore = kind === 'store';
  const home: View = lostEmployee ? 'lost' : 'form';

  const acceptTerms = async () => {
    if (!needTerms) return;
    const { error } = await db.auth.updateUser({ data: { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() } });
    if (error) throw error;
  };

  // адрес, БИН, тип и описание компании заполняются позже в профиле
  const create = async () => {
    setBusy(true);
    try {
      await acceptTerms();
      await q(db.rpc('create_org', {
        p_name: name, p_store: name, p_kind: kind, p_business: business, p_city: city,
        p_profile: {
          phone: formatPhone(phone), address: '', bin: '', email: user?.email ?? '', contact_name: meta.full_name ?? meta.name ?? '',
          ...(isStore ? {} : { company_type: 'distributor', description: '' }),
        },
      }));
      // новой торговой точке сразу предлагаются пакеты ходовых товаров с ценами компаний
      if (isStore && business === 'grocery') navigate('/catalog/starter');
      await reload();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      // не получилось создать автоматически: показываем вопросы с ошибкой, ответы в них уже подставлены
      setView('form');
    }
  };

  useEffect(() => {
    // в режиме разработки эффект запускается дважды: вторая организация не нужна
    if (view !== 'auto' || started.current) return;
    started.current = true;
    void create();
    // запускается один раз при открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (city == null) return setError('Выберите город');
    if (needTerms && !agree) return setError('Отметьте согласие с офертой и политикой конфиденциальности');
    void create();
  };

  const termsBox = needTerms && (
    <label className="check-row">
      <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
      <span>
        Принимаю <Link to="/terms" target="_blank">условия оферты</Link> и{' '}
        <Link to="/privacy" target="_blank">политику конфиденциальности</Link>, согласен на обработку персональных данных
      </span>
    </label>
  );

  if (view === 'auto') return <div className="auth muted">{isStore ? 'Создаём кабинет торговой точки…' : 'Создаём кабинет поставщика…'}</div>;

  if (view === 'branch') {
    return <BranchJoin onBack={() => setView(home)} terms={{ ok: !needTerms || agree, accept: acceptTerms, box: termsBox }} />;
  }

  if (view === 'lost') {
    return (
      <div className="auth">
        <div className="auth-card stack">
          <div className="brand"><span className="brand-mark">S</span>Sauda</div>
          <h2>Приглашение не найдено</h2>
          <p>
            На почту <b>{user?.email}</b> приглашений нет. Попросите владельца пригласить именно этот адрес в разделе
            «Сотрудники» и нажмите «Проверить снова».
          </p>
          <button type="button" className="btn primary large" disabled={busy}
            onClick={async () => { setBusy(true); await reload(); setBusy(false); }}>
            Проверить снова
          </button>
          <button type="button" className="btn" onClick={() => setView('branch')}>Я из филиала или склада компании</button>
          <button type="button" className="btn" onClick={() => setView('form')}>Зарегистрировать свой бизнес</button>
          <button type="button" className="btn ghost" onClick={signOut}>Выйти из {user?.email}</button>
        </div>
      </div>
    );
  }

  // те же вопросы, что в форме регистрации: аккаунт уже есть, не хватает только данных организации
  return (
    <div className="auth">
      <form className="auth-card wide stack" onSubmit={submit}>
        <div className="brand"><span className="brand-mark">S</span>Sauda</div>
        <div className="field">
          <span>Кто вы?</span>
          <div className="choice">
            <button type="button" className={isStore ? 'active' : ''} onClick={() => setKind('store')}>
              <b>Торговая точка</b>
              <span>Магазин или сеть: учёт товаров, касса, заказы у поставщиков</span>
            </button>
            <button type="button" className={!isStore ? 'active' : ''} onClick={() => setKind('company')}>
              <b>Поставщик</b>
              <span>Производитель или дистрибьютор: каталог, склад и заказы магазинов</span>
            </button>
          </div>
        </div>
        {isStore && (
          <>
            <label className="check-row">
              <input type="checkbox" checked={business === 'pharmacy'} onChange={(e) => setBusiness(e.target.checked ? 'pharmacy' : 'grocery')} />
              <span>У меня аптека <span className="badge warn">скоро</span></span>
            </label>
            {business === 'pharmacy' && (
              <p className="hint">
                Раздел для аптек в разработке: справочника лекарств, учёта серий и сроков годности пока нет.
                Зарегистрироваться можно уже сейчас — будут доступны обычный учёт товаров, касса и отчёты.
              </p>
            )}
          </>
        )}
        <label className="field">
          <span>{isStore ? 'Название торговой точки' : 'Название компании'}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus autoComplete="organization"
            placeholder={isStore ? 'ИП Иванов' : 'ТОО «Молочный завод»'} />
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
        {termsBox}
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary large" disabled={busy}>Продолжить</button>
        {lostEmployee
          ? <button type="button" className="btn" onClick={() => setView('lost')}>Назад</button>
          : <button type="button" className="btn" onClick={() => setView('branch')}>Я из филиала или склада компании</button>}
        <button type="button" className="btn ghost" onClick={signOut}>Выйти из {user?.email}</button>
      </form>
    </div>
  );
}
