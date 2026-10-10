-- Кабинеты филиалов. Раньше любой сотрудник компании видел все её филиалы. Теперь сотрудник может быть привязан
-- к одному филиалу (org_members.branch_id): он видит и ведёт только его заказы, остатки, цены, ассортимент
-- и сотрудников. Без привязки — головной офис: видит всё и один меняет общий каталог, филиалы, доступ к ценам.
-- Филиал подключается сам: регистрируется, выбирает компанию и отправляет заявку, владелец компании её одобряет.

alter table public.org_members
  add column branch_id uuid references public.company_branches on delete cascade,
  add constraint org_members_owner_hq check (role <> 'owner' or branch_id is null);
create index org_members_branch_idx on public.org_members (branch_id) where branch_id is not null;
alter table public.invites add column branch_id uuid references public.company_branches on delete cascade;
grant update (branch_id) on public.org_members to authenticated;
grant insert (branch_id), update (branch_id) on public.invites to authenticated;

-- Филиал сотрудника и приглашения всегда из той же компании.
create function app.check_branch_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is not null
     and not exists (select 1 from company_branches b where b.id = new.branch_id and b.org_id = new.org_id) then
    raise exception 'Филиал не найден';
  end if;
  return new;
end $$;
create trigger org_members_branch_org before insert or update of branch_id, org_id on public.org_members
for each row execute function app.check_branch_org();
create trigger invites_branch_org before insert or update of branch_id, org_id on public.invites
for each row execute function app.check_branch_org();

-- Филиал текущего пользователя в компании: null — головной офис (или не сотрудник).
create function app.my_branch(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from org_members where org_id = p_org and user_id = auth.uid()
$$;

-- Сотрудник головного офиса: видит и меняет всё, что относится к компании в целом.
create function app.is_hq(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and branch_id is null)
$$;

-- Видит ли сотрудник данные филиала: головной офис — любого, сотрудник филиала — только своего.
create function app.sees_branch(p_org uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid() and (branch_id is null or branch_id = p_branch)
  )
$$;

revoke all on function app.check_branch_org() from public;
revoke all on function app.my_branch(uuid) from public;
revoke all on function app.is_hq(uuid) from public;
revoke all on function app.sees_branch(uuid, uuid) from public;
grant execute on function app.my_branch(uuid) to authenticated;
grant execute on function app.is_hq(uuid) to authenticated;
grant execute on function app.sees_branch(uuid, uuid) to authenticated;

-- ── Заказы: компания видит заказы своего филиала ─────────────────────────────────────────────────────────────
drop policy party_read on public.orders;
create policy party_read on public.orders for select to authenticated using (
  store_org in (select app.my_orgs())
  or (supplier_org in (select app.my_orgs()) and app.sees_branch(supplier_org, branch_id))
);
drop policy party_read on public.order_items;
create policy party_read on public.order_items for select to authenticated using (
  store_org in (select app.my_orgs())
  or (supplier_org in (select app.my_orgs())
      and exists (select 1 from orders o where o.id = order_items.order_id and app.sees_branch(o.supplier_org, o.branch_id)))
);

-- ── Остатки и их история: только свой филиал ─────────────────────────────────────────────────────────────────
drop policy member_read on public.company_stock;
create policy member_read on public.company_stock for select to authenticated
  using (org_id in (select app.my_orgs()) and app.sees_branch(org_id, branch_id));
drop policy member_read on public.company_stock_moves;
create policy member_read on public.company_stock_moves for select to authenticated
  using (org_id in (select app.my_orgs()) and app.sees_branch(org_id, branch_id));

-- ── Общий каталог меняет только головной офис ────────────────────────────────────────────────────────────────
drop policy manager_insert on public.company_products;
create policy manager_insert on public.company_products for insert to authenticated
  with check (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));
drop policy manager_update on public.company_products;
create policy manager_update on public.company_products for update to authenticated
  using (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));
drop policy manager_insert on public.company_variants;
create policy manager_insert on public.company_variants for insert to authenticated
  with check (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));
drop policy manager_update on public.company_variants;
create policy manager_update on public.company_variants for update to authenticated
  using (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));
drop policy manager_insert on public.company_variant_limits;
create policy manager_insert on public.company_variant_limits for insert to authenticated
  with check (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));
drop policy manager_update on public.company_variant_limits;
create policy manager_update on public.company_variant_limits for update to authenticated
  using (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));
drop policy manager_delete on public.company_variant_limits;
create policy manager_delete on public.company_variant_limits for delete to authenticated
  using (org_id in (select app.my_managed_orgs()) and app.is_hq(org_id));

-- ── Карточка филиала: владелец компании или руководитель самого филиала (is_main и город меняет только владелец) ──
drop policy owner_update on public.company_branches;
create policy owner_update on public.company_branches for update to authenticated
  using (app.is_owner(org_id) or (app.is_manager(org_id) and app.my_branch(org_id) = id));
create function app.branch_keeps_city() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.city_id is distinct from old.city_id and not app.is_owner(new.org_id) then
    raise exception 'Город филиала меняет владелец компании: от него зависит, каким магазинам филиал привозит заказы';
  end if;
  return new;
end $$;
create trigger company_branches_city before update of city_id on public.company_branches
for each row execute function app.branch_keeps_city();
revoke all on function app.branch_keeps_city() from public;

-- ── Сотрудники: филиал видит и ведёт только своих ────────────────────────────────────────────────────────────
drop policy member_read on public.org_members;
create policy member_read on public.org_members for select to authenticated
  using (org_id in (select app.my_orgs()) and (user_id = auth.uid() or app.sees_branch(org_id, branch_id)));
create policy branch_manager_update on public.org_members for update to authenticated
  using (app.is_manager(org_id) and branch_id is not null and branch_id = app.my_branch(org_id)
         and user_id <> auth.uid() and role <> 'owner')
  with check (branch_id = app.my_branch(org_id) and role in ('manager', 'cashier'));
create policy branch_manager_delete on public.org_members for delete to authenticated
  using (app.is_manager(org_id) and branch_id is not null and branch_id = app.my_branch(org_id)
         and user_id <> auth.uid() and role <> 'owner');
create policy branch_manager_all on public.invites for all to authenticated
  using (app.is_manager(org_id) and branch_id is not null and branch_id = app.my_branch(org_id))
  with check (app.is_manager(org_id) and branch_id is not null and branch_id = app.my_branch(org_id) and role <> 'owner');

-- ── Заявки филиалов ──────────────────────────────────────────────────────────────────────────────────────────
create table public.branch_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  -- существующий филиал, к которому просят доступ; null — новый филиал по данным ниже
  branch_id uuid references public.company_branches on delete set null,
  name text not null default '',
  city_id smallint references public.cities,
  address text not null default '',
  phone text not null default '',
  comment text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz
);
create unique index branch_requests_pending_uq on public.branch_requests (org_id, user_id) where status = 'pending';
create index branch_requests_user_idx on public.branch_requests (user_id);
alter table public.branch_requests enable row level security;
create policy request_read on public.branch_requests for select to authenticated
  using (user_id = auth.uid() or app.is_hq(org_id));
revoke all on public.branch_requests from anon, authenticated;
grant select on public.branch_requests to authenticated;

-- Заявка: «я работаю в филиале этой компании». Либо существующий филиал, либо данные нового.
create function public.request_branch(
  p_company uuid, p_branch uuid default null, p_name text default '', p_city smallint default null,
  p_address text default '', p_phone text default '', p_comment text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or app.is_anonymous() then
    raise exception 'Сначала зарегистрируйтесь';
  end if;
  if not exists (select 1 from orgs where id = p_company and kind = 'company') then
    raise exception 'Компания не найдена';
  end if;
  if exists (select 1 from org_members where org_id = p_company and user_id = auth.uid()) then
    raise exception 'Вы уже сотрудник этой компании';
  end if;
  if p_branch is not null then
    if not exists (select 1 from company_branches where id = p_branch and org_id = p_company) then
      raise exception 'Филиал не найден';
    end if;
  elsif coalesce(trim(p_name), '') = '' or p_city is null or not exists (select 1 from cities where id = p_city) then
    raise exception 'Укажите название и город филиала';
  end if;

  update branch_requests
  set branch_id = p_branch, name = trim(coalesce(p_name, '')), city_id = p_city, address = trim(coalesce(p_address, '')),
      phone = trim(coalesce(p_phone, '')), comment = trim(coalesce(p_comment, '')), created_at = now()
  where org_id = p_company and user_id = auth.uid() and status = 'pending'
  returning id into v_id;
  if v_id is null then
    insert into branch_requests (org_id, user_id, branch_id, name, city_id, address, phone, comment)
    values (p_company, auth.uid(), p_branch, trim(coalesce(p_name, '')), p_city, trim(coalesce(p_address, '')),
            trim(coalesce(p_phone, '')), trim(coalesce(p_comment, '')))
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Заявитель отзывает свою заявку.
create function public.cancel_branch_request(p_request uuid) returns void
language sql security definer set search_path = public as $$
  delete from branch_requests where id = p_request and user_id = auth.uid() and status = 'pending'
$$;

-- Владелец компании решает по заявке. Одобрение: заявитель становится руководителем филиала —
-- выбранного владельцем (p_branch), указанного в заявке или нового, созданного по её данным.
create function public.decide_branch_request(p_request uuid, p_approve boolean, p_branch uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r branch_requests%rowtype;
  v_branch uuid;
begin
  select * into r from branch_requests where id = p_request for update;
  if not found or not app.is_owner(r.org_id) then
    raise exception 'Нет доступа';
  end if;
  if r.status <> 'pending' then
    raise exception 'По этой заявке уже принято решение';
  end if;
  if not coalesce(p_approve, false) then
    update branch_requests set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = r.id;
    return;
  end if;

  v_branch := coalesce(p_branch, r.branch_id);
  if v_branch is not null then
    if not exists (select 1 from company_branches where id = v_branch and org_id = r.org_id) then
      raise exception 'Филиал не найден';
    end if;
  else
    insert into company_branches (org_id, city_id, name, address, phone, manager_name)
    values (r.org_id, r.city_id, r.name, r.address, r.phone,
            coalesce((select full_name from profiles where id = r.user_id), ''))
    returning id into v_branch;
  end if;
  insert into org_members (org_id, user_id, role, branch_id) values (r.org_id, r.user_id, 'manager', v_branch)
  on conflict (org_id, user_id) do update set role = 'manager', branch_id = excluded.branch_id
  where org_members.role <> 'owner';
  update branch_requests set status = 'approved', branch_id = v_branch, decided_by = auth.uid(), decided_at = now()
  where id = r.id;
end $$;

-- Заявки для головного офиса: кто просит, какой филиал, откуда.
create function public.branch_requests_list(p_company uuid) returns table (
  id uuid, user_name text, user_email text, branch_id uuid, branch_name text, name text, city text,
  address text, phone text, comment text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_hq(p_company) then
    raise exception 'Нет доступа';
  end if;
  return query
    select r.id, coalesce(p.full_name, ''), coalesce(p.email, ''), r.branch_id, coalesce(b.name, ''), r.name,
           coalesce(c.name, ''), r.address, r.phone, r.comment, r.status, r.created_at
    from branch_requests r
    left join profiles p on p.id = r.user_id
    left join company_branches b on b.id = r.branch_id
    left join cities c on c.id = coalesce(b.city_id, r.city_id)
    where r.org_id = p_company
    order by r.status = 'pending' desc, r.created_at desc;
end $$;

revoke all on function public.request_branch(uuid, uuid, text, smallint, text, text, text) from public, anon;
grant execute on function public.request_branch(uuid, uuid, text, smallint, text, text, text) to authenticated;
revoke all on function public.cancel_branch_request(uuid) from public, anon;
grant execute on function public.cancel_branch_request(uuid) to authenticated;
revoke all on function public.decide_branch_request(uuid, boolean, uuid) from public, anon;
grant execute on function public.decide_branch_request(uuid, boolean, uuid) to authenticated;
revoke all on function public.branch_requests_list(uuid) from public, anon;
grant execute on function public.branch_requests_list(uuid) to authenticated;

-- ── Функции с прежней проверкой «сотрудник компании» ─────────────────────────────────────────────────────────
create or replace function public.archive_company_product(p_product uuid, p_archived boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  select org_id into v_org from company_products where id = p_product;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if not app.is_hq(v_org) then
    raise exception 'Общий каталог компании меняет головной офис';
  end if;
  update company_products set archived = p_archived where id = p_product;
  update company_variants set archived = p_archived where product_id = p_product;
end $function$;

create or replace function public.save_company_product(p_org uuid, p_product jsonb, p_variants jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_name text := trim(coalesce(p_product ->> 'name', ''));
  v_image text := trim(coalesce(p_product ->> 'image_url', ''));
  v_row record;
  v_var uuid;
  v_keep uuid[] := '{}';
  v_stock record;
  v_title text;
begin
  if not app.is_manager(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;
  if not app.is_hq(p_org) then
    raise exception 'Общий каталог компании меняет головной офис';
  end if;
  if v_name = '' then
    raise exception 'Укажите название товара';
  end if;
  -- https или фото из своего хранилища (на локальном стенде оно работает по http): точнее проверяет ограничение таблицы
  if v_image <> '' and v_image !~* '^https?://' then
    raise exception 'Ссылка на фото должна начинаться с https://';
  end if;
  if jsonb_array_length(coalesce(p_variants, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы один вид товара';
  end if;

  if v_id is null then
    insert into company_products (org_id, name, category, description, image_url)
    values (p_org, v_name, trim(coalesce(p_product ->> 'category', '')), trim(coalesce(p_product ->> 'description', '')), v_image)
    returning id into v_id;
  else
    update company_products
    set name = v_name, category = trim(coalesce(p_product ->> 'category', '')),
        description = trim(coalesce(p_product ->> 'description', '')), image_url = v_image, archived = false
    where id = v_id and org_id = p_org;
    if not found then
      raise exception 'Товар не найден';
    end if;
  end if;

  for v_row in
    select x.*, n.ord
    from jsonb_array_elements(p_variants) with ordinality as n(item, ord),
         jsonb_to_record(n.item) as x(id uuid, label text, barcode text, unit text, price numeric, pack_qty numeric,
                                      image_url text, active boolean, track_stock boolean, min_stock numeric, stock jsonb)
    order by n.ord
  loop
    v_title := trim(v_name || ' ' || coalesce(trim(v_row.label), ''));
    if coalesce(trim(v_row.barcode), '') = '' then
      raise exception 'Укажите штрихкод: %', v_title;
    end if;
    if coalesce(v_row.price, 0) < 0 then
      raise exception 'Цена не может быть отрицательной: %', v_title;
    end if;
    if coalesce(trim(v_row.image_url), '') <> '' and trim(v_row.image_url) !~* '^https://' then
      raise exception 'Ссылка на фото должна начинаться с https://';
    end if;

    if v_row.id is null then
      insert into company_variants (org_id, product_id, label, barcode, unit, price, pack_qty, image_url, active,
                                    track_stock, sort)
      values (p_org, v_id, coalesce(trim(v_row.label), ''), trim(v_row.barcode),
              case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else 'шт' end,
              coalesce(v_row.price, 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
              coalesce(trim(v_row.image_url), ''), coalesce(v_row.active, true), coalesce(v_row.track_stock, false),
              v_row.ord)
      returning id into v_var;
    else
      update company_variants
      set label = coalesce(trim(v_row.label), ''), barcode = trim(v_row.barcode),
          unit = case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else unit end,
          price = coalesce(v_row.price, 0), pack_qty = case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
          image_url = coalesce(trim(v_row.image_url), ''), active = coalesce(v_row.active, true),
          track_stock = coalesce(v_row.track_stock, false), sort = v_row.ord,
          archived = false
      where id = v_row.id and product_id = v_id
      returning id into v_var;
      if v_var is null then
        raise exception 'Вид товара не найден: %', v_title;
      end if;
    end if;
    v_keep := v_keep || v_var;

    if v_row.min_stock is null then
      delete from company_variant_limits where variant_id = v_var;
    else
      insert into company_variant_limits (variant_id, org_id, min_stock) values (v_var, p_org, greatest(v_row.min_stock, 0))
      on conflict (variant_id) do update set min_stock = excluded.min_stock;
    end if;

    if coalesce(v_row.track_stock, false) and v_row.stock is not null then
      for v_stock in select key::uuid as branch, value::numeric as qty from jsonb_each_text(v_row.stock) loop
        if not exists (select 1 from company_branches where id = v_stock.branch and org_id = p_org) then
          raise exception 'Филиал не найден';
        end if;
        perform app.set_company_stock(p_org, v_stock.branch, v_var, v_stock.qty, 'adjust', '');
      end loop;
    end if;
  end loop;

  update company_variants set archived = true where product_id = v_id and not archived and id <> all (v_keep);
  return v_id;
end $function$;

create or replace function public.import_company_products(p_org uuid, p_rows jsonb, p_branch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_product uuid;
  v_var uuid;
  v_unit text;
  v_image text;
  v_name text;
  v_branch uuid;
  v_created int := 0;
  v_updated int := 0;
  v_products int := 0;
begin
  if not app.is_manager(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;
  if not app.is_hq(p_org) then
    raise exception 'Общий каталог компании меняет головной офис';
  end if;
  select id into v_branch from company_branches
  where org_id = p_org and (id = p_branch or (p_branch is null and is_main));
  if v_branch is null then
    raise exception 'Филиал не найден';
  end if;

  for v_row in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as x(product text, label text, barcode text, unit text, price numeric, category text, pack_qty numeric,
           image_url text, stock numeric)
  loop
    v_name := trim(coalesce(v_row.product, ''));
    continue when v_name = '' or coalesce(trim(v_row.barcode), '') = '';
    v_unit := case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit end;
    -- только ссылки https: адрес попадает в <img> на страницах магазинов
    v_image := case when trim(v_row.image_url) ~* '^https://' then trim(v_row.image_url) end;

    select id into v_product from company_products
    where org_id = p_org and not archived and lower(name) = lower(v_name)
    order by created_at limit 1;
    if v_product is null then
      insert into company_products (org_id, name, category, image_url)
      values (p_org, v_name, coalesce(trim(v_row.category), ''), coalesce(v_image, ''))
      returning id into v_product;
      v_products := v_products + 1;
    else
      update company_products
      set category = coalesce(nullif(trim(v_row.category), ''), category),
          image_url = case when image_url = '' then coalesce(v_image, '') else image_url end
      where id = v_product;
    end if;

    select id into v_var from company_variants
    where org_id = p_org and barcode = trim(v_row.barcode) and not archived;
    if v_var is null then
      insert into company_variants (org_id, product_id, label, barcode, unit, price, pack_qty, image_url)
      values (p_org, v_product, coalesce(trim(v_row.label), ''), trim(v_row.barcode), coalesce(v_unit, 'шт'),
              greatest(coalesce(v_row.price, 0), 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
              coalesce(v_image, ''))
      returning id into v_var;
      v_created := v_created + 1;
    else
      update company_variants
      set product_id = v_product, label = coalesce(trim(v_row.label), ''),
          unit = coalesce(v_unit, unit),
          -- greatest() пропускает null: без проверки файл без столбца цены обнулил бы цену
          price = case when v_row.price is null then price else greatest(v_row.price, 0) end,
          pack_qty = case when v_row.pack_qty > 0 then v_row.pack_qty else pack_qty end,
          image_url = coalesce(v_image, image_url)
      where id = v_var;
      v_updated := v_updated + 1;
    end if;

    if v_row.stock is not null then
      update company_variants set track_stock = true where id = v_var and not track_stock;
      perform app.set_company_stock(p_org, v_branch, v_var, greatest(v_row.stock, 0), 'import', '');
    end if;
  end loop;

  -- товар, все виды которого переехали в другой товар, в каталоге больше не нужен
  update company_products p set archived = true
  where p.org_id = p_org and not p.archived
    and not exists (select 1 from company_variants v where v.product_id = p.id and not v.archived);
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'products', v_products);
end $function$;

create or replace function public.decide_price_access(p_company uuid, p_store_org uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not app.is_manager(p_company) then
    raise exception 'Нет доступа';
  end if;
  if not app.is_hq(p_company) then
    raise exception 'Доступ к ценам открывает головной офис';
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
end $function$;

create or replace function public.price_access_list(p_company uuid)
 RETURNS TABLE(store_org uuid, store_name text, city text, phone text, status text, requested_at timestamp with time zone, decided_at timestamp with time zone, orders bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not app.is_member(p_company) then
    raise exception 'Нет доступа';
  end if;
  if not app.is_hq(p_company) then
    raise exception 'Доступ к ценам открывает головной офис';
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
end $function$;

create or replace function public.set_branch_listed(p_variant uuid, p_branch uuid, p_listed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  select org_id into v_org from company_variants where id = p_variant;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if not app.sees_branch(v_org, p_branch) then
    raise exception 'Это чужой филиал';
  end if;
  if not exists (select 1 from company_branches where id = p_branch and org_id = v_org) then
    raise exception 'Филиал не найден';
  end if;
  insert into company_stock (branch_id, variant_id, org_id, listed) values (p_branch, p_variant, v_org, coalesce(p_listed, true))
  on conflict (branch_id, variant_id) do update set listed = excluded.listed;
end $function$;

create or replace function public.set_branch_price(p_variant uuid, p_branch uuid, p_price numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
begin
  select org_id into v_org from company_variants where id = p_variant;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if not app.sees_branch(v_org, p_branch) then
    raise exception 'Это чужой филиал';
  end if;
  if not exists (select 1 from company_branches where id = p_branch and org_id = v_org) then
    raise exception 'Филиал не найден';
  end if;
  if p_price < 0 then
    raise exception 'Цена не может быть отрицательной';
  end if;
  insert into company_stock (branch_id, variant_id, org_id, price) values (p_branch, p_variant, v_org, p_price)
  on conflict (branch_id, variant_id) do update set price = excluded.price;
end $function$;

create or replace function public.set_company_stock(p_variant uuid, p_branch uuid, p_qty numeric, p_comment text DEFAULT ''::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v company_variants%rowtype;
begin
  select * into v from company_variants where id = p_variant;
  if not found or not app.is_manager(v.org_id) then
    raise exception 'Нет доступа';
  end if;
  if not app.sees_branch(v.org_id, p_branch) then
    raise exception 'Это чужой филиал';
  end if;
  if not exists (select 1 from company_branches where id = p_branch and org_id = v.org_id) then
    raise exception 'Филиал не найден';
  end if;
  -- первая же цифра остатка включает учёт
  update company_variants set track_stock = true where id = v.id and not track_stock;
  return app.set_company_stock(v.org_id, p_branch, v.id, p_qty, 'adjust', p_comment);
end $function$;

create or replace function public.import_company_stock(p_org uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_var company_variants%rowtype;
  v_before numeric;
  v_updated int := 0;
  v_same int := 0;
  v_missing text[] := '{}';
begin
  if not app.is_manager(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;

  for v_row in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(barcode text, branch_id uuid, qty numeric)
  loop
    continue when coalesce(trim(v_row.barcode), '') = '' or v_row.qty is null or v_row.qty < 0;
    if not exists (select 1 from company_branches b where b.id = v_row.branch_id and b.org_id = p_org) then
      raise exception 'Филиал не найден';
    end if;
    if not app.sees_branch(p_org, v_row.branch_id) then
      raise exception 'Это чужой филиал';
    end if;
    select * into v_var from company_variants v
    where v.org_id = p_org and v.barcode = trim(v_row.barcode) and not v.archived;
    if not found then
      if not trim(v_row.barcode) = any (v_missing) then
        v_missing := v_missing || trim(v_row.barcode);
      end if;
      continue;
    end if;

    select s.qty into v_before from company_stock s where s.branch_id = v_row.branch_id and s.variant_id = v_var.id;
    if v_var.track_stock and coalesce(v_before, 0) = v_row.qty then
      v_same := v_same + 1;
      continue;
    end if;
    -- первая же цифра остатка включает учёт
    update company_variants v set track_stock = true where v.id = v_var.id and not v.track_stock;
    perform app.set_company_stock(p_org, v_row.branch_id, v_var.id, v_row.qty, 'import', '');
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('updated', v_updated, 'unchanged', v_same, 'not_found', to_jsonb(v_missing));
end $function$;

create or replace function public.set_order_branch(p_order uuid, p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v orders%rowtype;
  v_branch company_branches%rowtype;
begin
  select * into v from orders where id = p_order for update;
  if not found or not app.is_member(v.supplier_org) then
    raise exception 'Нет доступа';
  end if;
  if not app.is_hq(v.supplier_org) then
    raise exception 'Передать заказ другому филиалу может головной офис';
  end if;
  if v.status not in ('new', 'confirmed') then
    raise exception 'Филиал можно сменить только до отгрузки';
  end if;
  select * into v_branch from company_branches where id = p_branch and org_id = v.supplier_org;
  if not found then
    raise exception 'Филиал не найден';
  end if;
  update orders set branch_id = v_branch.id, branch_name = v_branch.name where id = v.id;
end $function$;

create or replace function public.set_order_status(p_order uuid, p_status text, p_items jsonb DEFAULT NULL::jsonb, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v orders%rowtype;
  v_supplier boolean;
  v_item record;
  v_have numeric;
begin
  select * into v from orders where id = p_order for update;
  if not found then
    raise exception 'Заказ не найден';
  end if;
  -- сотрудник филиала ведёт только заказы своего филиала
  v_supplier := app.is_member(v.supplier_org) and app.sees_branch(v.supplier_org, v.branch_id);
  if not v_supplier and not app.is_manager(v.store_org) then
    raise exception 'Нет доступа';
  end if;

  if p_status = 'canceled' then
    if v.status not in ('new', 'confirmed') or (not v_supplier and v.status <> 'new') then
      raise exception 'Этот заказ уже нельзя отменить';
    end if;
  elsif not v_supplier then
    raise exception 'Нет доступа';
  elsif p_status = 'confirmed' then
    if v.status <> 'new' then
      raise exception 'Подтвердить можно только новый заказ';
    end if;
    for v_item in select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(item_id uuid, qty numeric) loop
      if v_item.qty is null or v_item.qty < 0 then
        raise exception 'Количество не может быть отрицательным';
      end if;
      update order_items set qty_shipped = v_item.qty where id = v_item.item_id and order_id = v.id;
    end loop;
    if not exists (select 1 from order_items where order_id = v.id and coalesce(qty_shipped, qty) > 0) then
      raise exception 'В заказе не осталось товаров — отмените его';
    end if;
  elsif p_status = 'shipped' then
    if v.status <> 'confirmed' then
      raise exception 'Отгрузить можно только подтверждённый заказ';
    end if;
    for v_item in
      select i.variant_id, i.name, coalesce(i.qty_shipped, i.qty) as qty
      from order_items i
      join company_variants cv on cv.id = i.variant_id
      where i.order_id = v.id and cv.track_stock and coalesce(i.qty_shipped, i.qty) > 0
      order by i.name
    loop
      if v.branch_id is null then
        raise exception 'Укажите филиал, с которого отгружается заказ';
      end if;
      select qty into v_have from company_stock where branch_id = v.branch_id and variant_id = v_item.variant_id for update;
      if coalesce(v_have, 0) < v_item.qty then
        raise exception 'Недостаточно на складе: % (есть %, нужно %). Исправьте остаток или передайте заказ другому филиалу',
          v_item.name, trim_scale(coalesce(v_have, 0)), trim_scale(v_item.qty);
      end if;
      perform app.move_company_stock(v.supplier_org, v.branch_id, v_item.variant_id, -v_item.qty, 'shipment', v.id, '');
    end loop;
  else
    raise exception 'Неизвестный статус';
  end if;

  update orders set
    status = p_status,
    supplier_comment = case when v_supplier and p_comment is not null then p_comment else supplier_comment end,
    total = (select coalesce(sum(round(coalesce(qty_shipped, qty) * price, 2)), 0) from order_items where order_id = v.id),
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    shipped_at = case when p_status = 'shipped' then now() else shipped_at end
  where id = v.id;
end $function$;

create or replace function public.company_geo(p_org uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not app.is_member(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;
  return jsonb_build_object(
    'sales', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select o.store_city_id as city_id, v.product_id, o.store_org,
               sum(coalesce(i.qty_shipped, i.qty)) as qty,
               sum(round(coalesce(i.qty_shipped, i.qty) * i.price, 2)) as sum,
               count(distinct o.id) as orders
        from orders o
        join order_items i on i.order_id = o.id
        join company_variants v on v.id = i.variant_id
        where o.supplier_org = p_org and o.status <> 'canceled' and app.sees_branch(p_org, o.branch_id)
          and o.created_at >= p_from and o.created_at < p_to
        group by o.store_city_id, v.product_id, o.store_org
      ) t),
    'market', (
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
        select s.city_id, count(distinct s.org_id) as stores
        from stores s join orgs g on g.id = s.org_id
        where g.kind = 'store' and s.city_id is not null
        group by s.city_id
      ) m)
  );
end $function$;

create or replace function public.accept_invites()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_count int;
begin
  select lower(email) into v_email
  from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  with moved as (
    delete from invites where lower(email) = v_email returning org_id, role, branch_id
  )
  insert into org_members (org_id, user_id, role, branch_id)
  select org_id, auth.uid(), role, branch_id from moved
  on conflict (org_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
