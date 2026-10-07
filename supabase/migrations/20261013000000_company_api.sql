-- API для учётных систем компаний (1С и другие): остатки и цены приходят из учётной системы без входа человека.
--
-- Запрос: POST <адрес проекта>/rest/v1/rpc/<функция>
--   apikey: <публичный ключ проекта>      — тот же, что у сайта
--   X-Sauda-Key: <ключ компании>          — выдаётся владельцу в профиле компании и показывается один раз
-- Функции: api_ping, api_branches, api_catalog, api_stock.

-- ───────────────────────── Ключи ─────────────────────────

-- Сам ключ не хранится — только его sha256: утечка таблицы не даёт доступа к API.
create table public.company_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null check (trim(name) <> ''),
  key_hash text not null unique,
  -- начало ключа: по нему владелец отличает ключи в списке
  prefix text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index company_api_keys_org_idx on public.company_api_keys (org_id, created_at);

-- Ключи видит только владелец; заводит и отзывает их функциями ниже.
alter table public.company_api_keys enable row level security;
create policy owner_read on public.company_api_keys for select to authenticated using (app.is_owner(org_id));
revoke all on public.company_api_keys from anon, authenticated;
grant select (id, org_id, name, prefix, created_at, last_used_at, revoked_at) on public.company_api_keys to authenticated;

create function app.hash_api_key(p_key text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
$$;

-- Возвращает ключ целиком. Второй раз его узнать нельзя.
create function public.create_api_key(p_org uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if not app.is_owner(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Укажите название ключа';
  end if;
  if (select count(*) from company_api_keys where org_id = p_org and revoked_at is null) >= 10 then
    raise exception 'Слишком много ключей: отзовите ненужные';
  end if;
  v_key := 'sauda_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into company_api_keys (org_id, name, key_hash, prefix)
  values (p_org, trim(p_name), app.hash_api_key(v_key), left(v_key, 12));
  return v_key;
end $$;

create function public.revoke_api_key(p_key uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from company_api_keys where id = p_key;
  if not found or not app.is_owner(v_org) then
    raise exception 'Нет доступа';
  end if;
  update company_api_keys set revoked_at = now() where id = p_key and revoked_at is null;
end $$;

-- Компания, от имени которой пришёл запрос: по заголовку X-Sauda-Key.
create function app.api_org() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_key text := coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-sauda-key';
  v_id uuid;
  v_org uuid;
begin
  if coalesce(v_key, '') = '' then
    raise exception 'Не передан ключ: заголовок X-Sauda-Key' using errcode = '28000';
  end if;
  select id, org_id into v_id, v_org from company_api_keys
  where key_hash = app.hash_api_key(v_key) and revoked_at is null;
  if not found then
    raise exception 'Ключ неверный или отозван' using errcode = '28000';
  end if;
  -- не чаще раза в минуту: частые запросы не должны превращаться в частые записи
  update company_api_keys set last_used_at = now()
  where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return v_org;
end $$;

-- ───────────────────────── Склад: откуда пришло изменение ─────────────────────────

alter table public.company_stock_moves drop constraint company_stock_moves_reason_check;
alter table public.company_stock_moves add constraint company_stock_moves_reason_check
  check (reason in ('adjust', 'import', 'shipment', 'api'));

-- ───────────────────────── Запросы ─────────────────────────

-- Проверка связи и ключа.
create function public.api_ping() returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'company', o.name, 'time', now())
  from orgs o where o.id = app.api_org()
$$;

-- Филиалы компании: их id передаются в api_stock как склад.
create function public.api_branches() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'city', c.name, 'address', b.address, 'is_main', b.is_main
  ) order by b.is_main desc, b.created_at), '[]'::jsonb)
  from company_branches b join cities c on c.id = b.city_id
  where b.org_id = app.api_org()
$$;

-- Каталог компании, как он лежит в Sauda: чтобы учётная система сверила штрихкоды, цены и остатки.
create function public.api_catalog() returns jsonb
language sql security definer set search_path = public as $$
  with me as (select app.api_org() as org)
  select coalesce(jsonb_agg(jsonb_build_object(
    'barcode', v.barcode, 'name', p.name, 'label', v.label, 'unit', v.unit, 'category', p.category,
    'price', v.price, 'pack_qty', v.pack_qty, 'active', v.active,
    'stock', case when v.track_stock then coalesce((
      select jsonb_object_agg(s.branch_id, s.qty) from company_stock s where s.variant_id = v.id), '{}'::jsonb) end
  ) order by p.name, v.sort, v.barcode), '[]'::jsonb)
  from me
  join company_variants v on v.org_id = me.org and not v.archived
  join company_products p on p.id = v.product_id and not p.archived
$$;

-- Остатки и цены из учётной системы. Товар ищется по штрихкоду.
-- items: [{barcode, price, stock, active, name, label, unit, category, pack_qty}] — обязателен только barcode.
--   price, stock, active — что передано, то и меняется; чего нет в строке, остаётся как было;
--   name — нужен только для товара, которого ещё нет в каталоге: с ним он будет создан, без него попадёт в not_found.
-- branch — склад для остатков (id из api_branches); без него остатки ставятся на главный филиал.
-- Ответ: {updated, created, not_found: [штрихкоды], errors: [{barcode, error}]}.
create function public.api_stock(items jsonb, branch uuid default null) returns jsonb
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
      insert into company_variants (org_id, product_id, label, barcode, unit, price, pack_qty, active)
      values (v_org, v_product, coalesce(trim(v_row.label), ''), v_barcode,
              case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit else 'шт' end,
              coalesce(v_row.price, 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
              coalesce(v_row.active, true))
      returning * into v_var;
      v_created := v_created + 1;
    else
      update company_variants v
      set price = coalesce(v_row.price, v.price), active = coalesce(v_row.active, v.active)
      where v.id = v_var.id;
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

revoke all on function public.create_api_key(uuid, text), public.revoke_api_key(uuid) from public, anon;
grant execute on function public.create_api_key(uuid, text), public.revoke_api_key(uuid) to authenticated;
-- запросы учётной системы приходят без входа: доступ определяет только ключ компании
revoke all on function app.api_org(), app.hash_api_key(text) from public, anon, authenticated;
grant execute on function public.api_ping(), public.api_branches(), public.api_catalog(), public.api_stock(jsonb, uuid)
  to anon, authenticated;
