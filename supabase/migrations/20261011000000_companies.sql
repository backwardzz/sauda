-- Компании вместо «поставщиков». Компания и её филиалы — отдельные объекты (companies, company_branches);
-- каталог компании — товар и его виды (фасовки) с остатками по филиалам; у магазинов и компаний появились
-- реквизиты и города; магазин видит цены компаний прямо в каталоге товаров и в пакетах для нового магазина.

-- ───────────────────────── Реквизиты и города ─────────────────────────

-- список городов нужен уже на странице регистрации, до входа
create policy cities_read_anon on public.cities for select to anon using (true);

-- Реквизиты общие для магазина и компании. Город и адрес живут у торговой точки и у филиала.
alter table public.orgs
  add column bin text not null default '' check (bin = '' or bin ~ '^\d{12}$'),
  add column email text not null default '',
  add column contact_name text not null default '',
  -- логотип: ссылка https или уменьшенная картинка, которую сайт сжимает перед сохранением
  add column logo_url text not null default '' check (
    logo_url = '' or logo_url ~* '^https://'
    or (logo_url ~ '^data:image/(png|jpeg|webp);base64,' and length(logo_url) <= 200000)
  );

alter table public.stores
  add column city_id smallint references public.cities,
  add column phone text not null default '';

-- ───────────────────────── Компании и филиалы ─────────────────────────

alter table public.orgs drop constraint orgs_kind_check;
update public.orgs set kind = 'company' where kind = 'supplier';
alter table public.orgs add constraint orgs_kind_check check (kind in ('store', 'company'));

-- Компании видят все вошедшие пользователи: это витрина. Магазины видны только своим участникам.
drop policy supplier_public on public.orgs;
create policy company_public on public.orgs for select to authenticated using (kind = 'company');

-- Витрина компании: чем торгует и на каких условиях. Создаётся вместе с аккаунтом в create_org.
create table public.companies (
  org_id uuid primary key references public.orgs on delete cascade,
  company_type text not null default 'distributor' check (company_type in ('manufacturer', 'distributor', 'wholesaler')),
  description text not null default '',
  website text not null default '',
  min_order numeric(14, 2) not null default 0 check (min_order >= 0),
  delivery_note text not null default '',
  payment_terms text not null default '',
  -- «Подтверждённая компания»: отметку ставит только администратор площадки
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

insert into public.companies (org_id, description, min_order, delivery_note)
select id, description, min_order, delivery_note from public.orgs where kind = 'company';

alter table public.orgs drop column description, drop column min_order, drop column delivery_note;

-- Владелец меняет только реквизиты: тип аккаунта и валюта не редактируются.
revoke update on public.orgs from authenticated, anon;
grant update (name, phone, bin, email, contact_name, logo_url) on public.orgs to authenticated;

alter table public.companies enable row level security;
create policy company_read on public.companies for select to authenticated using (true);
create policy owner_update on public.companies for update to authenticated
  using (app.is_owner(org_id)) with check (app.is_owner(org_id));
revoke insert, update, delete on public.companies from authenticated, anon;
grant update (company_type, description, website, min_order, delivery_note, payment_terms) on public.companies to authenticated;

-- Филиал: офис и склад компании в городе. Заказ магазина попадает в филиал его города, иначе — в главный.
create table public.company_branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  city_id smallint not null references public.cities,
  name text not null check (trim(name) <> ''),
  address text not null default '',
  phone text not null default '',
  manager_name text not null default '',
  work_hours text not null default '',
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index company_branches_main_uq on public.company_branches (org_id) where is_main;
create index company_branches_org_idx on public.company_branches (org_id);
create index company_branches_city_idx on public.company_branches (city_id);

-- У компаний, созданных до этой миграции, города не было: главный офис заводится в Алматы, владелец поправит в профиле.
insert into public.company_branches (org_id, city_id, name, phone, is_main)
select o.id, (select id from public.cities where name = 'Алматы' and region = ''), 'Главный офис', o.phone, true
from public.orgs o where o.kind = 'company';

alter table public.company_branches enable row level security;
create policy branch_read on public.company_branches for select to authenticated using (true);
create policy owner_insert on public.company_branches for insert to authenticated
  with check (app.is_owner(org_id) and exists (select 1 from public.orgs o where o.id = org_id and o.kind = 'company'));
create policy owner_update on public.company_branches for update to authenticated
  using (app.is_owner(org_id)) with check (app.is_owner(org_id));
-- главный филиал назначает set_main_branch, удаляет филиал delete_company_branch
revoke insert, update, delete on public.company_branches from authenticated, anon;
grant insert (org_id, city_id, name, address, phone, manager_name, work_hours) on public.company_branches to authenticated;
grant update (city_id, name, address, phone, manager_name, work_hours) on public.company_branches to authenticated;

-- ───────────────────────── Каталог компании: товар и его виды ─────────────────────────

-- Товар — то, что видит покупатель в каталоге («Coca-Cola»); виды — фасовки со своим штрихкодом и ценой («0,5 л», «1 л»).
create table public.company_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null check (trim(name) <> ''),
  category text not null default '',
  description text not null default '',
  image_url text not null default '' check (image_url = '' or image_url ~* '^https://'),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index company_products_org_idx on public.company_products (org_id, archived, category, name);
create trigger company_products_touch before update on public.company_products
  for each row execute function app.touch_updated_at();

alter table public.supplier_products rename to company_variants;
alter index public.supplier_products_pkey rename to company_variants_pkey;
alter index public.supplier_products_barcode_uq rename to company_variants_barcode_uq;
alter index public.supplier_products_org_idx rename to company_variants_org_idx;
alter table public.company_variants rename constraint supplier_products_org_id_fkey to company_variants_org_id_fkey;
alter table public.company_variants rename constraint supplier_products_unit_check to company_variants_unit_check;
alter table public.company_variants rename constraint supplier_products_price_check to company_variants_price_check;
alter table public.company_variants rename constraint supplier_products_pack_qty_check to company_variants_pack_qty_check;
alter table public.company_variants rename constraint supplier_products_image_https to company_variants_image_https;
alter trigger supplier_products_touch on public.company_variants rename to company_variants_touch;
drop trigger supplier_products_to_catalog on public.company_variants;
drop function app.supplier_product_to_catalog();

alter table public.company_variants
  add column product_id uuid,
  -- подпись вида внутри товара: «0,5 л», «1 л»; у товара с одним видом может быть пустой
  add column label text not null default '',
  -- в продаже: виден магазинам. Снятый с продажи вид остаётся в каталоге компании.
  add column active boolean not null default true,
  -- остаток учитывается: заказать можно не больше свободного. Без учёта вид всегда в наличии.
  add column track_stock boolean not null default false,
  add column min_stock numeric(14, 3) check (min_stock >= 0),
  add column sort int not null default 0;

-- «Нет в наличии» раньше ставили вручную; теперь это учёт остатка с нулём на складе.
update public.company_variants set track_stock = true where not available;

-- Прежние товары раскладываются на товар и вид по размеру в названии:
-- «Вода питьевая 0,5 л» и «Вода питьевая 1,5 л» → товар «Вода питьевая» с видами «0,5 л» и «1,5 л».
-- То же правило при загрузке прайса из Excel — в src/lib/variants.ts.
create function pg_temp.split_name(p_name text, out base text, out label text)
language plpgsql immutable as $$
declare
  m text[] := regexp_match(
    regexp_replace(trim(p_name), '\s+', ' ', 'g'),
    '^(.*?\S) ((?:\d+ ?[xх*] ?)?\d+(?:[.,]\d+)? ?(?:мл|мг|кг|гр|г|л|шт|см|мм|м|ml|kg|g|l)(?![[:alpha:]]).*)$', 'i');
begin
  if m is null then
    base := regexp_replace(trim(p_name), '\s+', ' ', 'g');
    label := '';
  else
    base := m[1];
    label := m[2];
  end if;
end $$;

with src as (
  select v.id, v.org_id, v.category, v.image_url, v.archived, v.created_at, s.base, s.label
  from public.company_variants v, lateral pg_temp.split_name(v.name) s
),
made as (
  insert into public.company_products (org_id, name, category, image_url, archived, created_at)
  select org_id, (array_agg(base order by created_at))[1], category,
         coalesce((array_agg(image_url order by archived, created_at) filter (where image_url <> ''))[1], ''),
         bool_and(archived), min(created_at)
  from src
  group by org_id, lower(base), category
  returning id, org_id, name, category
)
update public.company_variants v
set product_id = m.id, label = s.label
from src s
join made m on m.org_id = s.org_id and lower(m.name) = lower(s.base) and m.category = s.category
where v.id = s.id;

alter table public.company_variants
  alter column product_id set not null,
  add constraint company_variants_product_fkey foreign key (product_id, org_id)
    references public.company_products (id, org_id) on delete cascade,
  drop column name,
  drop column category,
  drop column available;
create index company_variants_product_idx on public.company_variants (product_id) where not archived;
-- предложения по штрихкоду: каталог товаров магазина показывает цены компаний
create index company_variants_offer_idx on public.company_variants (barcode) where active and not archived;

alter table public.company_products enable row level security;
create policy catalog_read on public.company_products for select to authenticated
  using (not archived or org_id in (select app.my_orgs()));
create policy manager_insert on public.company_products for insert to authenticated
  with check (org_id in (select app.my_managed_orgs()));
create policy manager_update on public.company_products for update to authenticated
  using (org_id in (select app.my_managed_orgs())) with check (org_id in (select app.my_managed_orgs()));

drop policy catalog_read on public.company_variants;
create policy catalog_read on public.company_variants for select to authenticated
  using ((active and not archived) or org_id in (select app.my_orgs()));
-- виды не удаляются, а уходят в архив: на них ссылаются строки заказов
drop policy manager_delete on public.company_variants;

-- Товар компании попадает в общий справочник: магазин находит его в «Каталоге товаров» и добавляет к себе.
-- Строку справочника с таким штрихкодом не трогаем: название и категория в ней уже выверены.
create function app.variant_to_catalog() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.archived then
    insert into catalog_products (name, barcode, unit, category)
    select trim(p.name || ' ' || new.label), new.barcode, new.unit, p.category
    from company_products p where p.id = new.product_id
    on conflict (barcode) do nothing;
  end if;
  return new;
end $$;

create trigger company_variants_to_catalog after insert or update of barcode on public.company_variants
  for each row execute function app.variant_to_catalog();

-- ───────────────────────── Склад компании ─────────────────────────

create table public.company_stock (
  branch_id uuid not null references public.company_branches on delete cascade,
  variant_id uuid not null references public.company_variants on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  qty numeric(14, 3) not null default 0 check (qty >= 0),
  primary key (branch_id, variant_id)
);
create index company_stock_variant_idx on public.company_stock (variant_id);

create table public.company_stock_moves (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  branch_id uuid not null references public.company_branches on delete cascade,
  variant_id uuid not null references public.company_variants on delete cascade,
  delta numeric(14, 3) not null,
  qty_after numeric(14, 3) not null,
  -- adjust — правка остатка вручную, import — загрузка прайса, shipment — отгрузка заказа
  reason text not null check (reason in ('adjust', 'import', 'shipment')),
  order_id uuid,
  comment text not null default '',
  user_id uuid,
  created_at timestamptz not null default now()
);
create index company_stock_moves_variant_idx on public.company_stock_moves (variant_id, created_at desc);

-- Остатки и их история видны только сотрудникам компании и меняются только функциями ниже.
alter table public.company_stock enable row level security;
create policy member_read on public.company_stock for select to authenticated using (org_id in (select app.my_orgs()));
alter table public.company_stock_moves enable row level security;
create policy member_read on public.company_stock_moves for select to authenticated using (org_id in (select app.my_orgs()));

-- ───────────────────────── Заказы: филиал и контакты магазина ─────────────────────────

alter table public.order_items rename column supplier_product_id to variant_id;
alter table public.order_items rename constraint order_items_supplier_product_id_fkey to order_items_variant_id_fkey;
create index order_items_variant_idx on public.order_items (variant_id);

-- Заказ хранит филиал и контакты магазина на момент оформления: компания не имеет доступа к данным магазина.
alter table public.orders
  add column branch_id uuid references public.company_branches on delete set null,
  add column branch_name text not null default '',
  add column store_city text not null default '',
  add column store_phone text not null default '';
update public.orders o set branch_id = b.id, branch_name = b.name
from public.company_branches b where b.org_id = o.supplier_org and b.is_main;
create index orders_branch_idx on public.orders (branch_id, status);
alter table public.company_stock_moves
  add constraint company_stock_moves_order_fkey foreign key (order_id) references public.orders on delete set null;

-- ───────────────────────── Служебные функции ─────────────────────────

-- Филиал, который обслуживает город: свой в этом городе, иначе главный.
create function app.serving_branch(p_company uuid, p_city smallint) returns uuid
language sql stable security definer set search_path = public as $$
  select id from company_branches
  where org_id = p_company
  order by (city_id = p_city) desc nulls last, is_main desc, created_at
  limit 1
$$;

-- Свободный остаток вида в филиале: на складе минус то, что уже заказано и ещё не отгружено.
-- null — остаток не учитывается, заказывать можно без ограничения.
create function app.variant_free(p_variant uuid, p_branch uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when v.track_stock then
    coalesce((select s.qty from company_stock s where s.branch_id = p_branch and s.variant_id = v.id), 0)
    - coalesce((select sum(coalesce(i.qty_shipped, i.qty))
                from order_items i join orders o on o.id = i.order_id
                where i.variant_id = v.id and o.branch_id = p_branch and o.status in ('new', 'confirmed')), 0)
  end
  from company_variants v where v.id = p_variant
$$;

-- Сколько компаний продают товар с таким штрихкодом.
create function app.offer_count(p_barcode text) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from company_variants v
  join company_products p on p.id = v.product_id
  where v.barcode = p_barcode and v.active and not v.archived and not p.archived
$$;

create function app.move_company_stock(
  p_org uuid, p_branch uuid, p_variant uuid, p_delta numeric, p_reason text, p_order uuid, p_comment text
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_after numeric;
begin
  -- не insert … on conflict: проверка qty >= 0 сработала бы на отрицательной разнице ещё до поиска существующей строки
  update company_stock set qty = qty + p_delta
  where branch_id = p_branch and variant_id = p_variant
  returning qty into v_after;
  if not found then
    insert into company_stock (branch_id, variant_id, org_id, qty) values (p_branch, p_variant, p_org, p_delta)
    returning qty into v_after;
  end if;

  insert into company_stock_moves (org_id, branch_id, variant_id, delta, qty_after, reason, order_id, comment, user_id)
  values (p_org, p_branch, p_variant, p_delta, v_after, p_reason, p_order, coalesce(p_comment, ''), auth.uid());
  return v_after;
end $$;

-- Остаток приводится к p_qty; в историю пишется разница. Без изменений история не растёт.
create function app.set_company_stock(
  p_org uuid, p_branch uuid, p_variant uuid, p_qty numeric, p_reason text, p_comment text
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_cur numeric;
begin
  if p_qty is null or p_qty < 0 then
    raise exception 'Остаток не может быть отрицательным';
  end if;
  select qty into v_cur from company_stock where branch_id = p_branch and variant_id = p_variant for update;
  if not found then
    insert into company_stock (branch_id, variant_id, org_id, qty) values (p_branch, p_variant, p_org, 0)
    on conflict do nothing;
    v_cur := 0;
  end if;
  if p_qty = v_cur then
    return v_cur;
  end if;
  return app.move_company_stock(p_org, p_branch, p_variant, p_qty - v_cur, p_reason, null, p_comment);
end $$;

-- ───────────────────────── Регистрация: магазин или компания ─────────────────────────
-- p_profile: {phone, address, bin, email, contact_name, company_type, description}

drop function public.create_org(text, text, text, text);
create function public.create_org(
  p_name text, p_store text default '', p_kind text default 'store', p_business text default 'grocery',
  p_city smallint default null, p_profile jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_store uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_p jsonb := coalesce(p_profile, '{}'::jsonb);
  v_phone text := trim(coalesce(v_p ->> 'phone', ''));
  v_address text := trim(coalesce(v_p ->> 'address', ''));
  v_bin text := regexp_replace(coalesce(v_p ->> 'bin', ''), '\D', '', 'g');
  v_type text := coalesce(nullif(v_p ->> 'company_type', ''), 'distributor');
begin
  if auth.uid() is null then
    raise exception 'Требуется вход';
  end if;
  if v_name = '' then
    raise exception 'Укажите название';
  end if;
  if p_kind not in ('store', 'company') then
    raise exception 'Неизвестный тип аккаунта';
  end if;
  if p_business not in ('grocery', 'pharmacy') then
    raise exception 'Неизвестный тип магазина';
  end if;
  if p_city is null or not exists (select 1 from cities where id = p_city) then
    raise exception 'Укажите город';
  end if;
  if v_bin <> '' and v_bin !~ '^\d{12}$' then
    raise exception 'БИН или ИИН — это 12 цифр';
  end if;
  if v_type not in ('manufacturer', 'distributor', 'wholesaler') then
    raise exception 'Неизвестный тип компании';
  end if;

  insert into orgs (name, kind, business, phone, bin, email, contact_name)
  values (v_name, p_kind, case when p_kind = 'store' then p_business else 'grocery' end, v_phone, v_bin,
          trim(coalesce(v_p ->> 'email', '')), trim(coalesce(v_p ->> 'contact_name', '')))
  returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');

  if p_kind = 'store' then
    insert into stores (org_id, name, address, city_id, phone)
    values (v_org, coalesce(nullif(trim(p_store), ''), 'Основной магазин'), v_address, p_city, v_phone)
    returning id into v_store;
    insert into registers (org_id, store_id, name) values (v_org, v_store, 'Касса 1');
  else
    -- у компании нет торговых точек и касс: профиль, главный филиал, каталог и заказы
    insert into companies (org_id, company_type, description)
    values (v_org, v_type, trim(coalesce(v_p ->> 'description', '')));
    insert into company_branches (org_id, city_id, name, address, phone, is_main)
    values (v_org, p_city, 'Главный офис', v_address, v_phone, true);
  end if;
  return v_org;
end $$;

-- ───────────────────────── Филиалы ─────────────────────────

create function public.set_main_branch(p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from company_branches where id = p_branch;
  if v_org is null or not app.is_owner(v_org) then
    raise exception 'Нет доступа';
  end if;
  update company_branches set is_main = false where org_id = v_org and is_main and id <> p_branch;
  update company_branches set is_main = true where id = p_branch;
end $$;

create function public.delete_company_branch(p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v company_branches%rowtype;
begin
  select * into v from company_branches where id = p_branch;
  if not found or not app.is_owner(v.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v.is_main then
    raise exception 'Главный филиал удалить нельзя: сначала назначьте главным другой';
  end if;
  if exists (select 1 from orders where branch_id = v.id and status in ('new', 'confirmed')) then
    raise exception 'У филиала есть незавершённые заказы: отгрузите их или передайте другому филиалу';
  end if;
  if exists (select 1 from company_stock where branch_id = v.id and qty > 0) then
    raise exception 'На складе филиала есть товар: сначала обнулите остатки';
  end if;
  delete from company_branches where id = v.id;
end $$;

-- ───────────────────────── Каталог компании ─────────────────────────

-- Товар со всеми видами одним сохранением.
-- p_product: {id, name, category, description, image_url}
-- p_variants: [{id, label, barcode, unit, price, pack_qty, image_url, active, track_stock, min_stock, stock: {филиал: остаток}}]
-- Виды товара, которых нет в списке, уходят в архив.
create function public.save_company_product(p_org uuid, p_product jsonb, p_variants jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
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
  if v_name = '' then
    raise exception 'Укажите название товара';
  end if;
  if v_image <> '' and v_image !~* '^https://' then
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
                                    track_stock, min_stock, sort)
      values (p_org, v_id, coalesce(trim(v_row.label), ''), trim(v_row.barcode),
              case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else 'шт' end,
              coalesce(v_row.price, 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
              coalesce(trim(v_row.image_url), ''), coalesce(v_row.active, true), coalesce(v_row.track_stock, false),
              v_row.min_stock, v_row.ord)
      returning id into v_var;
    else
      update company_variants
      set label = coalesce(trim(v_row.label), ''), barcode = trim(v_row.barcode),
          unit = case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else unit end,
          price = coalesce(v_row.price, 0), pack_qty = case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
          image_url = coalesce(trim(v_row.image_url), ''), active = coalesce(v_row.active, true),
          track_stock = coalesce(v_row.track_stock, false), min_stock = v_row.min_stock, sort = v_row.ord,
          archived = false
      where id = v_row.id and product_id = v_id
      returning id into v_var;
      if v_var is null then
        raise exception 'Вид товара не найден: %', v_title;
      end if;
    end if;
    v_keep := v_keep || v_var;

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
end $$;

-- Убрать товар из каталога вместе с видами или вернуть его.
create function public.archive_company_product(p_product uuid, p_archived boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from company_products where id = p_product;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  update company_products set archived = p_archived where id = p_product;
  update company_variants set archived = p_archived where product_id = p_product;
end $$;

create function public.set_company_stock(p_variant uuid, p_branch uuid, p_qty numeric, p_comment text default '')
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v company_variants%rowtype;
begin
  select * into v from company_variants where id = p_variant;
  if not found or not app.is_manager(v.org_id) then
    raise exception 'Нет доступа';
  end if;
  if not exists (select 1 from company_branches where id = p_branch and org_id = v.org_id) then
    raise exception 'Филиал не найден';
  end if;
  -- первая же цифра остатка включает учёт
  update company_variants set track_stock = true where id = v.id and not track_stock;
  return app.set_company_stock(v.org_id, p_branch, v.id, p_qty, 'adjust', p_comment);
end $$;

-- Прайс из Excel. Товар ищется по названию, вид — по штрихкоду; остаток из файла включает учёт остатка.
-- p_rows: [{product, label, barcode, unit, price, category, pack_qty, image_url, stock}]
-- p_branch — склад, на который ставится остаток из файла (по умолчанию главный филиал).
drop function public.import_supplier_products(uuid, jsonb);
create function public.import_company_products(p_org uuid, p_rows jsonb, p_branch uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
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
end $$;

-- Продажи и остатки по каждому виду товара компании: карточка товара и главная страница.
create function public.company_stats(p_org uuid)
returns table (
  variant_id uuid, stock numeric, reserved numeric, sold_qty numeric, sold_sum numeric, sold_qty_30 numeric,
  orders_count bigint, stores_count bigint, last_sold_at timestamptz
)
language sql stable set search_path = public as $$
  select v.id,
         case when v.track_stock then coalesce(st.qty, 0) end,
         coalesce(s.reserved, 0), coalesce(s.sold_qty, 0), coalesce(s.sold_sum, 0), coalesce(s.sold_qty_30, 0),
         coalesce(s.orders_count, 0), coalesce(s.stores_count, 0), s.last_sold_at
  from company_variants v
  left join lateral (select sum(cs.qty) as qty from company_stock cs where cs.variant_id = v.id) st on true
  left join lateral (
    select
      sum(coalesce(i.qty_shipped, i.qty)) filter (where o.status in ('new', 'confirmed')) as reserved,
      sum(coalesce(i.qty_shipped, i.qty)) filter (where o.status in ('shipped', 'received')) as sold_qty,
      sum(round(coalesce(i.qty_shipped, i.qty) * i.price, 2)) filter (where o.status in ('shipped', 'received')) as sold_sum,
      sum(coalesce(i.qty_shipped, i.qty))
        filter (where o.status in ('shipped', 'received') and o.shipped_at >= now() - interval '30 days') as sold_qty_30,
      count(distinct o.id) filter (where o.status in ('shipped', 'received')) as orders_count,
      count(distinct o.store_org) filter (where o.status in ('shipped', 'received')) as stores_count,
      max(o.shipped_at) filter (where o.status in ('shipped', 'received')) as last_sold_at
    from order_items i
    join orders o on o.id = i.order_id
    where i.variant_id = v.id
  ) s on true
  where v.org_id = p_org and app.is_member(p_org)
$$;

-- ───────────────────────── Витрина для магазинов ─────────────────────────

-- Список компаний площадки: карточка с логотипом, городами филиалов и примерами товаров.
create function public.company_directory()
returns table (
  id uuid, name text, logo_url text, phone text, company_type text, description text, min_order numeric,
  delivery_note text, payment_terms text, verified boolean, products bigint, categories text[], images text[],
  cities text[], city_ids smallint[]
)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.logo_url, o.phone, c.company_type, c.description, c.min_order, c.delivery_note,
         c.payment_terms, c.verified, coalesce(p.cnt, 0), coalesce(p.categories, '{}'), coalesce(p.images, '{}'),
         coalesce(b.cities, '{}'), coalesce(b.city_ids, '{}')
  from orgs o
  join companies c on c.org_id = o.id
  left join lateral (
    select count(*) as cnt,
           (array_agg(distinct cp.category) filter (where cp.category <> ''))[1:6] as categories,
           (array_agg(cp.image_url order by cp.name) filter (where cp.image_url <> ''))[1:5] as images
    from company_products cp
    where cp.org_id = o.id and not cp.archived
      and exists (select 1 from company_variants v where v.product_id = cp.id and v.active and not v.archived)
  ) p on true
  left join lateral (
    select array_agg(x.name order by x.is_main desc, x.name) as cities,
           array_agg(x.city_id order by x.is_main desc, x.name) as city_ids
    from (
      select distinct on (br.city_id) br.city_id, ci.name, br.is_main
      from company_branches br join cities ci on ci.id = br.city_id
      where br.org_id = o.id
      order by br.city_id, br.is_main desc
    ) x
  ) b on true
  where o.kind = 'company'
  order by o.name
$$;

-- Предложения компаний глазами магазина: цена, упаковка и свободный остаток в филиале, который обслуживает город магазина.
-- Отбор — по компании, по штрихкодам (каталог товаров, пакеты для нового магазина) или по видам (корзина).
create function public.store_offers(
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
    select v.id, o.id, o.name, c.min_order, p.id, p.name, v.label, p.category, p.description,
           coalesce(nullif(v.image_url, ''), p.image_url), v.barcode, v.unit, v.price, v.pack_qty,
           app.variant_free(v.id, b.id), b.id, coalesce(b.name, ''), coalesce(b.city_id = v_city, false)
    from company_variants v
    join company_products p on p.id = v.product_id and not p.archived
    join orgs o on o.id = v.org_id and o.kind = 'company'
    join companies c on c.org_id = o.id
    left join company_branches b on b.id = app.serving_branch(o.id, v_city)
    where v.active and not v.archived
      and (p_company is null or v.org_id = p_company)
      and (p_barcodes is null or v.barcode = any (p_barcodes))
      and (p_variants is null or v.id = any (p_variants))
    order by p.category, p.name, v.sort, v.price;
end $$;

-- ───────────────────────── Заказ ─────────────────────────
-- p_items: [{variant_id, qty}] — виды товаров из каталога компании

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
  select min_order into v_min from companies where org_id = v_company.id;
  select * into v_branch from company_branches where id = app.serving_branch(v_company.id, v_store.city_id);

  insert into orders (number, supplier_org, store_org, store_id, supplier_name, store_org_name, store_name, store_address,
                      store_city, store_phone, branch_id, branch_name, comment, created_by)
  values (app.next_number(v_company.id, 'order'), v_company.id, v_store.org_id, v_store.id, v_company.name,
          (select name from orgs where id = v_store.org_id), v_store.name, v_store.address,
          coalesce((select name from cities where id = v_store.city_id), ''),
          coalesce(nullif(v_store.phone, ''), (select phone from orgs where id = v_store.org_id), ''),
          v_branch.id, coalesce(v_branch.name, ''), coalesce(p_comment, ''), auth.uid())
  returning id into v_order;

  for v_item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric) loop
    select v.id, v.barcode, v.unit, v.price, v.track_stock, trim(p.name || ' ' || v.label) as name
    into v_var
    from company_variants v
    join company_products p on p.id = v.product_id
    where v.id = v_item.variant_id and v.org_id = v_company.id and v.active and not v.archived and not p.archived;
    if not found then
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
    insert into order_items (order_id, supplier_org, store_org, variant_id, name, barcode, unit, qty, price)
    values (v_order, v_company.id, v_store.org_id, v_var.id, v_var.name, v_var.barcode, v_var.unit, v_item.qty, v_var.price);
    v_total := v_total + round(v_item.qty * v_var.price, 2);
  end loop;

  if v_total < coalesce(v_min, 0) then
    raise exception 'Минимальная сумма заказа у компании — %', trim_scale(v_min);
  end if;
  update orders set total = v_total where id = v_order;
  return v_order;
end $$;

-- Компания: new → confirmed (можно уменьшить количества: p_items [{item_id, qty}]) → shipped; отмена до отгрузки.
-- Отгрузка списывает товар со склада филиала. Магазин может отменить только новый заказ.
create or replace function public.set_order_status(
  p_order uuid, p_status text, p_items jsonb default null, p_comment text default null
) returns void
language plpgsql security definer set search_path = public as $$
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
  v_supplier := app.is_member(v.supplier_org);
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
end $$;

-- Передать заказ другому филиалу: до отгрузки, пока товар ещё не списан со склада.
create function public.set_order_branch(p_order uuid, p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v orders%rowtype;
  v_branch company_branches%rowtype;
begin
  select * into v from orders where id = p_order for update;
  if not found or not app.is_member(v.supplier_org) then
    raise exception 'Нет доступа';
  end if;
  if v.status not in ('new', 'confirmed') then
    raise exception 'Филиал можно сменить только до отгрузки';
  end if;
  select * into v_branch from company_branches where id = p_branch and org_id = v.supplier_org;
  if not found then
    raise exception 'Филиал не найден';
  end if;
  update orders set branch_id = v_branch.id, branch_name = v_branch.name where id = v.id;
end $$;

-- ───────────────────────── Каталог товаров магазина: предложения компаний ─────────────────────────

-- offers — сколько компаний продают товар; p_only_offers оставляет только товары, которые можно заказать.
drop function public.catalog_search(uuid, text, text, text, boolean, int, int, text);
create function public.catalog_search(
  p_org uuid, p_term text default '', p_category text default null, p_subcategory text default null,
  p_only_new boolean default false, p_limit int default 50, p_offset int default 0, p_company text default null,
  p_only_offers boolean default false
) returns table (
  id uuid, name text, barcode text, unit text, category text, subcategory text, company text,
  mine boolean, offers bigint, total bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := replace(replace(replace(trim(coalesce(p_term, '')), '\', '\\'), '%', '\%'), '_', '\_');
begin
  if not app.is_member(p_org) then
    raise exception 'Нет доступа';
  end if;
  return query
    select f.id, f.name, f.barcode, f.unit, f.category, f.subcategory, f.company,
           app.has_barcode(p_org, f.barcode), app.offer_count(f.barcode), f.total
    from (
      select c.*, count(*) over () as total
      from catalog_products c
      where c.business = (select o.business from orgs o where o.id = p_org)
        and (v_term = '' or c.name ilike '%' || v_term || '%' or c.barcode like v_term || '%')
        and (p_category is null or c.category = p_category)
        and (p_subcategory is null or c.subcategory = p_subcategory)
        and (p_company is null or c.company = p_company)
        and (not p_only_new or not app.has_barcode(p_org, c.barcode))
        and (not p_only_offers or app.offer_count(c.barcode) > 0)
      order by c.name, c.id
      limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) f
    order by f.name, f.id;
end $$;

-- Товары справочника — в список магазина. p_prices: [{id, purchase_price, sale_price}] — цены для новых товаров:
-- закупочная из предложения компании и розничная, которую магазин задал при добавлении. Без них цены нулевые.
drop function public.add_catalog_products(uuid, uuid[]);
create function public.add_catalog_products(p_org uuid, p_ids uuid[], p_prices jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_business text;
  v_root uuid;
  v_cat uuid;
  v_created int := 0;
  v_skipped int := 0;
begin
  if not app.is_manager(p_org) then
    raise exception 'Нет доступа';
  end if;
  select business into v_business from orgs where id = p_org and kind = 'store';
  if not found then
    raise exception 'Справочник товаров доступен только магазинам';
  end if;

  for v_row in
    select c.*, x.purchase_price, x.sale_price
    from catalog_products c
    left join jsonb_to_recordset(coalesce(p_prices, '[]'::jsonb)) as x(id uuid, purchase_price numeric, sale_price numeric)
      on x.id = c.id
    where c.id = any (p_ids) and c.business = v_business
    order by c.category, c.subcategory, c.name
  loop
    if app.has_barcode(p_org, v_row.barcode) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_cat := null;
    if v_row.category <> '' then
      select id into v_root from categories
      where org_id = p_org and lower(name) = lower(v_row.category)
      order by parent_id nulls first limit 1;
      if v_root is null then
        insert into categories (org_id, name) values (p_org, v_row.category) returning id into v_root;
      end if;
      v_cat := v_root;
      if v_row.subcategory <> '' then
        select id into v_cat from categories
        where org_id = p_org and parent_id = v_root and lower(name) = lower(v_row.subcategory) limit 1;
        if v_cat is null then
          insert into categories (org_id, parent_id, name) values (p_org, v_root, v_row.subcategory) returning id into v_cat;
        end if;
      end if;
    end if;

    insert into products (org_id, name, unit, barcode, category_id, purchase_price, sale_price)
    values (p_org, v_row.name, v_row.unit, v_row.barcode, v_cat,
            greatest(coalesce(v_row.purchase_price, 0), 0), greatest(coalesce(v_row.sale_price, 0), 0));
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

-- ───────────────────────── Импорт товаров магазина: цены не обнуляются ─────────────────────────
-- greatest(null, 0) в Postgres равно 0, поэтому файл без столбца цены сбрасывал цены существующих товаров в ноль.
-- p_rows: [{name, barcode, extra_barcodes, unit, purchase_price, sale_price, wholesale_price,
--           category, subcategory, supplier, qty}]
create or replace function public.import_products(p_org uuid, p_store uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_cat uuid;
  v_sub uuid;
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
      wholesale_price numeric, category text, subcategory text, supplier text, qty numeric)
  loop
    if coalesce(trim(v_row.name), '') = '' or coalesce(trim(v_row.barcode), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- файл без столбца единиц не должен превращать весовой товар в штучный
    v_unit := case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit end;

    v_cat := null;
    if coalesce(trim(v_row.category), '') <> '' then
      select id into v_cat from categories
      where org_id = p_org and parent_id is null and lower(name) = lower(trim(v_row.category)) limit 1;
      if v_cat is null then
        insert into categories (org_id, name) values (p_org, trim(v_row.category)) returning id into v_cat;
      end if;
      if coalesce(trim(v_row.subcategory), '') <> '' then
        v_sub := null;
        select id into v_sub from categories
        where org_id = p_org and parent_id = v_cat and lower(name) = lower(trim(v_row.subcategory)) limit 1;
        if v_sub is null then
          insert into categories (org_id, parent_id, name) values (p_org, v_cat, trim(v_row.subcategory))
          returning id into v_sub;
        end if;
        v_cat := v_sub;
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
      values (p_org, trim(v_row.name), coalesce(v_unit, 'шт'), trim(v_row.barcode), coalesce(v_row.extra_barcodes, '{}'),
              v_cat, v_sup,
              greatest(coalesce(v_row.purchase_price, 0), 0), greatest(coalesce(v_row.sale_price, 0), 0),
              greatest(coalesce(v_row.wholesale_price, 0), 0))
      returning id into v_id;
      v_created := v_created + 1;
    else
      update products set
        name = trim(v_row.name),
        unit = coalesce(v_unit, unit),
        extra_barcodes = coalesce(v_row.extra_barcodes, extra_barcodes),
        category_id = coalesce(v_cat, category_id),
        supplier_id = coalesce(v_sup, supplier_id),
        purchase_price = case when v_row.purchase_price is null then purchase_price else greatest(v_row.purchase_price, 0) end,
        sale_price = case when v_row.sale_price is null then sale_price else greatest(v_row.sale_price, 0) end,
        wholesale_price = case when v_row.wholesale_price is null then wholesale_price else greatest(v_row.wholesale_price, 0) end
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

-- ───────────────────────── Права на функции ─────────────────────────

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on function app.my_orgs(), app.my_managed_orgs(), app.is_member(uuid), app.is_manager(uuid),
  app.is_owner(uuid) to authenticated;
