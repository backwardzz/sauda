import { useState, type FormEvent } from 'react';
import { formatPhone } from '../lib/format';
import { db, errorText, q } from '../lib/supabase';
import { useSession } from '../lib/session';
import { COMPANY_TYPE, type CompanyType, type OrgKind } from '../lib/types';
import { CitySelect } from '../ui/CitySelect';

/** Первый вход: у пользователя ещё нет магазина или компании и нет приглашений. */
export function Onboarding() {
  const { user, reload, signOut } = useSession();
  const meta = (user?.user_metadata ?? {}) as { account_kind?: string; city_id?: number; phone?: string; full_name?: string };
  // роль, город и телефон выбраны при регистрации; здесь их ещё можно поменять
  const [kind, setKind] = useState<OrgKind>(meta.account_kind === 'company' || meta.account_kind === 'supplier' ? 'company' : 'store');
  const [business, setBusiness] = useState<'grocery' | 'pharmacy'>('grocery');
  const [companyType, setCompanyType] = useState<CompanyType>('distributor');
  const [fresh, setFresh] = useState(true);
  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [city, setCity] = useState<number | null>(typeof meta.city_id === 'number' ? meta.city_id : null);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(meta.phone ?? '');
  const [bin, setBin] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStore = kind === 'store';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (city == null) return setError('Выберите город');
    if (bin.trim() && !/^\d{12}$/.test(bin.replace(/\s/g, ''))) return setError('БИН или ИИН — это 12 цифр');
    setBusy(true);
    try {
      await q(db.rpc('create_org', {
        p_name: name, p_store: storeName || name, p_kind: kind, p_business: business, p_city: city,
        p_profile: {
          phone: formatPhone(phone), address, bin: bin.replace(/\s/g, ''), email: user?.email ?? '', contact_name: meta.full_name ?? '',
          ...(isStore ? {} : { company_type: companyType, description }),
        },
      }));
      // новому магазину сразу предлагаются пакеты ходовых товаров с ценами компаний
      if (isStore && business === 'grocery' && fresh) window.location.hash = '#/catalog/starter';
      await reload();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card wide stack" onSubmit={submit}>
        <div>
          <h1>Расскажите о себе</h1>
          <p className="muted">
            Если вас пригласили в существующий магазин или компанию, войдите с той почтой, на которую пришло приглашение.
          </p>
        </div>
        <div className="choice">
          <button type="button" className={isStore ? 'active' : ''} onClick={() => setKind('store')}>
            <b>Магазин</b>
            <span>Учёт товаров, касса, отчёты, заказы у компаний</span>
          </button>
          <button type="button" className={!isStore ? 'active' : ''} onClick={() => setKind('company')}>
            <b>Компания</b>
            <span>Производитель или дистрибьютор: каталог, склад и заказы магазинов</span>
          </button>
        </div>
        {isStore ? (
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
        ) : (
          <div className="field">
            <span>Тип компании</span>
            <div className="segmented">
              {(Object.keys(COMPANY_TYPE) as CompanyType[]).map((t) => (
                <button type="button" key={t} className={companyType === t ? 'active' : ''} onClick={() => setCompanyType(t)}>{COMPANY_TYPE[t]}</button>
              ))}
            </div>
          </div>
        )}
        <div className="form-grid">
          <label className={`field ${isStore ? '' : 'wide'}`}>
            <span>{isStore ? 'Название магазина или сети' : 'Название компании'} <b>*</b></span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus
              placeholder={!isStore ? 'ТОО «Молочный завод»' : business === 'pharmacy' ? 'ТОО «Аптека Здоровье»' : 'ИП Иванов'} />
          </label>
          {isStore && (
            <label className="field">
              <span>{business === 'pharmacy' ? 'Первая аптека' : 'Первая торговая точка'}</span>
              <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder={business === 'pharmacy' ? 'Аптека на Абая' : 'Магазин на Абая'} />
            </label>
          )}
          <div className="field">
            <span>Город <b>*</b></span>
            <CitySelect value={city} onChange={setCity} aria-label="Город" />
          </div>
          <label className="field">
            <span>{isStore ? 'Адрес магазина' : 'Адрес главного офиса'}</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="пр. Абая, 10" autoComplete="street-address" />
          </label>
          <label className="field">
            <span>Телефон <b>*</b></span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} required
              inputMode="tel" autoComplete="tel" placeholder="+7 701 000 00 00" />
          </label>
          <label className="field">
            <span>БИН или ИИН</span>
            <input value={bin} onChange={(e) => setBin(e.target.value)} inputMode="numeric" maxLength={14} placeholder="12 цифр, можно позже" />
          </label>
          {!isStore && (
            <label className="field wide">
              <span>Чем торгуете</span>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Молочная продукция собственного производства, доставка по городу" />
            </label>
          )}
        </div>
        {isStore && business === 'grocery' && (
          <label className="check-row">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
            <span>У меня новый магазин — предложить пакет ходовых товаров с ценами</span>
          </label>
        )}
        {!isStore && (
          <p className="hint">
            В этом городе появится главный филиал компании. Остальные филиалы, логотип и условия доставки добавите в профиле.
          </p>
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
