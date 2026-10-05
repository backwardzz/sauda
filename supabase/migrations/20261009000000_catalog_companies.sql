-- Компании-производители в каталоге товаров: категория → карточки компаний → товары компании.
-- Производитель определяется по марке в названии (scripts/catalog-companies.ts), у компании — логотип и отметка
-- «Подтверждённая компания». Отметку ставит только администратор площадки (служебным ключом).

alter table public.catalog_products add column company text not null default '';
create index catalog_products_company_idx on public.catalog_products (business, category, company);

create table public.catalog_companies (
  name text primary key,
  -- ссылка https на логотип; пусто — в интерфейсе инициалы
  logo_url text not null default '' check (logo_url = '' or logo_url ~* '^https://'),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.catalog_companies enable row level security;
create policy catalog_read on public.catalog_companies for select to authenticated using (true);

-- Компании выбранной категории с количеством товаров. p_category null — весь каталог, '' — без категории.
-- Товары без распознанной марки собраны в строку с пустым названием («Другие»).
create function public.catalog_company_list(p_org uuid, p_category text default null, p_subcategory text default null)
returns table (company text, cnt bigint, mine bigint, logo_url text, verified boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_member(p_org) then
    raise exception 'Нет доступа';
  end if;
  return query
    select c.company, count(*), count(*) filter (where app.has_barcode(p_org, c.barcode)),
           coalesce(max(k.logo_url), ''), coalesce(bool_or(k.verified), false)
    from catalog_products c
    left join catalog_companies k on k.name = c.company
    where c.business = (select o.business from orgs o where o.id = p_org)
      and (p_category is null or c.category = p_category)
      and (p_subcategory is null or c.subcategory = p_subcategory)
    group by c.company
    -- «Другие» в конце, остальные — по числу товаров
    order by (c.company = ''), count(*) desc, c.company;
end $$;

-- Поиск по каталогу с отбором по компании: p_company null — все, '' — товары без компании.
drop function public.catalog_search(uuid, text, text, text, boolean, int, int);
create function public.catalog_search(
  p_org uuid, p_term text default '', p_category text default null, p_subcategory text default null,
  p_only_new boolean default false, p_limit int default 50, p_offset int default 0, p_company text default null
) returns table (id uuid, name text, barcode text, unit text, category text, subcategory text, company text, mine boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := replace(replace(replace(trim(coalesce(p_term, '')), '\', '\\'), '%', '\%'), '_', '\_');
begin
  if not app.is_member(p_org) then
    raise exception 'Нет доступа';
  end if;
  return query
    select f.id, f.name, f.barcode, f.unit, f.category, f.subcategory, f.company, app.has_barcode(p_org, f.barcode), f.total
    from (
      select c.*, count(*) over () as total
      from catalog_products c
      where c.business = (select o.business from orgs o where o.id = p_org)
        and (v_term = '' or c.name ilike '%' || v_term || '%' or c.barcode like v_term || '%')
        and (p_category is null or c.category = p_category)
        and (p_subcategory is null or c.subcategory = p_subcategory)
        and (p_company is null or c.company = p_company)
        and (not p_only_new or not app.has_barcode(p_org, c.barcode))
      order by c.name, c.id
      limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) f
    order by f.name, f.id;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
