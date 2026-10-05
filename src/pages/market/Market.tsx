import { useState } from 'react';
import { Link } from 'react-router-dom';
import { readCart } from '../../lib/cart';
import { money, plural } from '../../lib/format';
import { useQuery, useStored } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { COMPANY_TYPE, type CompanyCard } from '../../lib/types';
import { CitySelect } from '../../ui/CitySelect';
import { CompanyAvatar, VerifiedBadge } from '../../ui/CompanyAvatar';
import { Icon } from '../../ui/Icon';
import { ProductImage } from '../../ui/ProductImage';

/** Компании площадки глазами магазина: кто чем торгует, в каких городах и на каких условиях. */
export function Market() {
  const { org, store } = useWorkspace();
  const [search, setSearch] = useState('');
  // по умолчанию — компании с филиалом в городе магазина; null — все города
  const [city, setCity] = useStored<number | null>(`sauda:market:city:${store.id}`, store.city_id);

  const companies = useQuery(() => q<CompanyCard[]>(db.rpc('company_directory')), []);

  const term = search.trim().toLowerCase();
  const all = companies.data ?? [];
  const list = all.filter((c) =>
    (city == null || c.city_ids.includes(city)) &&
    (!term || c.name.toLowerCase().includes(term) || c.description.toLowerCase().includes(term) || c.categories.some((x) => x.toLowerCase().includes(term))));
  const elsewhere = city == null ? 0 : all.length - all.filter((c) => c.city_ids.includes(city)).length;

  return (
    <>
      <div className="page-head">
        <h1>Компании</h1>
        <span className="muted">Выберите компанию, соберите заказ из её каталога — приёмка потом создастся сама</span>
      </div>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Название, товар или категория" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ width: 220 }}><CitySelect value={city} onChange={setCity} allowAll aria-label="Город" /></div>
        <span className="spacer" />
        <Link className="btn" to="/cart"><Icon name="cart" size={16} />Корзина</Link>
        <Link className="btn" to="/orders">Мои заказы</Link>
      </div>
      {companies.error && <div className="card empty error-text">{companies.error}</div>}
      {!companies.loading && list.length === 0 && (
        <div className="card empty">
          {term ? 'Ничего не найдено' : city != null && all.length ? 'В этом городе пока нет филиалов компаний' : 'На площадке пока нет компаний'}
          {elsewhere > 0 && <p style={{ marginTop: 8 }}><button className="btn" onClick={() => setCity(null)}>Показать компании из других городов: {elsewhere}</button></p>}
        </div>
      )}
      <div className="supplier-grid">
        {list.map((c) => {
          const inCart = Object.keys(readCart(store.id, c.id)).length;
          return (
            <Link key={c.id} to={`/market/${c.id}`} className="card supplier-card">
              <div className="row">
                <CompanyAvatar name={c.name} logo={c.logo_url} size={44} />
                <div className="grow">
                  <h2>{c.name}</h2>
                  <div className="muted">{COMPANY_TYPE[c.company_type]} · {c.products} {plural(Number(c.products), 'товар', 'товара', 'товаров')}</div>
                </div>
                {inCart > 0 && <span className="badge accent">в корзине {inCart}</span>}
              </div>
              {c.verified && <VerifiedBadge />}
              {c.images.length > 0 && (
                <div className="supplier-shots">
                  {c.images.map((src) => <ProductImage key={src} src={src} alt="" />)}
                </div>
              )}
              {c.description && <p>{c.description}</p>}
              <div className="row wrap">
                {c.categories.map((x) => <span className="badge" key={x}>{x}</span>)}
              </div>
              <div className="muted supplier-terms">
                {c.cities.length > 0 && <span className="row"><Icon name="pin" size={14} />{c.cities.join(', ')}</span>}
                {Number(c.min_order) > 0 && <span>Заказ от {money(c.min_order)} {org.currency}</span>}
                {c.delivery_note && <span>{c.delivery_note}</span>}
              </div>
            </Link>
          );
        })}
      </div>
      {city != null && elsewhere > 0 && list.length > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          Ещё {elsewhere} {plural(elsewhere, 'компания', 'компании', 'компаний')} без филиала в вашем городе: заказ у них соберёт главный филиал.{' '}
          <a onClick={() => setCity(null)} style={{ cursor: 'pointer' }}>Показать все</a>
        </p>
      )}
    </>
  );
}
