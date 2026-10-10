import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cityName, useCities } from '../../lib/cities';
import { dateOnly, formatPhone, money, parseNum } from '../../lib/format';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { COMPANY_TYPE, type CompanyType, type PriceAccessMode } from '../../lib/types';
import { VerifiedBadge } from '../../ui/CompanyAvatar';
import { Icon } from '../../ui/Icon';
import { LogoUpload } from '../../ui/LogoUpload';
import { Modal } from '../../ui/Modal';
import { PhoneInput } from '../../ui/PhoneInput';
import { toast } from '../../ui/toast';
import { ApiKeys } from './ApiKeys';
import { BranchRequests } from './BranchRequests';
import { Branches } from './Branches';

/** Профиль магазина или компании: сначала просмотр, правка — по кнопке. */
export function Profile() {
  const { org, role, company, branchId, branches, stores, reload } = useOrg();
  const cities = useCities();
  const [editing, setEditing] = useState(false);
  const owner = role === 'owner';
  const isCompany = org.kind === 'company';

  const places = isCompany ? branches.map((b) => b.city_id) : stores.map((s) => s.city_id);
  const cityList = [...new Set(places.map((id) => cityName(cities, id)).filter(Boolean))];

  // чего не хватает, чтобы магазины доверяли карточке компании (а компании — заказам магазина)
  const missing = [
    !org.logo_url && 'логотип',
    !org.phone && 'телефон',
    !org.bin && 'БИН или ИИН',
    isCompany && !company?.description && 'описание',
    isCompany && !company?.delivery_note && 'условия доставки',
  ].filter(Boolean) as string[];

  const saveLogo = async (logo: string) => {
    await q(db.from('orgs').update({ logo_url: logo }).eq('id', org.id));
    toast.ok(logo ? 'Логотип обновлён' : 'Логотип убран');
    await reload();
  };

  return (
    <>
      <div className="page-head">
        <h1>{isCompany ? 'Профиль компании' : 'Профиль магазина'}</h1>
        <span className="muted">{isCompany ? 'Так компанию видят магазины на площадке' : 'Эти сведения видят компании в ваших заказах'}</span>
      </div>

      <div className="card profile-head">
        <LogoUpload name={org.name} value={org.logo_url} onChange={owner ? saveLogo : undefined} />
        <div className="grow stack" style={{ gap: 6 }}>
          <div className="row wrap">
            <h2 className="profile-name">{org.name}</h2>
            {isCompany && company && <span className="badge accent">{COMPANY_TYPE[company.company_type]}</span>}
            {!isCompany && <span className="badge accent">{org.business === 'pharmacy' ? 'Аптека' : 'Магазин'}</span>}
            {company?.verified && <VerifiedBadge />}
          </div>
          {isCompany && (company?.description
            ? <p>{company.description}</p>
            : <p className="muted">Расскажите магазинам, чем торгуете: это первое, что они видят в карточке компании.</p>)}
          <div className="row wrap muted">
            {cityList.length > 0 && <span className="row"><Icon name="pin" size={15} />{cityList.join(', ')}</span>}
            <span>На площадке с {dateOnly(org.created_at)}</span>
          </div>
        </div>
        {owner && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Редактировать</button>}
      </div>

      {owner && missing.length > 0 && (
        <div className="card banner">
          <Icon name="alert" />
          <span className="grow">Профиль заполнен не до конца. Добавьте: {missing.join(', ')}.</span>
          <button className="btn" onClick={() => setEditing(true)}>Заполнить</button>
        </div>
      )}

      <div className="profile-grid">
        <div className="card pad">
          <div className="section-title">Реквизиты и контакты</div>
          <dl className="kv info">
            <dt>БИН / ИИН</dt><dd>{org.bin || '—'}</dd>
            <dt>Телефон</dt><dd>{org.phone ? <a href={`tel:${org.phone.replace(/[^\d+]/g, '')}`}>{org.phone}</a> : '—'}</dd>
            <dt>Почта</dt><dd>{org.email ? <a href={`mailto:${org.email}`}>{org.email}</a> : '—'}</dd>
            <dt>Контактное лицо</dt><dd>{org.contact_name || '—'}</dd>
            {isCompany && <><dt>Сайт</dt><dd>{company?.website ? <a href={company.website} target="_blank" rel="noreferrer noopener">{company.website.replace(/^https?:\/\//, '')}</a> : '—'}</dd></>}
          </dl>
        </div>
        {isCompany && company && (
          <div className="card pad">
            <div className="section-title">Условия для магазинов</div>
            <dl className="kv info">
              <dt>Минимальный заказ</dt><dd>{Number(company.min_order) > 0 ? `${money(company.min_order)} ${org.currency}` : 'без ограничения'}</dd>
              <dt>Доставка</dt><dd>{company.delivery_note || '—'}</dd>
              <dt>Оплата</dt><dd>{company.payment_terms || '—'}</dd>
              <dt>Цены видят</dt>
              <dd>
                {company.price_access === 'approved' ? 'только одобренные магазины' : 'все магазины'}
                {' · '}<Link to="/price-access">запросы и доступы</Link>
              </dd>
            </dl>
          </div>
        )}
        {!isCompany && (
          <div className="card pad">
            <div className="section-title">Торговые точки</div>
            {stores.map((s) => (
              <div className="list-row flush" key={s.id}>
                <Icon name="store" size={16} />
                <span className="grow">{s.name}</span>
                <span className="muted">{[cityName(cities, s.city_id), s.address].filter(Boolean).join(', ') || 'адрес не указан'}</span>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 8 }}>Город и адрес точки нужны компаниям для доставки. <Link to="/stores">Изменить</Link></p>
          </div>
        )}
      </div>

      {isCompany && !branchId && <BranchRequests />}
      {isCompany && <Branches />}
      {isCompany && owner && <ApiKeys />}

      {editing && <ProfileEditor onClose={() => setEditing(false)} />}
    </>
  );
}

function ProfileEditor({ onClose }: { onClose: () => void }) {
  const { org, company, reload } = useOrg();
  const isCompany = org.kind === 'company';
  const [form, setForm] = useState({
    name: org.name, phone: org.phone, email: org.email, contact: org.contact_name, bin: org.bin,
    type: (company?.company_type ?? 'distributor') as CompanyType, description: company?.description ?? '', website: company?.website ?? '',
    min: Number(company?.min_order) ? String(Number(company?.min_order)) : '', delivery: company?.delivery_note ?? '', payment: company?.payment_terms ?? '',
    prices: (company?.price_access ?? 'stores') as PriceAccessMode,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const save = async () => {
    const bin = form.bin.replace(/\s/g, '');
    const website = form.website.trim() && !/^https?:\/\//i.test(form.website.trim()) ? `https://${form.website.trim()}` : form.website.trim();
    if (!form.name.trim()) return toast.error('Укажите название');
    if (bin && !/^\d{12}$/.test(bin)) return toast.error('БИН или ИИН — это 12 цифр');
    setBusy(true);
    try {
      await q(db.from('orgs').update({
        name: form.name.trim(), phone: formatPhone(form.phone), email: form.email.trim(), contact_name: form.contact.trim(), bin,
      }).eq('id', org.id));
      if (isCompany) {
        await q(db.from('companies').update({
          company_type: form.type, description: form.description.trim(), website,
          min_order: Math.max(parseNum(form.min), 0), delivery_note: form.delivery.trim(), payment_terms: form.payment.trim(),
          price_access: form.prices,
        }).eq('org_id', org.id));
      }
      toast.ok('Профиль сохранён');
      await reload();
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Modal title="Редактировать профиль" onClose={onClose} width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy} onClick={save}>Сохранить</button>
        </>
      }>
      <div className="form-grid">
        <label className="field wide">
          <span>Название <b>*</b></span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </label>
        {isCompany && (
          <>
            <div className="field wide">
              <span>Тип компании</span>
              <div className="segmented">
                {(Object.keys(COMPANY_TYPE) as CompanyType[]).map((t) => (
                  <button type="button" key={t} className={form.type === t ? 'active' : ''} onClick={() => set({ type: t })}>{COMPANY_TYPE[t]}</button>
                ))}
              </div>
            </div>
            <label className="field wide">
              <span>Чем торгуете</span>
              <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })}
                placeholder="Молочная продукция собственного производства, доставка по городу" />
            </label>
          </>
        )}
        <label className="field">
          <span>Телефон</span>
          <PhoneInput value={form.phone} onChange={(phone) => set({ phone })} />
        </label>
        <label className="field">
          <span>Почта</span>
          <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </label>
        <label className="field">
          <span>Контактное лицо</span>
          <input value={form.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="Имя и должность" />
        </label>
        <label className="field">
          <span>БИН или ИИН</span>
          <input value={form.bin} onChange={(e) => set({ bin: e.target.value })} inputMode="numeric" maxLength={14} placeholder="12 цифр" />
        </label>
        {isCompany && (
          <>
            <label className="field">
              <span>Сайт</span>
              <input value={form.website} onChange={(e) => set({ website: e.target.value })} inputMode="url" placeholder="company.kz" />
            </label>
            <label className="field">
              <span>Минимальная сумма заказа, {org.currency}</span>
              <input className="num-input" value={form.min} onChange={(e) => set({ min: e.target.value })} inputMode="decimal" placeholder="без ограничения" />
            </label>
            <label className="field wide">
              <span>Условия доставки</span>
              <input value={form.delivery} onChange={(e) => set({ delivery: e.target.value })} placeholder="Доставка вт и пт, заказ до 16:00 накануне" />
            </label>
            <label className="field wide">
              <span>Условия оплаты</span>
              <input value={form.payment} onChange={(e) => set({ payment: e.target.value })} placeholder="Наличными или переводом при получении, отсрочка 7 дней" />
            </label>
            <label className="field wide">
              <span>Кому видны цены и остатки</span>
              <select value={form.prices} onChange={(e) => set({ prices: e.target.value as PriceAccessMode })}>
                <option value="stores">Всем магазинам на площадке</option>
                <option value="approved">Только магазинам, которым я открыл прайс</option>
              </select>
              <small className="hint">
                {form.prices === 'approved'
                  ? 'Магазин видит каталог без цен и отправляет запрос. Магазины, которые уже заказывали, получат доступ сразу.'
                  : 'Другие компании ваших цен не видят никогда.'}
              </small>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
