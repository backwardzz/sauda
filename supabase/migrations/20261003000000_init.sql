-- Sauda: схема данных, изоляция организаций (RLS) и серверная логика склада и кассы.
-- Все таблицы несут org_id; читать может участник организации, менять справочники — владелец и менеджер.
-- Остатки, продажи и смены меняются только через функции ниже, прямой записи нет.

create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated;

create type public.member_role as enum ('owner', 'manager', 'cashier');

-- ───────────────────────── Организации и пользователи ─────────────────────────

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default '₸',
  timezone text not null default 'Asia/Almaty',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  email text not null default ''
);

create table public.org_members (
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null default 'cashier',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  email text not null,
  role public.member_role not null default 'cashier',
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.org_counters (
  org_id uuid not null references public.orgs on delete cascade,
  key text not null,
  value int not null,
  primary key (org_id, key)
);

create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Набор организаций текущего пользователя: некоррелированный подзапрос в политиках считается один раз на запрос.
create function app.my_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

create function app.my_managed_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members where user_id = auth.uid() and role in ('owner', 'manager')
$$;

create function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = auth.uid())
$$;

create function app.is_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members
                 where org_id = p_org and user_id = auth.uid() and role in ('owner', 'manager'))
$$;

create function app.is_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members
                 where org_id = p_org and user_id = auth.uid() and role = 'owner')
$$;

create function app.next_number(p_org uuid, p_key text) returns int
language sql security definer set search_path = public as $$
  insert into public.org_counters (org_id, key, value) values (p_org, p_key, 1)
  on conflict (org_id, key) do update set value = public.org_counters.value + 1
  returning value
$$;

-- ───────────────────────── Справочники ─────────────────────────

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  address text not null default '',
  created_at timestamptz not null default now()
);
create index stores_org_idx on public.stores (org_id);

create table public.registers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores on delete cascade,
  name text not null,
  active boolean not null default true,
  receipt_header text not null default '',
  receipt_footer text not null default 'Спасибо за покупку!',
  created_at timestamptz not null default now()
);
create index registers_org_idx on public.registers (org_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  parent_id uuid references public.categories on delete set null,
  name text not null,
  markup_pct numeric(8, 2) not null default 0,
  created_at timestamptz not null default now()
);
create index categories_org_idx on public.categories (org_id);

create table public.contractors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  kind text not null check (kind in ('supplier', 'customer')),
  name text not null,
  phone text not null default '',
  comment text not null default '',
  created_at timestamptz not null default now()
);
create index contractors_org_idx on public.contractors (org_id, kind);

create table public.quick_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  sort int not null default 0
);
create index quick_groups_org_idx on public.quick_groups (org_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  kind text not null default 'product' check (kind in ('product', 'service')),
  name text not null,
  unit text not null default 'шт' check (unit in ('шт', 'кг', 'л', 'м')),
  barcode text not null,
  extra_barcodes text[] not null default '{}',
  sku text not null default '',
  category_id uuid references public.categories on delete set null,
  supplier_id uuid references public.contractors on delete set null,
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(14, 2) not null default 0 check (sale_price >= 0),
  wholesale_price numeric(14, 2) not null default 0 check (wholesale_price >= 0),
  min_stock numeric(14, 3),
  quick_group_id uuid references public.quick_groups on delete set null,
  quick_name text not null default '',
  quick_sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Удаление товара — это архив: штрихкод освобождается, а история продаж остаётся.
create unique index products_barcode_uq on public.products (org_id, barcode) where not archived;
create index products_org_idx on public.products (org_id, archived);
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_extra_barcodes_idx on public.products using gin (extra_barcodes);
create index products_quick_idx on public.products (org_id, quick_group_id) where quick_group_id is not null;

create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

-- ───────────────────────── Склад ─────────────────────────

create table public.stock (
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  qty numeric(14, 3) not null default 0,
  primary key (store_id, product_id)
);
create index stock_product_idx on public.stock (product_id);

create table public.stock_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores,
  kind text not null check (kind in ('posting', 'writeoff')),
  number int not null,
  comment text not null default '',
  total numeric(14, 2) not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index stock_docs_org_idx on public.stock_docs (org_id, kind, created_at desc);

create table public.stock_doc_items (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.stock_docs on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  product_id uuid not null references public.products,
  qty numeric(14, 3) not null,
  price numeric(14, 2) not null default 0
);
create index stock_doc_items_doc_idx on public.stock_doc_items (doc_id);

create table public.stock_moves (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores on delete cascade,
  product_id uuid not null references public.products on delete cascade,
  delta numeric(14, 3) not null,
  qty_after numeric(14, 3) not null,
  reason text not null check (reason in ('posting', 'writeoff', 'sale', 'return')),
  ref_id uuid,
  ref_number int,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index stock_moves_product_idx on public.stock_moves (product_id, created_at desc);

create function app.move_stock(
  p_org uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_ref uuid, p_num int
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_after numeric;
begin
  insert into stock (org_id, store_id, product_id, qty) values (p_org, p_store, p_product, p_delta)
  on conflict (store_id, product_id) do update set qty = stock.qty + excluded.qty
  returning qty into v_after;

  insert into stock_moves (org_id, store_id, product_id, delta, qty_after, reason, ref_id, ref_number, user_id)
  values (p_org, p_store, p_product, p_delta, v_after, p_reason, p_ref, p_num, auth.uid());
  return v_after;
end $$;

-- ───────────────────────── Касса и продажи ─────────────────────────

-- Магазин, касса и смена с историей не удаляются: ссылки на них без каскада.
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores,
  register_id uuid not null references public.registers,
  cashier_id uuid references auth.users on delete set null,
  number int not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(14, 2) not null default 0,
  expected_cash numeric(14, 2),
  closing_cash numeric(14, 2)
);
create unique index shifts_one_open_uq on public.shifts (register_id) where closed_at is null;
create index shifts_org_idx on public.shifts (org_id, opened_at desc);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores,
  register_id uuid not null references public.registers,
  shift_id uuid not null references public.shifts,
  kind text not null check (kind in ('sale', 'return')),
  parent_id uuid references public.sales on delete cascade,
  number int not null,
  customer_id uuid references public.contractors on delete set null,
  cashier_id uuid references auth.users on delete set null,
  subtotal numeric(14, 2) not null default 0,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  cost numeric(14, 2) not null default 0,
  paid_cash numeric(14, 2) not null default 0,
  paid_card numeric(14, 2) not null default 0,
  comment text not null default '',
  created_at timestamptz not null default now()
);
create index sales_org_idx on public.sales (org_id, created_at desc);
create index sales_shift_idx on public.sales (shift_id);
create index sales_parent_idx on public.sales (parent_id) where parent_id is not null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  product_id uuid not null references public.products,
  parent_item_id uuid references public.sale_items on delete cascade,
  name text not null,
  barcode text not null,
  unit text not null,
  qty numeric(14, 3) not null,
  price numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  cost numeric(14, 2) not null default 0,
  category_id uuid,
  supplier_id uuid
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (org_id, product_id);
create index sale_items_parent_idx on public.sale_items (parent_item_id) where parent_item_id is not null;

create table public.cash_ops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  shift_id uuid not null references public.shifts on delete cascade,
  kind text not null check (kind in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  comment text not null default '',
  user_id uuid,
  created_at timestamptz not null default now()
);
create index cash_ops_shift_idx on public.cash_ops (shift_id);

create table public.canceled_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores on delete cascade,
  register_id uuid not null references public.registers on delete cascade,
  cashier_id uuid,
  product_id uuid references public.products on delete set null,
  name text not null,
  qty_from numeric(14, 3) not null,
  qty_to numeric(14, 3) not null,
  created_at timestamptz not null default now()
);
create index canceled_items_org_idx on public.canceled_items (org_id, created_at desc);

-- ───────────────────────── Доступ (RLS) ─────────────────────────

alter table public.orgs enable row level security;
create policy member_read on public.orgs for select to authenticated
  using (id in (select app.my_orgs()));
create policy owner_update on public.orgs for update to authenticated
  using (app.is_owner(id)) with check (app.is_owner(id));

alter table public.profiles enable row level security;
create policy read_self_and_teammates on public.profiles for select to authenticated
  using (id = auth.uid()
         or id in (select user_id from public.org_members where org_id in (select app.my_orgs())));
create policy update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table public.org_members enable row level security;
create policy member_read on public.org_members for select to authenticated
  using (org_id in (select app.my_orgs()));
create policy owner_update on public.org_members for update to authenticated
  using (app.is_owner(org_id) and user_id <> auth.uid())
  with check (app.is_owner(org_id) and user_id <> auth.uid());
create policy owner_delete on public.org_members for delete to authenticated
  using (app.is_owner(org_id) and user_id <> auth.uid());

alter table public.invites enable row level security;
create policy owner_all on public.invites for all to authenticated
  using (app.is_owner(org_id)) with check (app.is_owner(org_id));

alter table public.org_counters enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['stores', 'registers', 'categories', 'contractors', 'quick_groups', 'products'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy member_read on public.%I for select to authenticated using (org_id in (select app.my_orgs()))', t);
    execute format('create policy manager_insert on public.%I for insert to authenticated with check (org_id in (select app.my_managed_orgs()))', t);
    execute format('create policy manager_update on public.%I for update to authenticated using (org_id in (select app.my_managed_orgs())) with check (org_id in (select app.my_managed_orgs()))', t);
    execute format('create policy manager_delete on public.%I for delete to authenticated using (org_id in (select app.my_managed_orgs()))', t);
  end loop;

  foreach t in array array['stock', 'stock_docs', 'stock_doc_items', 'stock_moves', 'shifts', 'sales', 'sale_items', 'cash_ops', 'canceled_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy member_read on public.%I for select to authenticated using (org_id in (select app.my_orgs()))', t);
  end loop;
end $$;

-- Остатки по каждому магазину, включая нулевые.
create view public.product_stock with (security_invoker = true) as
select
  p.id, p.org_id, p.name, p.unit, p.barcode, p.sku, p.category_id, p.supplier_id,
  p.purchase_price, p.sale_price, p.min_stock, p.archived,
  s.id as store_id,
  coalesce(st.qty, 0) as qty,
  round(coalesce(st.qty, 0) * p.purchase_price, 2) as purchase_sum,
  round(coalesce(st.qty, 0) * p.sale_price, 2) as sale_sum,
  (p.min_stock is not null and coalesce(st.qty, 0) <= p.min_stock) as low
from public.products p
join public.stores s on s.org_id = p.org_id
left join public.stock st on st.product_id = p.id and st.store_id = s.id
where p.kind = 'product';

-- ───────────────────────── Действия ─────────────────────────

create function public.create_org(p_name text, p_store text default 'Основной магазин') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_store uuid;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Укажите название компании';
  end if;

  insert into orgs (name) values (trim(p_name)) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  insert into stores (org_id, name)
  values (v_org, coalesce(nullif(trim(p_store), ''), 'Основной магазин'))
  returning id into v_store;
  insert into registers (org_id, store_id, name) values (v_org, v_store, 'Касса 1');
  return v_org;
end $$;

-- Приглашение срабатывает только для подтверждённой почты, иначе чужой адрес дал бы доступ к магазину.
create function public.accept_invites() returns int
language plpgsql security definer set search_path = public as $$
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
    delete from invites where lower(email) = v_email returning org_id, role
  )
  insert into org_members (org_id, user_id, role)
  select org_id, auth.uid(), role from moved
  on conflict (org_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Оприходование и списание. p_items: [{product_id, qty, price}]
create function public.post_stock_doc(p_store uuid, p_kind text, p_comment text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_doc uuid;
  v_num int;
  v_total numeric := 0;
  v_item record;
  v_prod products%rowtype;
  v_price numeric;
begin
  select org_id into v_org from stores where id = p_store;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if p_kind not in ('posting', 'writeoff') then
    raise exception 'Неизвестный тип документа';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте товары в документ';
  end if;

  v_num := app.next_number(v_org, p_kind);
  insert into stock_docs (org_id, store_id, kind, number, comment, created_by)
  values (v_org, p_store, p_kind, v_num, coalesce(p_comment, ''), auth.uid())
  returning id into v_doc;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric, price numeric)
  loop
    select * into v_prod from products where id = v_item.product_id and org_id = v_org;
    if not found then
      raise exception 'Товар не найден';
    end if;
    if v_prod.kind <> 'product' then
      raise exception 'Услуги не учитываются на складе: %', v_prod.name;
    end if;
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'Количество должно быть больше нуля: %', v_prod.name;
    end if;
    v_price := coalesce(v_item.price, v_prod.purchase_price);
    if v_price < 0 then
      raise exception 'Цена не может быть отрицательной: %', v_prod.name;
    end if;

    perform app.move_stock(v_org, p_store, v_prod.id,
                           case when p_kind = 'posting' then v_item.qty else -v_item.qty end,
                           p_kind, v_doc, v_num);
    insert into stock_doc_items (doc_id, org_id, product_id, qty, price)
    values (v_doc, v_org, v_prod.id, v_item.qty, v_price);
    v_total := v_total + round(v_item.qty * v_price, 2);

    if p_kind = 'posting' and v_price <> v_prod.purchase_price then
      update products set purchase_price = v_price where id = v_prod.id;
    end if;
  end loop;

  update stock_docs set total = v_total where id = v_doc;
  return v_doc;
end $$;

-- Импорт из Excel: товар ищется по штрихкоду, остаток из файла ставится только при нулевом остатке.
-- p_rows: [{name, barcode, extra_barcodes, unit, purchase_price, sale_price, wholesale_price, category, supplier, qty}]
create function public.import_products(p_org uuid, p_store uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_cat uuid;
  v_sup uuid;
  v_id uuid;
  v_unit text;
  v_doc uuid;
  v_num int;
  v_total numeric := 0;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
begin
  if not app.is_manager(p_org) then
    raise exception 'Нет доступа';
  end if;
  if p_store is not null and not exists (select 1 from stores where id = p_store and org_id = p_org) then
    raise exception 'Магазин не найден';
  end if;

  for v_row in
    select * from jsonb_to_recordset(p_rows) as x(
      name text, barcode text, extra_barcodes text[], unit text, purchase_price numeric, sale_price numeric,
      wholesale_price numeric, category text, supplier text, qty numeric)
  loop
    if coalesce(trim(v_row.name), '') = '' or coalesce(trim(v_row.barcode), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_unit := case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else 'шт' end;

    v_cat := null;
    if coalesce(trim(v_row.category), '') <> '' then
      select id into v_cat from categories
      where org_id = p_org and lower(name) = lower(trim(v_row.category))
      order by parent_id nulls first limit 1;
      if v_cat is null then
        insert into categories (org_id, name) values (p_org, trim(v_row.category)) returning id into v_cat;
      end if;
    end if;

    v_sup := null;
    if coalesce(trim(v_row.supplier), '') <> '' then
      select id into v_sup from contractors
      where org_id = p_org and kind = 'supplier' and lower(name) = lower(trim(v_row.supplier)) limit 1;
      if v_sup is null then
        insert into contractors (org_id, kind, name) values (p_org, 'supplier', trim(v_row.supplier))
        returning id into v_sup;
      end if;
    end if;

    select id into v_id from products
    where org_id = p_org and barcode = trim(v_row.barcode) and not archived;
    if v_id is null then
      insert into products (org_id, name, unit, barcode, extra_barcodes, category_id, supplier_id,
                            purchase_price, sale_price, wholesale_price)
      values (p_org, trim(v_row.name), v_unit, trim(v_row.barcode), coalesce(v_row.extra_barcodes, '{}'),
              v_cat, v_sup,
              greatest(coalesce(v_row.purchase_price, 0), 0), greatest(coalesce(v_row.sale_price, 0), 0),
              greatest(coalesce(v_row.wholesale_price, 0), 0))
      returning id into v_id;
      v_created := v_created + 1;
    else
      update products set
        name = trim(v_row.name),
        unit = v_unit,
        extra_barcodes = coalesce(v_row.extra_barcodes, extra_barcodes),
        category_id = coalesce(v_cat, category_id),
        supplier_id = coalesce(v_sup, supplier_id),
        purchase_price = coalesce(greatest(v_row.purchase_price, 0), purchase_price),
        sale_price = coalesce(greatest(v_row.sale_price, 0), sale_price),
        wholesale_price = coalesce(greatest(v_row.wholesale_price, 0), wholesale_price)
      where id = v_id;
      v_updated := v_updated + 1;
    end if;

    if p_store is not null and coalesce(v_row.qty, 0) > 0
       and coalesce((select qty from stock where store_id = p_store and product_id = v_id), 0) = 0 then
      if v_doc is null then
        v_num := app.next_number(p_org, 'posting');
        insert into stock_docs (org_id, store_id, kind, number, comment, created_by)
        values (p_org, p_store, 'posting', v_num, 'Импорт товаров', auth.uid())
        returning id into v_doc;
      end if;
      perform app.move_stock(p_org, p_store, v_id, v_row.qty, 'posting', v_doc, v_num);
      insert into stock_doc_items (doc_id, org_id, product_id, qty, price)
      values (v_doc, p_org, v_id, v_row.qty, greatest(coalesce(v_row.purchase_price, 0), 0));
      v_total := v_total + round(v_row.qty * greatest(coalesce(v_row.purchase_price, 0), 0), 2);
    end if;
  end loop;

  if v_doc is not null then
    update stock_docs set total = total + v_total where id = v_doc;
  end if;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end $$;

create function public.open_shift(p_register uuid, p_opening_cash numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_reg registers%rowtype;
  v_id uuid;
begin
  select * into v_reg from registers where id = p_register;
  if not found or not app.is_member(v_reg.org_id) then
    raise exception 'Нет доступа';
  end if;
  if not v_reg.active then
    raise exception 'Касса отключена';
  end if;
  if coalesce(p_opening_cash, 0) < 0 then
    raise exception 'Остаток в кассе не может быть отрицательным';
  end if;
  if exists (select 1 from shifts where register_id = p_register and closed_at is null) then
    raise exception 'На этой кассе уже открыта смена';
  end if;

  insert into shifts (org_id, store_id, register_id, cashier_id, number, opening_cash)
  values (v_reg.org_id, v_reg.store_id, v_reg.id, auth.uid(),
          app.next_number(v_reg.org_id, 'shift'), coalesce(p_opening_cash, 0))
  returning id into v_id;
  return v_id;
end $$;

create function app.shift_cash(p_shift uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select s.opening_cash
    + coalesce((select sum(case when kind = 'sale' then paid_cash else -paid_cash end)
                from sales where shift_id = s.id), 0)
    + coalesce((select sum(case when kind = 'in' then amount else -amount end)
                from cash_ops where shift_id = s.id), 0)
  from shifts s where s.id = p_shift
$$;

create function public.close_shift(p_shift uuid, p_closing_cash numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_shift shifts%rowtype;
  v_expected numeric;
begin
  select * into v_shift from shifts where id = p_shift for update;
  if not found or not app.is_member(v_shift.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'Смена уже закрыта';
  end if;

  v_expected := app.shift_cash(p_shift);
  update shifts
  set closed_at = now(), expected_cash = v_expected, closing_cash = coalesce(p_closing_cash, v_expected)
  where id = p_shift;
  return v_expected;
end $$;

create function public.cash_op(p_shift uuid, p_kind text, p_amount numeric, p_comment text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shift shifts%rowtype;
  v_id uuid;
begin
  select * into v_shift from shifts where id = p_shift;
  if not found or not app.is_member(v_shift.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'Смена закрыта';
  end if;
  if p_kind not in ('in', 'out') or coalesce(p_amount, 0) <= 0 then
    raise exception 'Укажите сумму';
  end if;
  if p_kind = 'out' and p_amount > app.shift_cash(p_shift) then
    raise exception 'В кассе недостаточно наличных';
  end if;

  insert into cash_ops (org_id, shift_id, kind, amount, comment, user_id)
  values (v_shift.org_id, p_shift, p_kind, p_amount, coalesce(p_comment, ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Продажа. p_items: [{product_id, qty, price, discount}], price — розничная или оптовая цена товара,
-- discount — сумма скидки на строку. Наличными считается всё, что не оплачено картой.
create function public.create_sale(
  p_shift uuid, p_items jsonb, p_paid_card numeric default 0,
  p_customer uuid default null, p_comment text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift shifts%rowtype;
  v_sale uuid;
  v_num int;
  v_item record;
  v_prod products%rowtype;
  v_price numeric;
  v_base numeric;
  v_disc numeric;
  v_cost numeric;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_cost_total numeric := 0;
  v_total numeric;
  v_card numeric := coalesce(p_paid_card, 0);
begin
  select * into v_shift from shifts where id = p_shift;
  if not found or not app.is_member(v_shift.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'Смена закрыта';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Чек пуст';
  end if;
  if p_customer is not null and not exists (
    select 1 from contractors where id = p_customer and org_id = v_shift.org_id and kind = 'customer'
  ) then
    raise exception 'Покупатель не найден';
  end if;

  v_num := app.next_number(v_shift.org_id, 'sale');
  insert into sales (org_id, store_id, register_id, shift_id, kind, number, customer_id, cashier_id, comment)
  values (v_shift.org_id, v_shift.store_id, v_shift.register_id, v_shift.id, 'sale', v_num,
          p_customer, auth.uid(), coalesce(p_comment, ''))
  returning id into v_sale;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric, price numeric, discount numeric)
  loop
    select * into v_prod from products where id = v_item.product_id and org_id = v_shift.org_id;
    if not found then
      raise exception 'Товар не найден';
    end if;
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'Количество должно быть больше нуля: %', v_prod.name;
    end if;
    v_price := coalesce(v_item.price, v_prod.sale_price);
    if v_price <> v_prod.sale_price and v_price <> v_prod.wholesale_price then
      raise exception 'Цена товара «%» изменилась, обновите чек', v_prod.name;
    end if;
    v_base := round(v_price * v_item.qty, 2);
    v_disc := round(coalesce(v_item.discount, 0), 2);
    if v_disc < 0 or v_disc > v_base then
      raise exception 'Неверная скидка: %', v_prod.name;
    end if;
    v_cost := round(v_prod.purchase_price * v_item.qty, 2);

    insert into sale_items (sale_id, org_id, product_id, name, barcode, unit, qty, price, discount, total, cost,
                            category_id, supplier_id)
    values (v_sale, v_shift.org_id, v_prod.id, v_prod.name, v_prod.barcode, v_prod.unit, v_item.qty, v_price,
            v_disc, v_base - v_disc, v_cost, v_prod.category_id, v_prod.supplier_id);

    if v_prod.kind = 'product' then
      perform app.move_stock(v_shift.org_id, v_shift.store_id, v_prod.id, -v_item.qty, 'sale', v_sale, v_num);
    end if;

    v_subtotal := v_subtotal + v_base;
    v_discount := v_discount + v_disc;
    v_cost_total := v_cost_total + v_cost;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_card < 0 or v_card > v_total then
    raise exception 'Оплата картой не может быть больше суммы чека';
  end if;

  update sales
  set subtotal = v_subtotal, discount = v_discount, total = v_total, cost = v_cost_total,
      paid_card = v_card, paid_cash = v_total - v_card
  where id = v_sale;

  return jsonb_build_object('id', v_sale, 'number', v_num, 'total', v_total);
end $$;

-- Возврат по чеку. p_items: [{item_id, qty}] — строки исходной продажи.
create function public.create_return(
  p_shift uuid, p_sale uuid, p_items jsonb, p_refund_card numeric default 0, p_comment text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift shifts%rowtype;
  v_orig sales%rowtype;
  v_ret uuid;
  v_num int;
  v_item record;
  v_si sale_items%rowtype;
  v_returned numeric;
  v_line numeric;
  v_disc numeric;
  v_cost numeric;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_cost_total numeric := 0;
  v_total numeric;
  v_card numeric := coalesce(p_refund_card, 0);
begin
  select * into v_shift from shifts where id = p_shift;
  if not found or not app.is_member(v_shift.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'Смена закрыта';
  end if;
  -- блокировка чека не даёт двум возвратам одновременно вернуть один и тот же товар
  select * into v_orig from sales where id = p_sale and org_id = v_shift.org_id and kind = 'sale' for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Выберите товары для возврата';
  end if;

  v_num := app.next_number(v_shift.org_id, 'return');
  insert into sales (org_id, store_id, register_id, shift_id, kind, parent_id, number, customer_id, cashier_id, comment)
  values (v_shift.org_id, v_shift.store_id, v_shift.register_id, v_shift.id, 'return', v_orig.id, v_num,
          v_orig.customer_id, auth.uid(), coalesce(p_comment, ''))
  returning id into v_ret;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(item_id uuid, qty numeric)
  loop
    select * into v_si from sale_items where id = v_item.item_id and sale_id = v_orig.id;
    if not found then
      raise exception 'Строка чека не найдена';
    end if;
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'Количество должно быть больше нуля: %', v_si.name;
    end if;
    select coalesce(sum(qty), 0) into v_returned from sale_items where parent_item_id = v_si.id;
    if v_item.qty > v_si.qty - v_returned then
      raise exception 'Нельзя вернуть больше, чем продано: %', v_si.name;
    end if;

    v_disc := round(v_si.discount * v_item.qty / v_si.qty, 2);
    v_line := round(v_si.total * v_item.qty / v_si.qty, 2);
    v_cost := round(v_si.cost * v_item.qty / v_si.qty, 2);

    insert into sale_items (sale_id, org_id, product_id, parent_item_id, name, barcode, unit, qty, price, discount,
                            total, cost, category_id, supplier_id)
    values (v_ret, v_shift.org_id, v_si.product_id, v_si.id, v_si.name, v_si.barcode, v_si.unit, v_item.qty,
            v_si.price, v_disc, v_line, v_cost, v_si.category_id, v_si.supplier_id);

    if exists (select 1 from products where id = v_si.product_id and kind = 'product') then
      perform app.move_stock(v_shift.org_id, v_shift.store_id, v_si.product_id, v_item.qty, 'return', v_ret, v_num);
    end if;

    v_subtotal := v_subtotal + v_line + v_disc;
    v_discount := v_discount + v_disc;
    v_cost_total := v_cost_total + v_cost;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_card < 0 or v_card > v_total then
    raise exception 'Возврат на карту не может быть больше суммы возврата';
  end if;
  if v_total - v_card > app.shift_cash(p_shift) then
    raise exception 'В кассе недостаточно наличных для возврата';
  end if;

  update sales
  set subtotal = v_subtotal, discount = v_discount, total = v_total, cost = v_cost_total,
      paid_card = v_card, paid_cash = v_total - v_card
  where id = v_ret;

  return jsonb_build_object('id', v_ret, 'number', v_num, 'total', v_total);
end $$;

create function public.log_cancel(
  p_register uuid, p_product uuid, p_name text, p_qty_from numeric, p_qty_to numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reg registers%rowtype;
begin
  select * into v_reg from registers where id = p_register;
  if not found or not app.is_member(v_reg.org_id) then
    raise exception 'Нет доступа';
  end if;
  insert into canceled_items (org_id, store_id, register_id, cashier_id, product_id, name, qty_from, qty_to)
  values (v_reg.org_id, v_reg.store_id, v_reg.id, auth.uid(),
          (select id from products where id = p_product and org_id = v_reg.org_id),
          coalesce(p_name, ''), coalesce(p_qty_from, 0), coalesce(p_qty_to, 0));
end $$;

-- ───────────────────────── Отчёты ─────────────────────────
-- Выполняются с правами вызывающего: RLS сама ограничивает данные его организациями.

create function public.stock_totals(p_store uuid)
returns table (positions bigint, qty numeric, purchase_sum numeric, sale_sum numeric)
language sql stable set search_path = public as $$
  select count(*) filter (where ps.qty <> 0), coalesce(sum(ps.qty), 0),
         coalesce(sum(ps.purchase_sum), 0), coalesce(sum(ps.sale_sum), 0)
  from product_stock ps
  where ps.store_id = p_store and not ps.archived
$$;

-- p_group: product | category | supplier | customer | cashier | day
create function public.report_sales(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_store uuid default null, p_group text default 'product'
) returns table (
  key text, label text, barcode text, unit text,
  qty_sold numeric, qty_returned numeric, sales_sum numeric, returns_sum numeric,
  discount numeric, revenue numeric, cost numeric, profit numeric, receipts bigint
)
language sql stable set search_path = public as $$
  select
    case p_group
      when 'product' then i.product_id::text
      when 'category' then coalesce(i.category_id::text, '')
      when 'supplier' then coalesce(i.supplier_id::text, '')
      when 'customer' then coalesce(s.customer_id::text, '')
      when 'cashier' then coalesce(s.cashier_id::text, '')
      else to_char(s.created_at at time zone o.timezone, 'YYYY-MM-DD')
    end as key,
    case p_group
      when 'product' then max(i.name)
      when 'category' then coalesce(max(c.name), 'Без категории')
      when 'supplier' then coalesce(max(sup.name), 'Без поставщика')
      when 'customer' then coalesce(max(cu.name), 'Розничный покупатель')
      when 'cashier' then coalesce(nullif(max(pr.full_name), ''), max(pr.email), '—')
      else max(to_char(s.created_at at time zone o.timezone, 'YYYY-MM-DD'))
    end as label,
    case when p_group = 'product' then max(i.barcode) else '' end as barcode,
    case when p_group = 'product' then max(i.unit) else '' end as unit,
    coalesce(sum(i.qty) filter (where s.kind = 'sale'), 0) as qty_sold,
    coalesce(sum(i.qty) filter (where s.kind = 'return'), 0) as qty_returned,
    coalesce(sum(i.total) filter (where s.kind = 'sale'), 0) as sales_sum,
    coalesce(sum(i.total) filter (where s.kind = 'return'), 0) as returns_sum,
    coalesce(sum(case when s.kind = 'sale' then i.discount else -i.discount end), 0) as discount,
    coalesce(sum(case when s.kind = 'sale' then i.total else -i.total end), 0) as revenue,
    coalesce(sum(case when s.kind = 'sale' then i.cost else -i.cost end), 0) as cost,
    coalesce(sum(case when s.kind = 'sale' then i.total - i.cost else i.cost - i.total end), 0) as profit,
    count(distinct s.id) filter (where s.kind = 'sale') as receipts
  from sale_items i
  join sales s on s.id = i.sale_id
  join orgs o on o.id = s.org_id
  left join categories c on c.id = i.category_id
  left join contractors sup on sup.id = i.supplier_id
  left join contractors cu on cu.id = s.customer_id
  left join profiles pr on pr.id = s.cashier_id
  where s.org_id = p_org and s.created_at >= p_from and s.created_at < p_to
    and (p_store is null or s.store_id = p_store)
  group by 1
$$;

create function public.report_shifts(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_store uuid default null
) returns table (
  id uuid, number int, register_name text, cashier_name text, opened_at timestamptz, closed_at timestamptz,
  opening_cash numeric, sales_cash numeric, sales_card numeric, returns_cash numeric, returns_card numeric,
  cash_in numeric, cash_out numeric, expected_cash numeric, closing_cash numeric,
  cost numeric, profit numeric, receipts bigint
)
language sql stable set search_path = public as $$
  select
    sh.id, sh.number, r.name, coalesce(nullif(pr.full_name, ''), pr.email, '—'),
    sh.opened_at, sh.closed_at, sh.opening_cash,
    a.sales_cash, a.sales_card, a.returns_cash, a.returns_card, co.cash_in, co.cash_out,
    sh.opening_cash + a.sales_cash - a.returns_cash + co.cash_in - co.cash_out,
    sh.closing_cash, a.cost, a.revenue - a.cost, a.receipts
  from shifts sh
  join registers r on r.id = sh.register_id
  left join profiles pr on pr.id = sh.cashier_id
  cross join lateral (
    select
      coalesce(sum(paid_cash) filter (where kind = 'sale'), 0) as sales_cash,
      coalesce(sum(paid_card) filter (where kind = 'sale'), 0) as sales_card,
      coalesce(sum(paid_cash) filter (where kind = 'return'), 0) as returns_cash,
      coalesce(sum(paid_card) filter (where kind = 'return'), 0) as returns_card,
      coalesce(sum(case when kind = 'sale' then total else -total end), 0) as revenue,
      coalesce(sum(case when kind = 'sale' then cost else -cost end), 0) as cost,
      count(*) filter (where kind = 'sale') as receipts
    from sales where shift_id = sh.id
  ) a
  cross join lateral (
    select
      coalesce(sum(amount) filter (where kind = 'in'), 0) as cash_in,
      coalesce(sum(amount) filter (where kind = 'out'), 0) as cash_out
    from cash_ops where shift_id = sh.id
  ) co
  where sh.org_id = p_org and sh.opened_at >= p_from and sh.opened_at < p_to
    and (p_store is null or sh.store_id = p_store)
  order by sh.opened_at desc
$$;

create function public.report_cashiers(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_store uuid default null
) returns table (
  cashier_id uuid, cashier_name text, sales_sum numeric, card_sum numeric, cash_sum numeric,
  returns_sum numeric, total numeric, receipts bigint
)
language sql stable set search_path = public as $$
  select
    s.cashier_id,
    coalesce(nullif(max(pr.full_name), ''), max(pr.email), '—'),
    coalesce(sum(s.total) filter (where s.kind = 'sale'), 0),
    coalesce(sum(s.paid_card) filter (where s.kind = 'sale'), 0),
    coalesce(sum(s.paid_cash) filter (where s.kind = 'sale'), 0),
    coalesce(sum(s.total) filter (where s.kind = 'return'), 0),
    coalesce(sum(case when s.kind = 'sale' then s.total else -s.total end), 0),
    count(*) filter (where s.kind = 'sale')
  from sales s
  left join profiles pr on pr.id = s.cashier_id
  where s.org_id = p_org and s.created_at >= p_from and s.created_at < p_to
    and (p_store is null or s.store_id = p_store)
  group by s.cashier_id
  order by 7 desc
$$;

create function public.report_pnl(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_store uuid default null
) returns table (
  sales_cash numeric, sales_card numeric, returns_sum numeric, discount numeric,
  cost_sold numeric, cost_returned numeric, writeoffs numeric, receipts bigint
)
language sql stable set search_path = public as $$
  select
    coalesce(sum(s.paid_cash) filter (where s.kind = 'sale'), 0),
    coalesce(sum(s.paid_card) filter (where s.kind = 'sale'), 0),
    coalesce(sum(s.total) filter (where s.kind = 'return'), 0),
    coalesce(sum(case when s.kind = 'sale' then s.discount else -s.discount end), 0),
    coalesce(sum(s.cost) filter (where s.kind = 'sale'), 0),
    coalesce(sum(s.cost) filter (where s.kind = 'return'), 0),
    (select coalesce(sum(d.total), 0) from stock_docs d
     where d.org_id = p_org and d.kind = 'writeoff' and d.created_at >= p_from and d.created_at < p_to
       and (p_store is null or d.store_id = p_store)),
    count(*) filter (where s.kind = 'sale')
  from sales s
  where s.org_id = p_org and s.created_at >= p_from and s.created_at < p_to
    and (p_store is null or s.store_id = p_store)
$$;

-- ───────────────────────── Права на функции ─────────────────────────

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

revoke execute on all functions in schema app from public, anon;
grant execute on function app.my_orgs(), app.my_managed_orgs(), app.is_member(uuid), app.is_manager(uuid),
  app.is_owner(uuid) to authenticated;
