import { useState } from 'react';
import { Link } from 'react-router-dom';
import { readCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useWorkspace } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import type { Org } from '../../lib/types';
import { ProductImage } from '../../ui/ProductImage';

/** Витрина поставщиков для магазина. */
export function Market() {
  const { org, store } = useWorkspace();
  const [search, setSearch] = useState('');

  const suppliers = useQuery(async () => {
    const [orgs, products] = await Promise.all([
      q<Org[]>(db.from('orgs').select('*').eq('kind', 'supplier').order('name')),
      q<{ org_id: string; category: string; image_url: string }[]>(db.from('supplier_products').select('org_id, category, image_url').eq('archived', false).limit(20000)),
    ]);
    return orgs.map((o) => {
      const own = products.filter((p) => p.org_id === o.id);
      return { org: o, count: own.length, images: own.map((p) => p.image_url).filter(Boolean).slice(0, 5), categories: [...new Set(own.map((p) => p.category).filter(Boolean))].slice(0, 5) };
    });
  }, []);

  const term = search.trim().toLowerCase();
  const list = (suppliers.data ?? []).filter(
    (s) => !term || s.org.name.toLowerCase().includes(term) || s.categories.some((c) => c.toLowerCase().includes(term)),
  );

  return (
    <>
      <div className="page-head">
        <h1>Поставщики</h1>
        <span className="muted">Выберите поставщика, соберите заказ из его каталога — приёмка потом создастся сама</span>
      </div>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Название или категория" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <Link className="btn" to="/orders">Мои заказы</Link>
      </div>
      {suppliers.error && <div className="card empty error-text">{suppliers.error}</div>}
      {!suppliers.loading && list.length === 0 && (
        <div className="card empty">{term ? 'Ничего не найдено' : 'На площадке пока нет поставщиков'}</div>
      )}
      <div className="supplier-grid">
        {list.map(({ org: s, count, categories, images }) => {
          const inCart = Object.keys(readCart(store.id, s.id)).length;
          return (
            <Link key={s.id} to={`/market/${s.id}`} className="card supplier-card">
              <div className="row">
                <span className="avatar big">{s.name.replace(/[«»"]|ТОО|ИП|КХ/g, '').trim().slice(0, 1).toUpperCase()}</span>
                <div className="grow">
                  <h2>{s.name}</h2>
                  <div className="muted">Товаров: {count}</div>
                </div>
                {inCart > 0 && <span className="badge accent">в корзине {inCart}</span>}
              </div>
              {images.length > 0 && (
                <div className="supplier-shots">
                  {images.map((src) => <ProductImage key={src} src={src} alt="" />)}
                </div>
              )}
              {s.description && <p>{s.description}</p>}
              <div className="row wrap">
                {categories.map((c) => <span className="badge" key={c}>{c}</span>)}
              </div>
              <div className="muted supplier-terms">
                {Number(s.min_order) > 0 && <span>Заказ от {money(s.min_order)} {org.currency}</span>}
                {s.delivery_note && <span>{s.delivery_note}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
