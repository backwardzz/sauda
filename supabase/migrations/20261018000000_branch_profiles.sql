-- Профиль склада: у каждого филиала свои цены, ассортимент, зона обслуживания и условия заказа.
-- Каталог остаётся общим на компанию: название, фото, штрихкод и базовая цена — в товаре и виде.
-- Всё, что у складов разное, лежит на пересечении «вид × филиал» (company_stock) и в самом филиале.

-- ───────────────────────── Филиал: надбавка и условия ─────────────────────────

alter table public.company_branches
  -- надбавка ко всему прайсу компании, в процентах: «в Актау на 8% дороже». Отрицательная — скидка
  add column markup_pct numeric(6, 2) not null default 0 check (markup_pct > -100 and markup_pct <= 500),
  -- свои условия филиала; пусто — действуют условия компании
  add column min_order numeric(14, 2) check (min_order >= 0),
  add column delivery_note text not null default '';
grant insert (markup_pct, min_order, delivery_note) on public.company_branches to authenticated;
grant update (markup_pct, min_order, delivery_note) on public.company_branches to authenticated;

-- ───────────────────────── Вид × филиал: своя цена и «продаётся ли здесь» ─────────────────────────

alter table public.company_stock
  -- своя цена вида в этом филиале; пусто — базовая цена с надбавкой филиала
  add column price numeric(14, 2) check (price >= 0),
  -- филиал этот вид продаёт; false — «сюда не возим»
  add column listed boolean not null default true;

-- Цена вида для магазина, которого обслуживает филиал.
create function app.variant_price(p_variant uuid, p_branch uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.price from company_stock s where s.variant_id = v.id and s.branch_id = p_branch),
    round(v.price * (1 + coalesce((select b.markup_pct from company_branches b where b.id = p_branch), 0) / 100), 2))
  from company_variants v where v.id = p_variant
$$;

create function app.variant_listed(p_variant uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.listed from company_stock s where s.variant_id = p_variant and s.branch_id = p_branch), true)
$$;

-- Своя цена вида в филиале. p_price = null возвращает базовую цену с надбавкой филиала.
create function public.set_branch_price(p_variant uuid, p_branch uuid, p_price numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from company_variants where id = p_variant;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if not exists (select 1 from company_branches where id = p_branch and org_id = v_org) then
    raise exception 'Филиал не найден';
  end if;
  if p_price < 0 then
    raise exception 'Цена не может быть отрицательной';
  end if;
  insert into company_stock (branch_id, variant_id, org_id, price) values (p_branch, p_variant, v_org, p_price)
  on conflict (branch_id, variant_id) do update set price = excluded.price;
end $$;

-- Продаёт ли филиал этот вид. Снятый вид магазины этого филиала не видят и заказать не могут.
create function public.set_branch_listed(p_variant uuid, p_branch uuid, p_listed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from company_variants where id = p_variant;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if not exists (select 1 from company_branches where id = p_branch and org_id = v_org) then
    raise exception 'Филиал не найден';
  end if;
  insert into company_stock (branch_id, variant_id, org_id, listed) values (p_branch, p_variant, v_org, coalesce(p_listed, true))
  on conflict (branch_id, variant_id) do update set listed = excluded.listed;
end $$;

-- ───────────────────────── Зона обслуживания филиала ─────────────────────────

-- Филиал возит не только в свой город: зона — это области целиком и отдельные города.
create table public.company_branch_zones (
  id bigint generated always as identity primary key,
  branch_id uuid not null,
  org_id uuid not null references public.orgs on delete cascade,
  region_id smallint references public.regions,
  city_id smallint references public.cities,
  foreign key (branch_id, org_id) references public.company_branches (id, org_id) on delete cascade,
  check (num_nonnulls(region_id, city_id) = 1)
);
create unique index company_branch_zones_region_uq on public.company_branch_zones (branch_id, region_id) where region_id is not null;
create unique index company_branch_zones_city_uq on public.company_branch_zones (branch_id, city_id) where city_id is not null;
create index company_branch_zones_org_idx on public.company_branch_zones (org_id);

-- Зоны видны всем вошедшим, как и сами филиалы: это часть витрины. Меняет их только set_branch_zones.
alter table public.company_branch_zones enable row level security;
create policy zone_read on public.company_branch_zones for select to authenticated using (true);
grant select on public.company_branch_zones to authenticated;

-- Зона филиала целиком: прежняя заменяется переданной.
create function public.set_branch_zones(p_branch uuid, p_regions smallint[], p_cities smallint[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from company_branches where id = p_branch;
  if v_org is null or not app.is_owner(v_org) then
    raise exception 'Нет доступа';
  end if;
  delete from company_branch_zones where branch_id = p_branch;
  insert into company_branch_zones (branch_id, org_id, region_id)
  select p_branch, v_org, r.id from regions r where r.id = any (coalesce(p_regions, '{}'));
  insert into company_branch_zones (branch_id, org_id, city_id)
  select p_branch, v_org, c.id from cities c
  where c.id = any (coalesce(p_cities, '{}'))
    -- город внутри уже выбранной области отдельно не нужен
    and not (c.region_id = any (coalesce(p_regions, '{}')));
end $$;

-- Филиал, который обслуживает город магазина. По убыванию точности: филиал в самом городе,
-- филиал, в зону которого город входит поимённо, филиал, в зону которого входит область города, и только потом главный.
create or replace function app.serving_branch(p_company uuid, p_city smallint) returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from company_branches b
  where b.org_id = p_company
  order by (b.city_id = p_city) desc nulls last,
           exists (select 1 from company_branch_zones z where z.branch_id = b.id and z.city_id = p_city) desc,
           exists (select 1 from company_branch_zones z join cities c on c.region_id = z.region_id
                   where z.branch_id = b.id and c.id = p_city) desc,
           b.is_main desc, b.created_at
  limit 1
$$;

-- ───────────────────────── Витрина и заказ: цена и ассортимент филиала ─────────────────────────

-- Предложения компаний глазами магазина: цена, упаковка и свободный остаток в филиале, который обслуживает город магазина.
-- Цена и минимальный заказ — этого филиала; виды, которые филиал не продаёт, не показываются.
create or replace function public.store_offers(
  p_store uuid, p_company uuid default null, p_barcodes text[] default null, p_variants uuid[] default null
) returns table (
  variant_id uuid, company_id uuid, company_name text, min_order numeric,
  product_id uuid, product_name text, label text, category text, description text, image_url text,
  barcode text, unit text, price numeric, pack_qty numeric,
  free numeric, branch_id uuid, branch_name text, local boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_city smallint;
begin
  select s.org_id, s.city_id into v_org, v_city from stores s where s.id = p_store;
  if v_org is null or not app.is_member(v_org) then
    raise exception 'Нет доступа';
  end if;
  if p_company is null and p_barcodes is null and p_variants is null then
    return;
  end if;
  return query
    select v.id, o.id, o.name, coalesce(b.min_order, c.min_order), p.id, p.name, v.label, p.category, p.description,
           coalesce(nullif(v.image_url, ''), p.image_url), v.barcode, v.unit, app.variant_price(v.id, b.id), v.pack_qty,
           app.variant_free(v.id, b.id), b.id, coalesce(b.name, ''), coalesce(b.city_id = v_city, false)
    from company_variants v
    join company_products p on p.id = v.product_id and not p.archived
    join orgs o on o.id = v.org_id and o.kind = 'company'
    join companies c on c.org_id = o.id
    left join company_branches b on b.id = app.serving_branch(o.id, v_city)
    where v.active and not v.archived
      and app.variant_listed(v.id, b.id)
      and (p_company is null or v.org_id = p_company)
      and (p_barcodes is null or v.barcode = any (p_barcodes))
      and (p_variants is null or v.id = any (p_variants))
    order by p.category, p.name, v.sort, v.price;
end $$;

-- p_items: [{variant_id, qty}] — виды товаров из каталога компании.
-- Цена фиксируется по филиалу, который обслуживает магазин; минимальная сумма — тоже его.
create or replace function public.place_order(p_store uuid, p_supplier uuid, p_items jsonb, p_comment text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_store stores%rowtype;
  v_company orgs%rowtype;
  v_min numeric;
  v_branch company_branches%rowtype;
  v_order uuid;
  v_item record;
  v_var record;
  v_price numeric;
  v_free numeric;
  v_total numeric := 0;
begin
  select * into v_store from stores where id = p_store;
  if not found or not app.is_manager(v_store.org_id) then
    raise exception 'Нет доступа';
  end if;
  select * into v_company from orgs where id = p_supplier and kind = 'company';
  if not found then
    raise exception 'Компания не найдена';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Корзина пуста';
  end if;
  select * into v_branch from company_branches where id = app.serving_branch(v_company.id, v_store.city_id);
  select coalesce(v_branch.min_order, c.min_order) into v_min from companies c where c.org_id = v_company.id;

  insert into orders (number, supplier_org, store_org, store_id, supplier_name, store_org_name, store_name, store_address,
                      store_city_id, store_city, store_phone, branch_id, branch_name, comment, created_by)
  values (app.next_number(v_company.id, 'order'), v_company.id, v_store.org_id, v_store.id, v_company.name,
          (select name from orgs where id = v_store.org_id), v_store.name, v_store.address,
          v_store.city_id, coalesce((select name from cities where id = v_store.city_id), ''),
          coalesce(nullif(v_store.phone, ''), (select phone from orgs where id = v_store.org_id), ''),
          v_branch.id, coalesce(v_branch.name, ''), coalesce(p_comment, ''), auth.uid())
  returning id into v_order;

  for v_item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric) loop
    select v.id, v.barcode, v.unit, v.track_stock, trim(p.name || ' ' || v.label) as name
    into v_var
    from company_variants v
    join company_products p on p.id = v.product_id
    where v.id = v_item.variant_id and v.org_id = v_company.id and v.active and not v.archived and not p.archived;
    if not found or not app.variant_listed(v_item.variant_id, v_branch.id) then
      raise exception 'Товара больше нет в каталоге компании';
    end if;
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'Количество должно быть больше нуля: %', v_var.name;
    end if;
    if v_var.track_stock then
      v_free := app.variant_free(v_var.id, v_branch.id);
      if v_free <= 0 then
        raise exception 'Товара нет в наличии: %', v_var.name;
      end if;
      if v_item.qty > v_free then
        raise exception 'Недостаточно на складе: % (доступно %)', v_var.name, trim_scale(v_free);
      end if;
    end if;
    v_price := app.variant_price(v_var.id, v_branch.id);
    insert into order_items (order_id, supplier_org, store_org, variant_id, name, barcode, unit, qty, price)
    values (v_order, v_company.id, v_store.org_id, v_var.id, v_var.name, v_var.barcode, v_var.unit, v_item.qty, v_price);
    v_total := v_total + round(v_item.qty * v_price, 2);
  end loop;

  if v_total < coalesce(v_min, 0) then
    raise exception 'Минимальная сумма заказа у компании — %', trim_scale(v_min);
  end if;
  update orders set total = v_total where id = v_order;
  return v_order;
end $$;

-- ───────────────────────── API для учётной системы: цена по складу ─────────────────────────

-- Каталог компании, как он лежит в Sauda. prices — свои цены филиалов (филиал → цена), если они заданы.
create or replace function public.api_catalog() returns jsonb
language sql security definer set search_path = public as $$
  with me as (select app.api_org() as org)
  select coalesce(jsonb_agg(jsonb_build_object(
    'barcode', v.barcode, 'name', p.name, 'label', v.label, 'unit', v.unit, 'category', p.category,
    'price', v.price, 'pack_qty', v.pack_qty, 'active', v.active,
    'stock', case when v.track_stock then coalesce((
      select jsonb_object_agg(s.branch_id, s.qty) from company_stock s where s.variant_id = v.id), '{}'::jsonb) end,
    'prices', coalesce((
      select jsonb_object_agg(s.branch_id, s.price) from company_stock s where s.variant_id = v.id and s.price is not null), '{}'::jsonb)
  ) order by p.name, v.sort, v.barcode), '[]'::jsonb)
  from me
  join company_variants v on v.org_id = me.org and not v.archived
  join company_products p on p.id = v.product_id and not p.archived
$$;

-- Остатки и цены из учётной системы. Товар ищется по штрихкоду.
-- items: [{barcode, price, stock, active, name, label, unit, category, pack_qty}] — обязателен только barcode.
--   price, stock, active — что передано, то и меняется; чего нет в строке, остаётся как было;
--   name — нужен только для товара, которого ещё нет в каталоге: с ним он будет создан, без него попадёт в not_found.
-- branch — склад (id из api_branches). Без него остатки ставятся на главный филиал, а price — это базовая цена компании.
--   С ним и остаток, и price относятся к этому складу: price становится его собственной ценой.
-- Ответ: {updated, created, not_found: [штрихкоды], errors: [{barcode, error}]}.
create or replace function public.api_stock(items jsonb, branch uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.api_org();
  v_branch uuid;
  v_row record;
  v_var company_variants%rowtype;
  v_product uuid;
  v_barcode text;
  v_name text;
  v_updated int := 0;
  v_created int := 0;
  v_missing text[] := '{}';
  v_errors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(api_stock.items) is distinct from 'array' then
    raise exception 'items — это массив строк с товарами';
  end if;
  if jsonb_array_length(api_stock.items) > 5000 then
    raise exception 'Не больше 5000 строк за один запрос';
  end if;
  select b.id into v_branch from company_branches b
  where b.org_id = v_org and (b.id = api_stock.branch or (api_stock.branch is null and b.is_main));
  if v_branch is null then
    raise exception 'Филиал не найден';
  end if;

  for v_row in
    select * from jsonb_to_recordset(api_stock.items)
      as x(barcode text, price numeric, stock numeric, active boolean, name text, label text, unit text,
           category text, pack_qty numeric)
  loop
    v_barcode := trim(coalesce(v_row.barcode, ''));
    continue when v_barcode = '';
    if v_row.price < 0 or v_row.stock < 0 then
      v_errors := v_errors || jsonb_build_object('barcode', v_barcode, 'error', 'Цена и остаток не могут быть отрицательными');
      continue;
    end if;

    select * into v_var from company_variants v where v.org_id = v_org and v.barcode = v_barcode and not v.archived;
    if not found then
      v_name := trim(coalesce(v_row.name, ''));
      if v_name = '' then
        v_missing := v_missing || v_barcode;
        continue;
      end if;
      select p.id into v_product from company_products p
      where p.org_id = v_org and not p.archived and lower(p.name) = lower(v_name)
      order by p.created_at limit 1;
      if v_product is null then
        insert into company_products (org_id, name, category)
        values (v_org, v_name, coalesce(trim(v_row.category), ''))
        returning id into v_product;
      end if;
      -- у нового товара цена из запроса становится базовой, даже если указан склад: другой цены у него ещё нет
      insert into company_variants (org_id, product_id, label, barcode, unit, price, pack_qty, active)
      values (v_org, v_product, coalesce(trim(v_row.label), ''), v_barcode,
              case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else 'шт' end,
              coalesce(v_row.price, 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
              coalesce(v_row.active, true))
      returning * into v_var;
      v_created := v_created + 1;
    else
      update company_variants v
      set price = case when api_stock.branch is null then coalesce(v_row.price, v.price) else v.price end,
          active = coalesce(v_row.active, v.active)
      where v.id = v_var.id;
      if api_stock.branch is not null and v_row.price is not null then
        insert into company_stock (branch_id, variant_id, org_id, price) values (v_branch, v_var.id, v_org, v_row.price)
        on conflict (branch_id, variant_id) do update set price = excluded.price;
      end if;
      v_updated := v_updated + 1;
    end if;

    if v_row.stock is not null then
      -- первая же цифра остатка включает учёт
      update company_variants v set track_stock = true where v.id = v_var.id and not v.track_stock;
      perform app.set_company_stock(v_org, v_branch, v_var.id, v_row.stock, 'api', '');
    end if;
  end loop;

  return jsonb_build_object('updated', v_updated, 'created', v_created,
                            'not_found', to_jsonb(v_missing), 'errors', v_errors);
end $$;

revoke all on function app.variant_price(uuid, uuid), app.variant_listed(uuid, uuid) from public, anon;
revoke all on function public.set_branch_price(uuid, uuid, numeric), public.set_branch_listed(uuid, uuid, boolean),
  public.set_branch_zones(uuid, smallint[], smallint[]) from public, anon;
grant execute on function public.set_branch_price(uuid, uuid, numeric), public.set_branch_listed(uuid, uuid, boolean),
  public.set_branch_zones(uuid, smallint[], smallint[]) to authenticated;
