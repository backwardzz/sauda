-- Общий справочник товаров: названия, штрихкоды и категории без цен. Магазин выбирает из него товары
-- в свой список, а новому магазину предлагаются пакеты ходовых товаров («У меня новый магазин»).
-- Справочник наполняется скриптом npm run catalog под служебным ключом, у пользователей доступ только на чтение.

-- Чем торгует магазин. Аптека пока заглушка: тип запоминается, отдельного учёта лекарств ещё нет.
alter table public.orgs
  add column business text not null default 'grocery' check (business in ('grocery', 'pharmacy'));

create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  business text not null default 'grocery' check (business in ('grocery', 'pharmacy')),
  name text not null,
  barcode text not null unique,
  unit text not null default 'шт' check (unit in ('шт', 'кг', 'л', 'м')),
  category text not null default '',
  subcategory text not null default '',
  -- ключ пакета в мастере «У меня новый магазин»; пусто — товар в пакеты не входит
  starter_pack text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_products_category_idx on public.catalog_products (business, category, subcategory, name);
create index catalog_products_name_trgm on public.catalog_products using gin (name extensions.gin_trgm_ops);
create index catalog_products_starter_idx on public.catalog_products (business, starter_pack) where starter_pack <> '';
create trigger catalog_products_touch before update on public.catalog_products
  for each row execute function app.touch_updated_at();

alter table public.catalog_products enable row level security;
create policy catalog_read on public.catalog_products for select to authenticated using (true);

-- ───────────────────────── Регистрация компании: тип магазина ─────────────────────────

drop function public.create_org(text, text, text);
create function public.create_org(
  p_name text, p_store text default 'Основной магазин', p_kind text default 'store', p_business text default 'grocery'
) returns uuid
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
  if p_kind not in ('store', 'supplier') then
    raise exception 'Неизвестный тип компании';
  end if;
  if p_business not in ('grocery', 'pharmacy') then
    raise exception 'Неизвестный тип магазина';
  end if;

  insert into orgs (name, kind, business)
  values (trim(p_name), p_kind, case when p_kind = 'store' then p_business else 'grocery' end)
  returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  -- у поставщика нет торговых точек и касс: он работает с каталогом и заказами
  if p_kind = 'store' then
    insert into stores (org_id, name)
    values (v_org, coalesce(nullif(trim(p_store), ''), 'Основной магазин'))
    returning id into v_store;
    insert into registers (org_id, store_id, name) values (v_org, v_store, 'Касса 1');
  end if;
  return v_org;
end $$;

-- ───────────────────────── Просмотр справочника ─────────────────────────

-- Товар справочника уже есть в магазине, если совпал основной или дополнительный штрихкод.
create function app.has_barcode(p_org uuid, p_barcode text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from products
    where org_id = p_org and not archived and (barcode = p_barcode or p_barcode = any(extra_barcodes))
  );
$$;

-- Категории справочника с количеством товаров: дерево слева от списка.
create function public.catalog_categories(p_org uuid)
returns table (category text, subcategory text, cnt bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_member(p_org) then
    raise exception 'Нет доступа';
  end if;
  return query
    select c.category, c.subcategory, count(*)
    from catalog_products c
    where c.business = (select o.business from orgs o where o.id = p_org)
    group by 1, 2 order by 1, 2;
end $$;

-- Страница справочника. p_category null — все категории, '' — товары без категории; p_subcategory null — вся категория.
-- mine — товар уже есть в списке магазина; total — сколько всего строк под фильтром.
create function public.catalog_search(
  p_org uuid, p_term text default '', p_category text default null, p_subcategory text default null,
  p_only_new boolean default false, p_limit int default 50, p_offset int default 0
) returns table (id uuid, name text, barcode text, unit text, category text, subcategory text, mine boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := replace(replace(replace(trim(coalesce(p_term, '')), '\', '\\'), '%', '\%'), '_', '\_');
begin
  if not app.is_member(p_org) then
    raise exception 'Нет доступа';
  end if;
  return query
    select f.id, f.name, f.barcode, f.unit, f.category, f.subcategory, app.has_barcode(p_org, f.barcode), f.total
    from (
      select c.*, count(*) over () as total
      from catalog_products c
      where c.business = (select o.business from orgs o where o.id = p_org)
        and (v_term = '' or c.name ilike '%' || v_term || '%' or c.barcode like v_term || '%')
        and (p_category is null or c.category = p_category)
        and (p_subcategory is null or c.subcategory = p_subcategory)
        and (not p_only_new or not app.has_barcode(p_org, c.barcode))
      order by c.name, c.id
      limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) f
    order by f.name, f.id;
end $$;

-- Пакеты ходовых товаров для мастера «У меня новый магазин».
create function public.starter_products(p_org uuid)
returns table (id uuid, name text, barcode text, unit text, category text, subcategory text, starter_pack text, mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_member(p_org) then
    raise exception 'Нет доступа';
  end if;
  return query
    select c.id, c.name, c.barcode, c.unit, c.category, c.subcategory, c.starter_pack, app.has_barcode(p_org, c.barcode)
    from catalog_products c
    where c.business = (select o.business from orgs o where o.id = p_org) and c.starter_pack <> ''
    order by c.starter_pack, c.subcategory, c.name;
end $$;

-- ───────────────────────── Добавление товаров справочника в магазин ─────────────────────────
-- Цены остаются нулевыми: магазин задаёт их в приёмке или в карточке товара. Категории создаются по названиям.
create function public.add_catalog_products(p_org uuid, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row catalog_products%rowtype;
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
    select * from catalog_products where id = any(p_ids) and business = v_business order by category, subcategory, name
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

    insert into products (org_id, name, unit, barcode, category_id)
    values (p_org, v_row.name, v_row.unit, v_row.barcode, v_cat);
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
