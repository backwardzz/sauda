-- Связка магазинов и поставщиков: компании-поставщики с каталогами, заказы магазинов,
-- подтверждение и отгрузка поставщиком, приёмка заказа в один шаг (черновик приёмки без фото накладной).

alter table public.orgs
  add column kind text not null default 'store' check (kind in ('store', 'supplier')),
  add column description text not null default '',
  add column phone text not null default '',
  add column min_order numeric(14, 2) not null default 0 check (min_order >= 0),
  add column delivery_note text not null default '';

-- Поставщиков видят все вошедшие пользователи: это витрина. Магазины видны только своим участникам.
create policy supplier_public on public.orgs for select to authenticated using (kind = 'supplier');

-- Контрагент-поставщик магазина может быть привязан к компании-поставщику на площадке.
alter table public.contractors add column partner_org_id uuid references public.orgs on delete set null;

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  barcode text not null,
  unit text not null default 'шт' check (unit in ('шт', 'кг', 'л', 'м')),
  category text not null default '',
  price numeric(14, 2) not null default 0 check (price >= 0),
  -- кратность заказа: товар отпускается упаковками по pack_qty
  pack_qty numeric(14, 3) not null default 1 check (pack_qty > 0),
  available boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index supplier_products_barcode_uq on public.supplier_products (org_id, barcode) where not archived;
create index supplier_products_org_idx on public.supplier_products (org_id, archived);
create trigger supplier_products_touch before update on public.supplier_products
  for each row execute function app.touch_updated_at();

alter table public.supplier_products enable row level security;
create policy catalog_read on public.supplier_products for select to authenticated
  using (not archived or org_id in (select app.my_orgs()));
create policy manager_insert on public.supplier_products for insert to authenticated
  with check (org_id in (select app.my_managed_orgs()));
create policy manager_update on public.supplier_products for update to authenticated
  using (org_id in (select app.my_managed_orgs())) with check (org_id in (select app.my_managed_orgs()));
create policy manager_delete on public.supplier_products for delete to authenticated
  using (org_id in (select app.my_managed_orgs()));

-- Заказ хранит названия сторон на момент оформления: поставщик не имеет доступа к данным магазина.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number int not null,
  supplier_org uuid not null references public.orgs on delete cascade,
  store_org uuid not null references public.orgs on delete cascade,
  store_id uuid not null references public.stores on delete cascade,
  status text not null default 'new' check (status in ('new', 'confirmed', 'shipped', 'received', 'canceled')),
  supplier_name text not null,
  store_org_name text not null,
  store_name text not null,
  store_address text not null default '',
  comment text not null default '',
  supplier_comment text not null default '',
  total numeric(14, 2) not null default 0,
  supply_doc uuid references public.stock_docs on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz
);
create index orders_supplier_idx on public.orders (supplier_org, created_at desc);
create index orders_store_idx on public.orders (store_org, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  supplier_org uuid not null,
  store_org uuid not null,
  supplier_product_id uuid references public.supplier_products on delete set null,
  name text not null,
  barcode text not null,
  unit text not null,
  qty numeric(14, 3) not null check (qty > 0),
  -- сколько поставщик реально отгружает; null — столько же, сколько заказано
  qty_shipped numeric(14, 3) check (qty_shipped >= 0),
  price numeric(14, 2) not null
);
create index order_items_order_idx on public.order_items (order_id);

alter table public.orders enable row level security;
create policy party_read on public.orders for select to authenticated
  using (supplier_org in (select app.my_orgs()) or store_org in (select app.my_orgs()));
alter table public.order_items enable row level security;
create policy party_read on public.order_items for select to authenticated
  using (supplier_org in (select app.my_orgs()) or store_org in (select app.my_orgs()));

-- ───────────────────────── Регистрация компании: магазин или поставщик ─────────────────────────

drop function public.create_org(text, text);
create function public.create_org(p_name text, p_store text default 'Основной магазин', p_kind text default 'store')
returns uuid
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

  insert into orgs (name, kind) values (trim(p_name), p_kind) returning id into v_org;
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

-- ───────────────────────── Каталог поставщика из Excel ─────────────────────────
-- p_rows: [{name, barcode, unit, price, category, pack_qty}]
create function public.import_supplier_products(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_id uuid;
  v_unit text;
  v_created int := 0;
  v_updated int := 0;
begin
  if not app.is_manager(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'supplier') then
    raise exception 'Нет доступа';
  end if;
  for v_row in
    select * from jsonb_to_recordset(p_rows) as x(name text, barcode text, unit text, price numeric, category text, pack_qty numeric)
  loop
    continue when coalesce(trim(v_row.name), '') = '' or coalesce(trim(v_row.barcode), '') = '';
    v_unit := case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit end;
    select id into v_id from supplier_products where org_id = p_org and barcode = trim(v_row.barcode) and not archived;
    if v_id is null then
      insert into supplier_products (org_id, name, barcode, unit, category, price, pack_qty)
      values (p_org, trim(v_row.name), trim(v_row.barcode), coalesce(v_unit, 'шт'), coalesce(trim(v_row.category), ''),
              greatest(coalesce(v_row.price, 0), 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end);
      v_created := v_created + 1;
    else
      update supplier_products set
        name = trim(v_row.name),
        unit = coalesce(v_unit, unit),
        category = coalesce(nullif(trim(v_row.category), ''), category),
        price = coalesce(greatest(v_row.price, 0), price),
        pack_qty = case when v_row.pack_qty > 0 then v_row.pack_qty else pack_qty end
      where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end $$;

-- ───────────────────────── Заказ ─────────────────────────
-- p_items: [{product_id, qty}] — товары каталога поставщика
create function public.place_order(p_store uuid, p_supplier uuid, p_items jsonb, p_comment text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_store stores%rowtype;
  v_sup orgs%rowtype;
  v_order uuid;
  v_item record;
  v_prod supplier_products%rowtype;
  v_total numeric := 0;
begin
  select * into v_store from stores where id = p_store;
  if not found or not app.is_manager(v_store.org_id) then
    raise exception 'Нет доступа';
  end if;
  select * into v_sup from orgs where id = p_supplier and kind = 'supplier';
  if not found then
    raise exception 'Поставщик не найден';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Корзина пуста';
  end if;

  insert into orders (number, supplier_org, store_org, store_id, supplier_name, store_org_name, store_name, store_address,
                      comment, created_by)
  values (app.next_number(v_sup.id, 'order'), v_sup.id, v_store.org_id, v_store.id, v_sup.name,
          (select name from orgs where id = v_store.org_id), v_store.name, v_store.address, coalesce(p_comment, ''), auth.uid())
  returning id into v_order;

  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid, qty numeric) loop
    select * into v_prod from supplier_products where id = v_item.product_id and org_id = v_sup.id and not archived;
    if not found then
      raise exception 'Товара больше нет в каталоге поставщика';
    end if;
    if not v_prod.available then
      raise exception 'Товара нет в наличии: %', v_prod.name;
    end if;
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'Количество должно быть больше нуля: %', v_prod.name;
    end if;
    insert into order_items (order_id, supplier_org, store_org, supplier_product_id, name, barcode, unit, qty, price)
    values (v_order, v_sup.id, v_store.org_id, v_prod.id, v_prod.name, v_prod.barcode, v_prod.unit, v_item.qty, v_prod.price);
    v_total := v_total + round(v_item.qty * v_prod.price, 2);
  end loop;

  if v_total < v_sup.min_order then
    raise exception 'Минимальная сумма заказа у поставщика — %', v_sup.min_order;
  end if;
  update orders set total = v_total where id = v_order;
  return v_order;
end $$;

-- Поставщик: new → confirmed (можно уменьшить количества: p_items [{item_id, qty}]) → shipped; отмена до отгрузки.
-- Магазин: может отменить только новый заказ.
create function public.set_order_status(
  p_order uuid, p_status text, p_items jsonb default null, p_comment text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v orders%rowtype;
  v_supplier boolean;
  v_item record;
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

-- Приёмка отгруженного заказа: черновик приёмки в магазине. Товары ищутся по штрихкоду
-- (основному или дополнительному), недостающие создаются с закупочной ценой из заказа.
create function public.receive_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v orders%rowtype;
  v_contractor uuid;
  v_doc uuid;
  v_item record;
  v_prod uuid;
begin
  select * into v from orders where id = p_order for update;
  if not found or not app.is_manager(v.store_org) then
    raise exception 'Нет доступа';
  end if;
  if v.status <> 'shipped' then
    raise exception 'Принять можно только отгруженный заказ';
  end if;

  select id into v_contractor from contractors
  where org_id = v.store_org and kind = 'supplier'
    and (partner_org_id = v.supplier_org or lower(name) = lower(v.supplier_name))
  order by (partner_org_id = v.supplier_org) desc nulls last limit 1;
  if v_contractor is null then
    insert into contractors (org_id, kind, name, partner_org_id)
    values (v.store_org, 'supplier', v.supplier_name, v.supplier_org) returning id into v_contractor;
  else
    update contractors set partner_org_id = v.supplier_org where id = v_contractor and partner_org_id is null;
  end if;

  v_doc := public.create_stock_doc(v.store_id, 'supply', 'Заказ № ' || v.number || ' у ' || v.supplier_name, v_contractor);

  for v_item in
    select * from order_items where order_id = v.id and coalesce(qty_shipped, qty) > 0 order by name
  loop
    select id into v_prod from products
    where org_id = v.store_org and not archived and kind = 'product'
      and (barcode = v_item.barcode or v_item.barcode = any(extra_barcodes))
    order by (barcode = v_item.barcode) desc limit 1;
    if v_prod is null then
      insert into products (org_id, name, unit, barcode, supplier_id, purchase_price)
      values (v.store_org, v_item.name, v_item.unit, v_item.barcode, v_contractor, v_item.price)
      returning id into v_prod;
    end if;
    insert into stock_doc_items (doc_id, org_id, product_id, qty, price)
    values (v_doc, v.store_org, v_prod, coalesce(v_item.qty_shipped, v_item.qty), v_item.price)
    on conflict (doc_id, product_id) do update set qty = stock_doc_items.qty + excluded.qty;
  end loop;

  update orders set status = 'received', received_at = now(), supply_doc = v_doc where id = v.id;
  return v_doc;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
