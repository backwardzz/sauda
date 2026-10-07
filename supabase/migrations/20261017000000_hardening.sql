-- Наведение порядка после проверки базы: лишние права, порог остатка, город в заказе, недостающие внешние ключи.

-- ───────────────────────── 1. Лишние права ─────────────────────────

-- Без входа нужны только справочники городов и областей (страница регистрации). Остальное и так закрывали правила строк,
-- но права на запись и TRUNCATE (он правилам строк не подчиняется) у роли «без входа» не должны существовать вовсе.
revoke all on all tables in schema public from anon;
grant select on public.cities, public.regions to anon;

-- Вошедшему пользователю TRUNCATE, REFERENCES и TRIGGER не нужны никогда.
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Удалять строки напрямую можно только там, где на это есть правило: сотрудники, приглашения, точки, кассы,
-- категории, контрагенты, быстрые группы, товары магазина. Всё остальное удаляют только функции.
revoke delete on
  public.canceled_items, public.cash_ops, public.catalog_companies, public.catalog_products, public.cities,
  public.company_products, public.company_stock, public.company_stock_moves, public.company_variants,
  public.doc_payments, public.order_items, public.orders, public.org_counters, public.orgs, public.product_stock,
  public.profiles, public.regions, public.sale_items, public.sales, public.shifts, public.stock,
  public.stock_doc_items, public.stock_docs, public.stock_moves
from authenticated;

-- Новые таблицы получают права по умолчанию — убираем лишнее и оттуда.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- ───────────────────────── 2. Порог «мало на складе» — только для своих ─────────────────────────

-- Виды товара видят все магазины (это витрина), а порог остатка — внутреннее дело компании.
-- Правила строк не умеют прятать отдельный столбец, поэтому порог переезжает в свою таблицу.
alter table public.company_variants add constraint company_variants_id_org_key unique (id, org_id);

create table public.company_variant_limits (
  variant_id uuid primary key,
  org_id uuid not null references public.orgs on delete cascade,
  min_stock numeric(14, 3) not null check (min_stock >= 0),
  foreign key (variant_id, org_id) references public.company_variants (id, org_id) on delete cascade
);
create index company_variant_limits_org_idx on public.company_variant_limits (org_id);

insert into public.company_variant_limits (variant_id, org_id, min_stock)
select id, org_id, min_stock from public.company_variants where min_stock is not null;
alter table public.company_variants drop column min_stock;

alter table public.company_variant_limits enable row level security;
create policy member_read on public.company_variant_limits for select to authenticated
  using (org_id in (select app.my_orgs()));
create policy manager_insert on public.company_variant_limits for insert to authenticated
  with check (org_id in (select app.my_managed_orgs()));
create policy manager_update on public.company_variant_limits for update to authenticated
  using (org_id in (select app.my_managed_orgs())) with check (org_id in (select app.my_managed_orgs()));
create policy manager_delete on public.company_variant_limits for delete to authenticated
  using (org_id in (select app.my_managed_orgs()));
grant select, insert, update, delete on public.company_variant_limits to authenticated;

-- Товар со всеми видами одним сохранением: порог теперь пишется в свою таблицу.
-- p_product: {id, name, category, description, image_url}
-- p_variants: [{id, label, barcode, unit, price, pack_qty, image_url, active, track_stock, min_stock, stock: {филиал: остаток}}]
-- Виды товара, которых нет в списке, уходят в архив.
create or replace function public.save_company_product(p_org uuid, p_product jsonb, p_variants jsonb) returns uuid
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
end $$;

-- ───────────────────────── 3. Город в заказе и обязательный город точки ─────────────────────────

-- Заказ запоминает город магазина ссылкой, а не только текстом: если магазин переедет,
-- его прежние заказы в аналитике компании останутся в прежнем городе.
alter table public.orders add column store_city_id smallint references public.cities;
update public.orders o set store_city_id = s.city_id from public.stores s where s.id = o.store_id;
create index orders_city_idx on public.orders (supplier_org, store_city_id);

-- Город у торговой точки обязателен. Точки, заведённые до справочника городов, остаются как есть,
-- но при первой же правке попросят указать город.
alter table public.stores add constraint stores_city_required check (city_id is not null) not valid;

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
                      store_city_id, store_city, store_phone, branch_id, branch_name, comment, created_by)
  values (app.next_number(v_company.id, 'order'), v_company.id, v_store.org_id, v_store.id, v_company.name,
          (select name from orgs where id = v_store.org_id), v_store.name, v_store.address,
          v_store.city_id, coalesce((select name from cities where id = v_store.city_id), ''),
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

-- Аналитика берёт город из самого заказа, а не из сегодняшней карточки магазина.
-- sales:  [{city_id, product_id, store_org, qty, sum, orders}] — city_id null, если у точки города не было;
-- market: [{city_id, stores}] — сколько магазинов площадки работает в городе (только число, без названий).
create or replace function public.company_geo(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
        where o.supplier_org = p_org and o.status <> 'canceled'
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
end $$;

-- ───────────────────────── 4. Недостающие внешние ключи ─────────────────────────

-- «Кто сделал»: при удалении пользователя запись остаётся, ссылка обнуляется.
alter table public.canceled_items add constraint canceled_items_cashier_fkey foreign key (cashier_id) references auth.users on delete set null;
alter table public.cash_ops add constraint cash_ops_user_fkey foreign key (user_id) references auth.users on delete set null;
alter table public.company_api_keys add constraint company_api_keys_created_by_fkey foreign key (created_by) references auth.users on delete set null;
alter table public.company_stock_moves add constraint company_stock_moves_user_fkey foreign key (user_id) references auth.users on delete set null;
alter table public.doc_payments add constraint doc_payments_created_by_fkey foreign key (created_by) references auth.users on delete set null;
alter table public.orders add constraint orders_created_by_fkey foreign key (created_by) references auth.users on delete set null;
alter table public.stock_moves add constraint stock_moves_user_fkey foreign key (user_id) references auth.users on delete set null;

-- Строка чека помнит категорию и поставщика товара на момент продажи.
alter table public.sale_items add constraint sale_items_category_fkey foreign key (category_id) references public.categories on delete set null;
alter table public.sale_items add constraint sale_items_supplier_fkey foreign key (supplier_id) references public.contractors on delete set null;

-- Организация продублирована в дочерних строках ради быстрой проверки прав. Раньше её совпадение с родителем
-- держалось только на коде функций — теперь его гарантирует сама база.
alter table public.orders add constraint orders_id_parties_key unique (id, supplier_org, store_org);
alter table public.order_items add constraint order_items_parties_fkey
  foreign key (order_id, supplier_org, store_org) references public.orders (id, supplier_org, store_org) on delete cascade;

alter table public.company_branches add constraint company_branches_id_org_key unique (id, org_id);
alter table public.company_stock add constraint company_stock_variant_org_fkey
  foreign key (variant_id, org_id) references public.company_variants (id, org_id) on delete cascade;
alter table public.company_stock add constraint company_stock_branch_org_fkey
  foreign key (branch_id, org_id) references public.company_branches (id, org_id) on delete cascade;
alter table public.company_stock_moves add constraint company_stock_moves_variant_org_fkey
  foreign key (variant_id, org_id) references public.company_variants (id, org_id) on delete cascade;
alter table public.company_stock_moves add constraint company_stock_moves_branch_org_fkey
  foreign key (branch_id, org_id) references public.company_branches (id, org_id) on delete cascade;

alter table public.stores add constraint stores_id_org_key unique (id, org_id);
alter table public.products add constraint products_id_org_key unique (id, org_id);
alter table public.sales add constraint sales_id_org_key unique (id, org_id);
alter table public.stock_docs add constraint stock_docs_id_org_key unique (id, org_id);

alter table public.registers add constraint registers_store_org_fkey
  foreign key (store_id, org_id) references public.stores (id, org_id) on delete cascade;
alter table public.stock add constraint stock_store_org_fkey
  foreign key (store_id, org_id) references public.stores (id, org_id) on delete cascade;
alter table public.stock add constraint stock_product_org_fkey
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade;
alter table public.stock_moves add constraint stock_moves_store_org_fkey
  foreign key (store_id, org_id) references public.stores (id, org_id) on delete cascade;
alter table public.stock_moves add constraint stock_moves_product_org_fkey
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade;
alter table public.sale_items add constraint sale_items_sale_org_fkey
  foreign key (sale_id, org_id) references public.sales (id, org_id) on delete cascade;
alter table public.stock_doc_items add constraint stock_doc_items_doc_org_fkey
  foreign key (doc_id, org_id) references public.stock_docs (id, org_id) on delete cascade;

-- Прежние ключи по одному столбцу теперь лишние: составные проверяют то же самое и больше.
-- Оставлять оба нельзя ещё и потому, что API перестаёт понимать, по какой из двух связей соединять таблицы.
alter table public.order_items drop constraint order_items_order_id_fkey;
alter table public.company_stock drop constraint company_stock_variant_id_fkey, drop constraint company_stock_branch_id_fkey;
alter table public.company_stock_moves drop constraint company_stock_moves_variant_id_fkey, drop constraint company_stock_moves_branch_id_fkey;
alter table public.registers drop constraint registers_store_id_fkey;
alter table public.stock drop constraint stock_store_id_fkey, drop constraint stock_product_id_fkey;
alter table public.stock_moves drop constraint stock_moves_store_id_fkey, drop constraint stock_moves_product_id_fkey;
alter table public.sale_items drop constraint sale_items_sale_id_fkey;
alter table public.stock_doc_items drop constraint stock_doc_items_doc_id_fkey;

-- stock_moves.ref_id остаётся без ключа намеренно: это ссылка на чек, документ или заказ — в зависимости от причины.
