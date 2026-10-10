-- Демо без регистрации. Посетитель входит анонимно (Supabase anonymous sign-in) и получает свой демо-магазин
-- с товарами, остатками и продажами за две недели: можно открыть кассу, пробить чек, посмотреть отчёты.
-- Демо живёт 3 дня, потом удаляется вместе с анонимным пользователем (pg_cron).
-- Из демо нельзя ничего отправить наружу: заказы компаниям, запросы прайса, приглашения, Webkassa.
-- Цены компаний демо-магазину не видны: иначе анонимный вход обходил бы закрытые прайсы.

alter table public.orgs add column is_demo boolean not null default false;

create function app.is_anonymous() returns boolean
language sql stable as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $$;

-- Демо-магазин и анонимный вход не видят цен компаний.
create or replace function app.store_sees_prices(p_company uuid, p_store_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orgs where id = p_store_org and kind = 'store' and not is_demo)
    and (
      coalesce((select price_access from companies where org_id = p_company), 'stores') = 'stores'
      or exists (select 1 from company_store_access
                 where company_org = p_company and store_org = p_store_org and status = 'approved')
    )
$$;

-- Приглашения из демо не создаются: на чужую почту ничего не должно уходить от имени анонимного посетителя.
create function app.invites_no_demo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from orgs where id = new.org_id and is_demo) then
    raise exception 'В демо-режиме приглашать сотрудников нельзя: зарегистрируйтесь';
  end if;
  return new;
end $$;
create trigger invites_no_demo before insert on public.invites for each row execute function app.invites_no_demo();

-- Демо-магазин посетителя: создаётся один раз, повторный вызов возвращает уже созданный.
create function public.start_demo() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_store uuid;
  v_register uuid;
  v_city smallint := (select id from cities where name = 'Алматы' limit 1);
  v_cat uuid;
  v_sup uuid;
  v_group uuid;
  v_items jsonb;
  v_prod record;
  v_shift uuid;
  v_sale jsonb;
  v_day date;
  v_n int := 0;
  r record;
  v_pid uuid;
  i int;
begin
  if auth.uid() is null or not app.is_anonymous() then
    raise exception 'Демо открывается только без регистрации';
  end if;
  select m.org_id into v_org from org_members m where m.user_id = auth.uid() limit 1;
  if v_org is not null then
    return v_org;
  end if;

  -- create_org для анонимного входа разрешена только отсюда
  perform set_config('app.demo', '1', true);
  v_org := public.create_org('Демо-магазин', 'Магазин на Абая', 'store', 'grocery', v_city,
    jsonb_build_object('phone', '+7 701 000 00 00', 'address', 'пр. Абая, 10', 'contact_name', 'Демо'));
  update orgs set is_demo = true where id = v_org;
  select id into v_store from stores where org_id = v_org limit 1;
  select id into v_register from registers where org_id = v_org limit 1;

  insert into contractors (org_id, kind, name, phone) values
    (v_org, 'customer', 'Ержан (сосед)', ''), (v_org, 'customer', 'Кафе «Достар»', '+7 702 111 22 33');

  -- категория, поставщик и товары: [название, ед., закуп, продажа, остаток, мин. остаток]
  for r in
    select * from (values
      ('Напитки', 'ТОО «Напитки Азии»', '[["Вода питьевая 0,5 л","шт",90,150,240,30],["Вода питьевая 1,5 л","шт",160,250,180,24],["Газировка кола 1 л","шт",540,710,120,12],["Сок яблочный 1 л","шт",520,720,60,10],["Энергетик 0,45 л","шт",455,600,72,12]]'),
      ('Выпечка', 'ИП Пекарня', '[["Хлеб пшеничный","шт",120,140,40,15],["Батон нарезной","шт",230,255,30,10],["Лепёшка тандырная","шт",140,170,35,10],["Самса с мясом","шт",250,400,20,null]]'),
      ('Молочные продукты', 'ТОО «Молочный двор»', '[["Молоко 3,2% 1 л","шт",430,560,48,12],["Кефир 2,5% 1 л","шт",410,540,36,10],["Сметана 20% 400 г","шт",620,790,24,null],["Сыр твёрдый","кг",3900,5200,12,null]]'),
      ('Снеки и сладости', 'ТОО «Сладкий мир»', '[["Чипсы картофельные 80 г","шт",390,540,80,15],["Шоколад молочный 90 г","шт",480,690,70,10],["Печенье овсяное 300 г","шт",520,720,40,null],["Жвачка мятная","шт",160,250,150,null]]'),
      ('Овощи и фрукты', 'КХ «Жетысу»', '[["Картофель","кг",150,200,300,40],["Лук репчатый","кг",120,180,120,20],["Яблоки","кг",500,800,60,10],["Бананы","кг",720,990,45,10]]'),
      ('Хозтовары', 'ТОО «Быт-Опт»', '[["Туалетная бумага","шт",56,100,200,30],["Пакет-майка","шт",8,20,500,100],["Средство для посуды 500 мл","шт",650,890,3,5]]')
    ) as t(category, supplier, items)
  loop
    insert into categories (org_id, name) values (v_org, r.category) returning id into v_cat;
    insert into contractors (org_id, kind, name) values (v_org, 'supplier', r.supplier) returning id into v_sup;
    v_group := null;
    if r.category in ('Выпечка', 'Овощи и фрукты') then
      insert into quick_groups (org_id, name, sort) values (v_org, r.category, v_n) returning id into v_group;
    end if;
    v_items := '[]'::jsonb;
    for v_prod in select * from jsonb_array_elements(r.items::jsonb) as e(x) loop
      v_n := v_n + 1;
      insert into products (org_id, name, unit, barcode, category_id, supplier_id, purchase_price, sale_price, min_stock, quick_group_id)
      values (v_org, v_prod.x ->> 0, v_prod.x ->> 1,
              case when v_prod.x ->> 1 = 'кг' then '21' || lpad(v_n::text, 5, '0') || '000000' else '4870' || lpad(v_n::text, 9, '0') end,
              v_cat, v_sup, (v_prod.x ->> 2)::numeric, (v_prod.x ->> 3)::numeric, nullif(v_prod.x ->> 5, '')::numeric, v_group)
      returning id into v_pid;
      v_items := v_items || jsonb_build_object('product_id', v_pid, 'qty', (v_prod.x ->> 4)::numeric, 'price', (v_prod.x ->> 2)::numeric);
    end loop;
    perform public.post_stock_doc(v_store, 'supply', 'Начальный остаток', v_items, v_sup, null);
  end loop;

  -- продажи за две недели: каждый день смена и 6–14 чеков из 1–3 позиций
  for i in reverse 13..1 loop
    -- дни считаются по Алматы: иначе вечером «вчера» по UTC ещё сегодня, и последний день остаётся пустым
    v_day := (now() at time zone 'Asia/Almaty')::date - i;
    v_shift := public.open_shift(v_register, 10000);
    for r in select g from generate_series(1, 6 + floor(random() * 9)::int) g loop
      select jsonb_agg(jsonb_build_object('product_id', p.id, 'qty', case when p.unit = 'кг' then round((0.5 + random())::numeric, 1) else 1 + floor(random() * 2) end))
      into v_items
      from (select id, unit from products where org_id = v_org order by random() limit 1 + floor(random() * 3)::int) p;
      v_sale := public.create_sale(v_shift, v_items, 0, null, '', null);
      if random() < 0.4 then
        update sales set paid_card = total, paid_cash = 0 where id = (v_sale ->> 'id')::uuid;
      end if;
      update sales set created_at = (v_day + time '09:00' + (r.g * interval '47 minutes')) at time zone 'Asia/Almaty'
      where id = (v_sale ->> 'id')::uuid;
    end loop;
    perform public.close_shift(v_shift, null);
    update shifts set opened_at = (v_day + time '08:30') at time zone 'Asia/Almaty', closed_at = (v_day + time '21:00') at time zone 'Asia/Almaty'
    where id = v_shift;
  end loop;
  -- сегодня касса открыта: можно сразу пробить чек
  perform public.open_shift(v_register, 10000);
  return v_org;
end $$;

-- Удаление демо старше 3 дней вместе с анонимными пользователями.
create function app.cleanup_demo() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from orgs where is_demo and created_at < now() - interval '3 days';
  delete from auth.users u
  where u.is_anonymous and u.created_at < now() - interval '3 days'
    and not exists (select 1 from org_members m where m.user_id = u.id);
end $$;

revoke all on function app.cleanup_demo() from public;
revoke all on function app.invites_no_demo() from public;
revoke all on function public.start_demo() from public, anon;
grant execute on function public.start_demo() to authenticated;

create extension if not exists pg_cron;
select cron.schedule('sauda-demo-cleanup', '17 * * * *', 'select app.cleanup_demo()');

-- Анонимный вход: только демо.
create or replace function public.create_org(p_name text, p_store text DEFAULT ''::text, p_kind text DEFAULT 'store'::text, p_business text DEFAULT 'grocery'::text, p_city smallint DEFAULT NULL::smallint, p_profile jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- анонимный вход заводит только демо-магазин (start_demo), а не настоящий магазин или компанию
  if app.is_anonymous() and current_setting('app.demo', true) is distinct from '1' then
    raise exception 'Чтобы завести свой магазин или компанию, зарегистрируйтесь';
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
end $function$;

-- Из демо ничего не уходит наружу.
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
  if exists (select 1 from orgs where id = v_store.org_id and is_demo) then
    raise exception 'Из демо-магазина заказы компаниям не отправляются: зарегистрируйтесь';
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

create or replace function public.request_price_access(p_company uuid, p_store_org uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  if not app.is_manager(p_store_org) or not exists (select 1 from orgs where id = p_store_org and kind = 'store') then
    raise exception 'Нет доступа';
  end if;
  if not exists (select 1 from companies where org_id = p_company) then
    raise exception 'Компания не найдена';
  end if;
  if exists (select 1 from orgs where id = p_store_org and is_demo) then
    raise exception 'Из демо-магазина прайс не запрашивается: зарегистрируйтесь';
  end if;
  insert into company_store_access (company_org, store_org, requested_by)
  values (p_company, p_store_org, auth.uid())
  on conflict (company_org, store_org) do update
  set status = 'pending', requested_by = auth.uid(), requested_at = now(), decided_by = null, decided_at = null
  where company_store_access.status = 'declined'
  returning status into v_status;
  return coalesce(v_status, (select status from company_store_access where company_org = p_company and store_org = p_store_org));
end $function$;

create or replace function public.set_register_fiscal(p_register uuid, p_cashbox text, p_login text, p_password text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reg registers%rowtype;
  v_cur register_fiscal%rowtype;
  v_secret uuid;
begin
  select * into v_reg from registers where id = p_register;
  if not found or not app.is_manager(v_reg.org_id) then
    raise exception 'Нет доступа';
  end if;
  if exists (select 1 from orgs where id = v_reg.org_id and is_demo) then
    raise exception 'В демо-режиме Webkassa не подключается';
  end if;
  if coalesce(trim(p_cashbox), '') = '' or coalesce(trim(p_login), '') = '' then
    raise exception 'Укажите номер кассы и логин Webkassa';
  end if;

  select * into v_cur from register_fiscal where register_id = p_register;
  if coalesce(p_password, '') <> '' then
    if found then
      perform vault.update_secret(v_cur.password_secret, p_password);
      v_secret := v_cur.password_secret;
    else
      v_secret := vault.create_secret(p_password, 'webkassa:' || p_register::text, 'Пароль кассира Webkassa');
    end if;
  elsif found then
    v_secret := v_cur.password_secret;
  else
    raise exception 'Укажите пароль кассира Webkassa';
  end if;

  insert into register_fiscal (register_id, org_id, enabled, cashbox, login, password_secret)
  values (p_register, v_reg.org_id, coalesce(p_enabled, false), trim(p_cashbox), trim(p_login), v_secret)
  on conflict (register_id) do update
  set enabled = excluded.enabled, cashbox = excluded.cashbox, login = excluded.login,
      password_secret = excluded.password_secret, updated_at = now();
end $function$;
