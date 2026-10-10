import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { cityLabel, useCities } from '../lib/cities';
import { formatPhone } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import { db, errorText, q } from '../lib/supabase';
import type { CompanyCard } from '../lib/types';
import { CitySelect } from '../ui/CitySelect';
import { PhoneInput } from '../ui/PhoneInput';

interface MyRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined';
  name: string;
  orgs: { name: string } | null;
  company_branches: { name: string } | null;
}

/**
 * Подключение филиала к компании: сотрудник выбирает компанию и филиал (или описывает новый) и отправляет заявку.
 * Кабинет филиала откроется, когда владелец компании её одобрит.
 */
export function BranchJoin({ onBack, terms }: { onBack: () => void; terms?: { ok: boolean; accept: () => Promise<void>; box: ReactNode } }) {
  const { user, reload, signOut } = useSession();
  const cities = useCities();
  const meta = (user?.user_metadata ?? {}) as { phone?: string };
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState<CompanyCard | null>(null);
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(meta.phone ?? '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery(
    async () => (await q<MyRequest[]>(
      db.from('branch_requests').select('id, status, name, orgs(name), company_branches(name)')
        .eq('user_id', user?.id ?? '').order('created_at', { ascending: false }).limit(1) as never,
    ))[0] ?? null,
    [user?.id],
  );
  const companies = useQuery(() => q<CompanyCard[]>(db.rpc('company_directory')), []);
  const branches = useQuery(
    async () => (company
      ? q<{ id: string; name: string; city_id: number }[]>(db.from('company_branches').select('id, name, city_id').eq('org_id', company.id).order('name'))
      : []),
    [company?.id],
  );
  const found = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (companies.data ?? []).filter((c) => !t || c.name.toLowerCase().includes(t)).slice(0, 8);
  }, [companies.data, search]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!company) return setError('Выберите компанию');
    if (!branch && (!name.trim() || city == null)) return setError('Выберите свой филиал из списка или укажите название и город нового');
    if (terms && !terms.ok) return setError('Отметьте согласие с офертой и политикой конфиденциальности');
    setBusy(true);
    try {
      await terms?.accept();
      await q(db.rpc('request_branch', {
        p_company: company.id, p_branch: branch || undefined, p_name: name.trim(), p_city: city ?? undefined,
        p_address: address.trim(), p_phone: formatPhone(phone), p_comment: comment.trim(),
      }));
      mine.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const r = mine.data;
  if (mine.loading && !r) return <div className="auth muted">Загрузка…</div>;

  if (r?.status === 'pending') {
    return (
      <div className="auth">
        <div className="auth-card stack">
          <div className="brand"><span className="brand-mark">S</span>Sauda</div>
          <h2>Заявка отправлена</h2>
          <p>
            Вы попросили доступ к кабинету филиала «{r.company_branches?.name || r.name}» компании <b>{r.orgs?.name}</b>.
            Кабинет откроется, когда владелец компании одобрит заявку — в её профиле, в разделе «Филиалы».
          </p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary large" disabled={busy} onClick={async () => { setBusy(true); await reload(); mine.reload(); setBusy(false); }}>
            Проверить снова
          </button>
          <button className="btn" disabled={busy}
            onClick={async () => { await db.rpc('cancel_branch_request', { p_request: r.id }); mine.reload(); }}>
            Отозвать заявку
          </button>
          <button type="button" className="btn ghost" onClick={signOut}>Выйти из {user?.email}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form className="auth-card wide stack" onSubmit={submit}>
        <div>
          <h1>Филиал компании</h1>
          <p className="muted">
            Выберите компанию, в которой вы работаете, и свой филиал или склад. После одобрения владельцем у вас будет
            свой кабинет: заказы, остатки, цены и сотрудники только вашего филиала.
          </p>
        </div>
        {r?.status === 'declined' && (
          <div className="card pad warn-box">Компания «{r.orgs?.name}» отклонила прошлую заявку. Можно отправить новую.</div>
        )}
        <div className="field">
          <span>Компания <b>*</b></span>
          {company ? (
            <div className="row">
              <b className="grow">{company.name}</b>
              <button type="button" className="link-btn" onClick={() => { setCompany(null); setBranch(''); }}>Выбрать другую</button>
            </div>
          ) : (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Начните вводить название компании" autoFocus />
              <div className="pick-list">
                {found.map((c) => (
                  <button type="button" key={c.id} onClick={() => setCompany(c)}>
                    <b>{c.name}</b>
                    <span className="muted">{c.cities.join(', ')}</span>
                  </button>
                ))}
                {!companies.loading && found.length === 0 && (
                  <span className="muted">Такой компании на площадке нет. Попросите владельца сначала зарегистрировать компанию.</span>
                )}
              </div>
            </>
          )}
        </div>
        {company && (
          <>
            <label className="field">
              <span>Ваш филиал или склад <b>*</b></span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">Его ещё нет в списке — новый филиал</option>
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} — {cityLabel(cities, b.city_id)}</option>)}
              </select>
            </label>
            {!branch && (
              <div className="form-grid">
                <label className="field">
                  <span>Название филиала <b>*</b></span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Склад в Шымкенте" />
                </label>
                <div className="field">
                  <span>Город <b>*</b></span>
                  <CitySelect value={city} onChange={setCity} aria-label="Город" />
                </div>
                <label className="field">
                  <span>Адрес</span>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ул. Складская, 1" />
                </label>
                <label className="field">
                  <span>Телефон филиала</span>
                  <PhoneInput value={phone} onChange={setPhone} />
                </label>
              </div>
            )}
            <label className="field">
              <span>Комментарий владельцу</span>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Кто вы и чем занимаетесь в филиале" maxLength={200} />
            </label>
          </>
        )}
        {terms?.box}
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary large" disabled={busy || !company}>Отправить заявку</button>
        <button type="button" className="btn" onClick={onBack}>Я завожу свой магазин или компанию</button>
        <button type="button" className="btn ghost" onClick={signOut}>Выйти из {user?.email}</button>
      </form>
    </div>
  );
}
