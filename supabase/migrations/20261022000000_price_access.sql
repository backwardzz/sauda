-- Кому видны цены компании. По умолчанию цены видят все магазины, но не другие компании
-- (раньше их видел любой вошедший, в том числе конкурент). Компания может закрыть прайс: тогда магазин видит
-- каталог без цен и остатков и отправляет запрос, а компания одобряет или отклоняет его.
-- Цены уходят наружу только через store_offers и прямое чтение company_variants; заказ без доступа не принимается.

alter table public.companies add column price_access text not null default 'stores'
  check (price_access in ('stores', 'approved'));
grant update (price_access) on public.companies to authenticated;

create table public.company_store_access (
  company_org uuid not null references public.orgs on delete cascade,
  store_org uuid not null references public.orgs on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_by uuid references auth.users on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  primary key (company_org, store_org)
);
create index company_store_access_store_idx on public.company_store_access (store_org);
alter table public.company_store_access enable row level security;
create policy access_read on public.company_store_access for select to authenticated
  using (company_org in (select app.my_orgs()) or store_org in (select app.my_orgs()));
revoke all on public.company_store_access from anon, authenticated;
grant select on public.company_store_access to authenticated;

-- Видит ли организация-магазин цены компании.
create function app.store_sees_prices(p_company uuid, p_store_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orgs where id = p_store_org and kind = 'store')
    and (
      coalesce((select price_access from companies where org_id = p_company), 'stores') = 'stores'
      or exists (select 1 from company_store_access
                 where company_org = p_company and store_org = p_store_org and status = 'approved')
    )
$$;

-- Видит ли текущий пользователь цены компании: сотрудник самой компании или магазина с доступом.
create function app.can_see_prices(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_company in (select app.my_orgs())
    or exists (select 1 from app.my_orgs() m(org_id) where app.store_sees_prices(p_company, m.org_id))
$$;

drop policy catalog_read on public.company_variants;
create policy catalog_read on public.company_variants for select to authenticated
  using ((active and not archived and app.can_see_prices(org_id)) or org_id in (select app.my_orgs()));

-- Закрыв прайс, компания не теряет нынешних покупателей: магазины, которые уже заказывали, получают доступ сразу.
create function app.companies_price_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price_access = 'approved' and old.price_access is distinct from 'approved' then
    insert into company_store_access (company_org, store_org, status, decided_by, decided_at)
    select distinct new.org_id, o.store_org, 'approved', auth.uid(), now()
    from orders o where o.supplier_org = new.org_id and o.status <> 'canceled'
    on conflict (company_org, store_org) do nothing;
  end if;
  return new;
end $$;
create trigger companies_price_access after update of price_access on public.companies
for each row execute function app.companies_price_access();

-- Магазин запрашивает прайс. Повторный запрос после отказа снова ставит его в очередь.
create function public.request_price_access(p_company uuid, p_store_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not app.is_manager(p_store_org) or not exists (select 1 from orgs where id = p_store_org and kind = 'store') then
    raise exception 'Нет доступа';
  end if;
  if not exists (select 1 from companies where org_id = p_company) then
    raise exception 'Компания не найдена';
  end if;
  insert into company_store_access (company_org, store_org, requested_by)
  values (p_company, p_store_org, auth.uid())
  on conflict (company_org, store_org) do update
  set status = 'pending', requested_by = auth.uid(), requested_at = now(), decided_by = null, decided_at = null
  where company_store_access.status = 'declined'
  returning status into v_status;
  return coalesce(v_status, (select status from company_store_access where company_org = p_company and store_org = p_store_org));
end $$;

-- Компания одобряет, отклоняет или закрывает доступ магазину.
create function public.decide_price_access(p_company uuid, p_store_org uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_manager(p_company) then
    raise exception 'Нет доступа';
  end if;
  if p_status not in ('approved', 'declined') then
    raise exception 'Неверное решение';
  end if;
  if not exists (select 1 from orgs where id = p_store_org and kind = 'store') then
    raise exception 'Магазин не найден';
  end if;
  insert into company_store_access (company_org, store_org, status, decided_by, decided_at)
  values (p_company, p_store_org, p_status, auth.uid(), now())
  on conflict (company_org, store_org) do update
  set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
end $$;

-- Состояние доступа для страницы компании в кабинете магазина.
create function public.price_access(p_company uuid, p_store_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_member(p_store_org) then
    raise exception 'Нет доступа';
  end if;
  return jsonb_build_object(
    'mode', coalesce((select price_access from companies where org_id = p_company), 'stores'),
    'status', (select status from company_store_access where company_org = p_company and store_org = p_store_org),
    'sees', app.store_sees_prices(p_company, p_store_org));
end $$;

-- Запросы и доступы для кабинета компании: магазин, его город, телефон и сколько раз заказывал.
create function public.price_access_list(p_company uuid) returns table (
  store_org uuid, store_name text, city text, phone text, status text,
  requested_at timestamptz, decided_at timestamptz, orders bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_member(p_company) then
    raise exception 'Нет доступа';
  end if;
  return query
    select a.store_org, o.name, coalesce(ci.name, ''), coalesce(nullif(s.phone, ''), o.phone, ''), a.status,
           a.requested_at, a.decided_at,
           (select count(*) from orders x where x.supplier_org = p_company and x.store_org = a.store_org)
    from company_store_access a
    join orgs o on o.id = a.store_org
    left join lateral (
      select st.city_id, st.phone from stores st where st.org_id = a.store_org order by st.created_at limit 1
    ) s on true
    left join cities ci on ci.id = s.city_id
    where a.company_org = p_company
    order by a.status = 'pending' desc, a.requested_at desc;
end $$;

revoke all on function app.store_sees_prices(uuid, uuid) from public;
revoke all on function app.can_see_prices(uuid) from public;
grant execute on function app.store_sees_prices(uuid, uuid) to authenticated;
grant execute on function app.can_see_prices(uuid) to authenticated;
revoke all on function app.companies_price_access() from public;
revoke all on function public.request_price_access(uuid, uuid) from public, anon;
grant execute on function public.request_price_access(uuid, uuid) to authenticated;
revoke all on function public.decide_price_access(uuid, uuid, text) from public, anon;
grant execute on function public.decide_price_access(uuid, uuid, text) to authenticated;
revoke all on function public.price_access(uuid, uuid) from public, anon;
grant execute on function public.price_access(uuid, uuid) to authenticated;
revoke all on function public.price_access_list(uuid) from public, anon;
grant execute on function public.price_access_list(uuid) to authenticated;

-- Цены и остатки — только магазинам с доступом.
create or replace function public.store_offers(p_store uuid, p_company uuid DEFAULT NULL::uuid, p_barcodes text[] DEFAULT NULL::text[], p_variants uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(variant_id uuid, company_id uuid, company_name text, min_order numeric, product_id uuid, product_name text, label text, category text, description text, image_url text, barcode text, unit text, price numeric, pack_qty numeric, free numeric, branch_id uuid, branch_name text, local boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           coalesce(nullif(v.image_url, ''), p.image_url), v.barcode, v.unit, -- без доступа к ценам магазин видит каталог, но не цены и не остатки
           case when app.store_sees_prices(o.id, v_org) then app.variant_price(v.id, b.id) end, v.pack_qty,
           case when app.store_sees_prices(o.id, v_org) then app.variant_free(v.id, b.id) end, b.id, coalesce(b.name, ''), coalesce(b.city_id = v_city, false)
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
    -- без доступа порядок по цене выдал бы, какой вид дешевле
    order by p.category, p.name, v.sort, case when app.store_sees_prices(o.id, v_org) then v.price end, v.label;
end $function$;

-- Заказ — только при доступе к ценам.
create or replace function public.place_order(p_store uuid, p_supplier uuid, p_items jsonb, p_comment text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not app.store_sees_prices(v_company.id, v_store.org_id) then
    raise exception 'Компания принимает заказы только от магазинов, которым открыла прайс: запросите доступ';
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
end $function$;
