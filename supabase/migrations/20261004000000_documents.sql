-- Складские документы с черновиками: приёмка от поставщика, перемещение между магазинами, инвентаризация.
-- Документ создаётся черновиком, строки сохраняются по одной, остатки меняет только проведение.

alter table public.stock_docs
  add column status text not null default 'posted' check (status in ('draft', 'posted')),
  add column supplier_id uuid references public.contractors on delete set null,
  add column to_store_id uuid references public.stores,
  add column paid numeric(14, 2) not null default 0 check (paid >= 0);

alter table public.stock_docs drop constraint stock_docs_kind_check;
alter table public.stock_docs add constraint stock_docs_kind_check
  check (kind in ('posting', 'writeoff', 'supply', 'transfer', 'inventory'));
create index stock_docs_to_store_idx on public.stock_docs (to_store_id) where to_store_id is not null;

-- qty в инвентаризации — фактическое количество; expected — учётный остаток в момент проведения.
alter table public.stock_doc_items
  add column sale_price numeric(14, 2) check (sale_price >= 0),
  add column expected numeric(14, 3),
  add column updated_at timestamptz not null default now(),
  add constraint stock_doc_items_doc_product_uq unique (doc_id, product_id);

alter table public.stock_moves drop constraint stock_moves_reason_check;
alter table public.stock_moves add constraint stock_moves_reason_check
  check (reason in ('posting', 'writeoff', 'sale', 'return', 'supply', 'transfer_out', 'transfer_in', 'inventory'));

create table public.doc_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  doc_id uuid not null references public.stock_docs on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  comment text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index doc_payments_doc_idx on public.doc_payments (doc_id);
alter table public.doc_payments enable row level security;
create policy member_read on public.doc_payments for select to authenticated
  using (org_id in (select app.my_orgs()));

-- ───────────────────────── Черновик ─────────────────────────

-- Черновик под блокировкой: проверяет права и то, что документ ещё не проведён.
create function app.draft_doc(p_doc uuid) returns public.stock_docs
language plpgsql security definer set search_path = public as $$
declare
  v stock_docs%rowtype;
begin
  select * into v from stock_docs where id = p_doc for update;
  if not found or not app.is_manager(v.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v.status <> 'draft' then
    raise exception 'Документ уже проведён';
  end if;
  return v;
end $$;

create function app.check_doc_refs(p_org uuid, p_store uuid, p_supplier uuid, p_to_store uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_supplier is not null and not exists (
    select 1 from contractors where id = p_supplier and org_id = p_org and kind = 'supplier'
  ) then
    raise exception 'Поставщик не найден';
  end if;
  if p_to_store is not null then
    if not exists (select 1 from stores where id = p_to_store and org_id = p_org) then
      raise exception 'Магазин не найден';
    end if;
    if p_to_store = p_store then
      raise exception 'Выберите другой магазин: перемещать можно только между разными точками';
    end if;
  end if;
end $$;

create function public.create_stock_doc(
  p_store uuid, p_kind text, p_comment text default '', p_supplier uuid default null, p_to_store uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_doc uuid;
begin
  select org_id into v_org from stores where id = p_store;
  if v_org is null or not app.is_manager(v_org) then
    raise exception 'Нет доступа';
  end if;
  if p_kind not in ('posting', 'writeoff', 'supply', 'transfer', 'inventory') then
    raise exception 'Неизвестный тип документа';
  end if;
  perform app.check_doc_refs(v_org, p_store, p_supplier, p_to_store);

  insert into stock_docs (org_id, store_id, kind, number, status, comment, supplier_id, to_store_id, created_by)
  values (v_org, p_store, p_kind, app.next_number(v_org, p_kind), 'draft', coalesce(p_comment, ''),
          case when p_kind = 'supply' then p_supplier end,
          case when p_kind = 'transfer' then p_to_store end,
          auth.uid())
  returning id into v_doc;
  return v_doc;
end $$;

create function public.update_stock_doc(
  p_doc uuid, p_comment text, p_supplier uuid default null, p_to_store uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v stock_docs%rowtype;
begin
  v := app.draft_doc(p_doc);
  perform app.check_doc_refs(v.org_id, v.store_id, p_supplier, p_to_store);
  update stock_docs
  set comment = coalesce(p_comment, ''),
      supplier_id = case when v.kind = 'supply' then p_supplier end,
      to_store_id = case when v.kind = 'transfer' then p_to_store end
  where id = p_doc;
end $$;

-- Строка черновика: p_qty = null убирает товар из документа.
create function public.set_stock_doc_item(
  p_doc uuid, p_product uuid, p_qty numeric, p_price numeric default null, p_sale_price numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v stock_docs%rowtype;
  v_prod products%rowtype;
  v_price numeric;
begin
  v := app.draft_doc(p_doc);
  if p_qty is null then
    delete from stock_doc_items where doc_id = p_doc and product_id = p_product;
    return;
  end if;

  select * into v_prod from products where id = p_product and org_id = v.org_id;
  if not found then
    raise exception 'Товар не найден';
  end if;
  if v_prod.kind <> 'product' then
    raise exception 'Услуги не учитываются на складе: %', v_prod.name;
  end if;
  if v.kind = 'inventory' then
    if p_qty < 0 then
      raise exception 'Количество не может быть отрицательным: %', v_prod.name;
    end if;
  elsif p_qty <= 0 then
    raise exception 'Количество должно быть больше нуля: %', v_prod.name;
  end if;

  -- цену задаёт документ только там, где товар приходит; в остальных берётся закупочная из карточки
  v_price := case when v.kind in ('posting', 'supply') then coalesce(p_price, v_prod.purchase_price)
                  else v_prod.purchase_price end;
  if v_price < 0 or coalesce(p_sale_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной: %', v_prod.name;
  end if;

  insert into stock_doc_items (doc_id, org_id, product_id, qty, price, sale_price)
  values (p_doc, v.org_id, p_product, p_qty, v_price, case when v.kind = 'supply' then p_sale_price end)
  on conflict (doc_id, product_id) do update
    set qty = excluded.qty, price = excluded.price, sale_price = excluded.sale_price, updated_at = now();
end $$;

create function public.delete_stock_doc(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.draft_doc(p_doc);
  delete from stock_docs where id = p_doc;
end $$;

-- ───────────────────────── Проведение ─────────────────────────

-- p_zero_missing — полная инвентаризация: товары с остатком, которых нет в документе, считаются отсутствующими.
create function public.post_stock_doc_draft(p_doc uuid, p_zero_missing boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v stock_docs%rowtype;
  v_item record;
  v_current numeric;
  v_total numeric := 0;
begin
  v := app.draft_doc(p_doc);
  if v.kind = 'supply' and v.supplier_id is null then
    raise exception 'Укажите поставщика';
  end if;
  if v.kind = 'transfer' and v.to_store_id is null then
    raise exception 'Укажите магазин, в который перемещается товар';
  end if;

  if v.kind = 'inventory' and p_zero_missing then
    insert into stock_doc_items (doc_id, org_id, product_id, qty, price)
    select v.id, v.org_id, st.product_id, 0, p.purchase_price
    from stock st
    join products p on p.id = st.product_id
    where st.store_id = v.store_id and st.qty <> 0 and p.kind = 'product' and not p.archived
    on conflict (doc_id, product_id) do nothing;
  end if;
  if not exists (select 1 from stock_doc_items where doc_id = v.id) then
    raise exception 'Добавьте товары в документ';
  end if;

  for v_item in
    select i.id, i.product_id, i.qty, i.price, i.sale_price, p.purchase_price as card_price
    from stock_doc_items i
    join products p on p.id = i.product_id
    where i.doc_id = v.id
    order by i.id
  loop
    if v.kind = 'posting' then
      perform app.move_stock(v.org_id, v.store_id, v_item.product_id, v_item.qty, 'posting', v.id, v.number);
      update products set purchase_price = v_item.price
      where id = v_item.product_id and purchase_price <> v_item.price;
      v_total := v_total + round(v_item.qty * v_item.price, 2);

    elsif v.kind = 'supply' then
      perform app.move_stock(v.org_id, v.store_id, v_item.product_id, v_item.qty, 'supply', v.id, v.number);
      update products
      set purchase_price = v_item.price,
          sale_price = coalesce(v_item.sale_price, sale_price),
          supplier_id = coalesce(supplier_id, v.supplier_id)
      where id = v_item.product_id;
      v_total := v_total + round(v_item.qty * v_item.price, 2);

    elsif v.kind = 'writeoff' then
      perform app.move_stock(v.org_id, v.store_id, v_item.product_id, -v_item.qty, 'writeoff', v.id, v.number);
      update stock_doc_items set price = v_item.card_price where id = v_item.id;
      v_total := v_total + round(v_item.qty * v_item.card_price, 2);

    elsif v.kind = 'transfer' then
      perform app.move_stock(v.org_id, v.store_id, v_item.product_id, -v_item.qty, 'transfer_out', v.id, v.number);
      perform app.move_stock(v.org_id, v.to_store_id, v_item.product_id, v_item.qty, 'transfer_in', v.id, v.number);
      update stock_doc_items set price = v_item.card_price where id = v_item.id;
      v_total := v_total + round(v_item.qty * v_item.card_price, 2);

    else
      -- инвентаризация: остаток приводится к фактическому, сумма документа — излишки минус недостача
      v_current := coalesce((select qty from stock where store_id = v.store_id and product_id = v_item.product_id), 0);
      update stock_doc_items set expected = v_current, price = v_item.card_price where id = v_item.id;
      if v_item.qty <> v_current then
        perform app.move_stock(v.org_id, v.store_id, v_item.product_id, v_item.qty - v_current, 'inventory', v.id, v.number);
      end if;
      v_total := v_total + round((v_item.qty - v_current) * v_item.card_price, 2);
    end if;
  end loop;

  update stock_docs set status = 'posted', total = v_total, created_at = now() where id = v.id;
  return v.id;
end $$;

-- Документ одним вызовом: черновик, строки и проведение. p_items: [{product_id, qty, price, sale_price}]
drop function public.post_stock_doc(uuid, text, text, jsonb);
create function public.post_stock_doc(
  p_store uuid, p_kind text, p_comment text, p_items jsonb,
  p_supplier uuid default null, p_to_store uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_doc uuid;
  v_item record;
begin
  v_doc := public.create_stock_doc(p_store, p_kind, p_comment, p_supplier, p_to_store);
  for v_item in
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(product_id uuid, qty numeric, price numeric, sale_price numeric)
  loop
    if v_item.qty is null then
      raise exception 'Укажите количество';
    end if;
    perform public.set_stock_doc_item(v_doc, v_item.product_id, v_item.qty, v_item.price, v_item.sale_price);
  end loop;
  perform public.post_stock_doc_draft(v_doc);
  return v_doc;
end $$;

create function public.pay_supply(p_doc uuid, p_amount numeric, p_comment text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v stock_docs%rowtype;
  v_id uuid;
begin
  select * into v from stock_docs where id = p_doc for update;
  if not found or not app.is_manager(v.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v.kind <> 'supply' or v.status <> 'posted' then
    raise exception 'Платёж можно внести только по проведённой приёмке';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Укажите сумму';
  end if;
  if p_amount > v.total - v.paid then
    raise exception 'Сумма платежа больше остатка долга';
  end if;

  insert into doc_payments (org_id, doc_id, amount, comment, created_by)
  values (v.org_id, v.id, p_amount, coalesce(p_comment, ''), auth.uid())
  returning id into v_id;
  update stock_docs set paid = paid + p_amount where id = v.id;
  return v_id;
end $$;

-- Строки документа вместе с карточкой товара и текущим остатком в магазине документа.
create function public.stock_doc_lines(p_doc uuid)
returns table (
  product_id uuid, name text, barcode text, unit text, qty numeric, price numeric, sale_price numeric,
  expected numeric, stock numeric, card_purchase numeric, card_sale numeric, updated_at timestamptz
)
language sql stable set search_path = public as $$
  select i.product_id, p.name, p.barcode, p.unit, i.qty, i.price, i.sale_price, i.expected,
         coalesce(st.qty, 0), p.purchase_price, p.sale_price, i.updated_at
  from stock_doc_items i
  join stock_docs d on d.id = i.doc_id
  join products p on p.id = i.product_id
  left join stock st on st.product_id = i.product_id and st.store_id = d.store_id
  where i.doc_id = p_doc
  order by i.updated_at desc, p.name
$$;

-- ───────────────────────── Отчёт о прибылях: проведённые документы и инвентаризация ─────────────────────────

drop function public.report_pnl(uuid, timestamptz, timestamptz, uuid);
create function public.report_pnl(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_store uuid default null
) returns table (
  sales_cash numeric, sales_card numeric, returns_sum numeric, discount numeric,
  cost_sold numeric, cost_returned numeric, writeoffs numeric, inventory numeric, receipts bigint
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
     where d.org_id = p_org and d.kind = 'writeoff' and d.status = 'posted'
       and d.created_at >= p_from and d.created_at < p_to and (p_store is null or d.store_id = p_store)),
    (select coalesce(sum(d.total), 0) from stock_docs d
     where d.org_id = p_org and d.kind = 'inventory' and d.status = 'posted'
       and d.created_at >= p_from and d.created_at < p_to and (p_store is null or d.store_id = p_store)),
    count(*) filter (where s.kind = 'sale')
  from sales s
  where s.org_id = p_org and s.created_at >= p_from and s.created_at < p_to
    and (p_store is null or s.store_id = p_store)
$$;

-- ───────────────────────── Импорт: подкатегории ─────────────────────────
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

-- ───────────────────────── Права на функции ─────────────────────────

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on function app.my_orgs(), app.my_managed_orgs(), app.is_member(uuid), app.is_manager(uuid),
  app.is_owner(uuid) to authenticated;
