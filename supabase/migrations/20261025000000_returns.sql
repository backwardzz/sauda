-- Возврат товара компании. Магазин оформляет возврат по принятому заказу, компания принимает его или отклоняет,
-- магазин отдаёт товар (остаток магазина уменьшается), компания получает его (остаток филиала растёт).
-- Возврат, как и заказ, хранит названия сторон на момент оформления: компания не имеет доступа к данным магазина.

create table public.order_returns (
  id uuid primary key default gen_random_uuid(),
  number int not null,
  order_id uuid not null,
  supplier_org uuid not null,
  store_org uuid not null,
  store_id uuid not null references public.stores on delete cascade,
  branch_id uuid references public.company_branches on delete set null,
  status text not null default 'new' check (status in ('new', 'accepted', 'sent', 'received', 'rejected', 'canceled')),
  -- defect — брак, expired — срок годности, wrong — привезли не тот товар, excess — лишнее, other — другое
  reason text not null check (reason in ('defect', 'expired', 'wrong', 'excess', 'other')),
  order_number int not null,
  supplier_name text not null,
  store_org_name text not null,
  store_name text not null,
  branch_name text not null default '',
  comment text not null default '',
  supplier_comment text not null default '',
  total numeric(14, 2) not null default 0,
  -- компания вернула товар в остаток филиала; брак обычно не возвращают
  restocked boolean not null default false,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  constraint order_returns_id_parties_key unique (id, supplier_org, store_org),
  constraint order_returns_order_fkey
    foreign key (order_id, supplier_org, store_org) references public.orders (id, supplier_org, store_org) on delete cascade
);
create index order_returns_supplier_idx on public.order_returns (supplier_org, created_at desc);
create index order_returns_store_idx on public.order_returns (store_org, created_at desc);
create index order_returns_order_idx on public.order_returns (order_id);

create table public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null,
  supplier_org uuid not null,
  store_org uuid not null,
  order_item_id uuid not null references public.order_items on delete cascade,
  variant_id uuid references public.company_variants on delete set null,
  name text not null,
  barcode text not null,
  unit text not null,
  qty numeric(14, 3) not null check (qty > 0),
  price numeric(14, 2) not null,
  constraint order_return_items_return_fkey
    foreign key (return_id, supplier_org, store_org) references public.order_returns (id, supplier_org, store_org) on delete cascade
);
create index order_return_items_return_idx on public.order_return_items (return_id);
create index order_return_items_order_item_idx on public.order_return_items (order_item_id);

-- Читают обе стороны; сотрудник филиала — только возвраты своего филиала. Меняют только функции ниже.
alter table public.order_returns enable row level security;
create policy party_read on public.order_returns for select to authenticated using (
  store_org in (select app.my_orgs())
  or (supplier_org in (select app.my_orgs()) and app.sees_branch(supplier_org, branch_id))
);
alter table public.order_return_items enable row level security;
create policy party_read on public.order_return_items for select to authenticated using (
  store_org in (select app.my_orgs())
  or (supplier_org in (select app.my_orgs())
      and exists (select 1 from order_returns r where r.id = order_return_items.return_id and app.sees_branch(r.supplier_org, r.branch_id)))
);
revoke all on public.order_returns, public.order_return_items from anon, authenticated;
grant select on public.order_returns, public.order_return_items to authenticated;

-- Движения остатков: у магазина — «возврат компании», у компании — «возврат от магазина».
alter table public.stock_moves drop constraint stock_moves_reason_check;
alter table public.stock_moves add constraint stock_moves_reason_check
  check (reason in ('posting', 'writeoff', 'sale', 'return', 'supply', 'transfer_out', 'transfer_in', 'inventory', 'supplier_return'));
alter table public.company_stock_moves drop constraint company_stock_moves_reason_check;
alter table public.company_stock_moves add constraint company_stock_moves_reason_check
  check (reason in ('adjust', 'import', 'shipment', 'api', 'return'));

-- ───────────────────────── Оформление ─────────────────────────
-- p_items: [{item_id, qty}] — строки заказа и сколько вернуть. Вернуть можно не больше отгруженного
-- за вычетом уже оформленных возвратов (отклонённые и отменённые не считаются).
create function public.create_order_return(p_order uuid, p_items jsonb, p_reason text, p_comment text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v orders%rowtype;
  v_return uuid;
  v_row record;
  v_item order_items%rowtype;
  v_left numeric;
  v_total numeric := 0;
begin
  select * into v from orders where id = p_order for update;
  if not found or not app.is_manager(v.store_org) then
    raise exception 'Нет доступа';
  end if;
  if v.status <> 'received' then
    raise exception 'Вернуть можно товар только из принятого заказа';
  end if;
  if p_reason is null or p_reason not in ('defect', 'expired', 'wrong', 'excess', 'other') then
    raise exception 'Укажите причину возврата';
  end if;

  insert into order_returns (number, order_id, supplier_org, store_org, store_id, branch_id, reason, order_number,
                             supplier_name, store_org_name, store_name, branch_name, comment, created_by)
  values (app.next_number(v.supplier_org, 'return'), v.id, v.supplier_org, v.store_org, v.store_id, v.branch_id, p_reason, v.number,
          v.supplier_name, v.store_org_name, v.store_name, v.branch_name, coalesce(trim(p_comment), ''), auth.uid())
  returning id into v_return;

  for v_row in
    select x.item_id, sum(x.qty) as qty
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(item_id uuid, qty numeric)
    where x.qty is distinct from 0
    group by x.item_id
  loop
    select * into v_item from order_items where id = v_row.item_id and order_id = v.id;
    if not found then
      raise exception 'Товара нет в этом заказе';
    end if;
    if v_row.qty is null or v_row.qty < 0 then
      raise exception 'Количество должно быть больше нуля: %', v_item.name;
    end if;
    v_left := coalesce(v_item.qty_shipped, v_item.qty) - coalesce((
      select sum(i.qty) from order_return_items i
      join order_returns r on r.id = i.return_id
      where i.order_item_id = v_item.id and r.status not in ('rejected', 'canceled')), 0);
    if v_row.qty > v_left then
      raise exception 'Вернуть можно не больше, чем привезли: % (осталось %)', v_item.name, trim_scale(greatest(v_left, 0));
    end if;
    insert into order_return_items (return_id, supplier_org, store_org, order_item_id, variant_id, name, barcode, unit, qty, price)
    values (v_return, v.supplier_org, v.store_org, v_item.id, v_item.variant_id, v_item.name, v_item.barcode, v_item.unit, v_row.qty, v_item.price);
    v_total := v_total + round(v_row.qty * v_item.price, 2);
  end loop;

  if not exists (select 1 from order_return_items where return_id = v_return) then
    raise exception 'Укажите, какие товары и сколько вернуть';
  end if;
  update order_returns set total = v_total where id = v_return;
  return v_return;
end $$;

-- ───────────────────────── Статусы ─────────────────────────
-- Компания: new → accepted или rejected (с объяснением); sent → received (p_restock — вернуть товар в остаток филиала).
-- Магазин: accepted → sent (товар отдан, остаток магазина уменьшается); отмена — пока товар не отдан.
create function public.set_return_status(
  p_return uuid, p_status text, p_comment text default null, p_restock boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v order_returns%rowtype;
  v_supplier boolean;
  v_store boolean;
  v_item record;
  v_prod uuid;
begin
  select * into v from order_returns where id = p_return for update;
  if not found then
    raise exception 'Возврат не найден';
  end if;
  v_supplier := app.is_member(v.supplier_org) and app.sees_branch(v.supplier_org, v.branch_id);
  v_store := app.is_manager(v.store_org);
  if not v_supplier and not v_store then
    raise exception 'Нет доступа';
  end if;

  if p_status = 'canceled' then
    if not v_store then
      raise exception 'Нет доступа';
    end if;
    if v.status not in ('new', 'accepted') then
      raise exception 'Этот возврат уже нельзя отменить';
    end if;
  elsif p_status in ('accepted', 'rejected') then
    if not v_supplier then
      raise exception 'Нет доступа';
    end if;
    if v.status <> 'new' then
      raise exception 'Ответить можно только на новый возврат';
    end if;
    if p_status = 'rejected' and coalesce(trim(p_comment), '') = '' then
      raise exception 'Напишите магазину, почему возврат отклонён';
    end if;
  elsif p_status = 'sent' then
    if not v_store then
      raise exception 'Нет доступа';
    end if;
    if v.status <> 'accepted' then
      raise exception 'Отдать товар можно после того, как компания согласилась на возврат';
    end if;
    -- товар магазина ищется по штрихкоду, как при приёмке; если карточки уже нет, остаток не трогаем
    for v_item in select * from order_return_items where return_id = v.id order by name loop
      select id into v_prod from products
      where org_id = v.store_org and not archived and kind = 'product'
        and (barcode = v_item.barcode or v_item.barcode = any(extra_barcodes))
      order by (barcode = v_item.barcode) desc limit 1;
      if v_prod is not null then
        perform app.move_stock(v.store_org, v.store_id, v_prod, -v_item.qty, 'supplier_return', v.id, v.number);
      end if;
    end loop;
  elsif p_status = 'received' then
    if not v_supplier then
      raise exception 'Нет доступа';
    end if;
    if v.status <> 'sent' then
      raise exception 'Получить можно только товар, который магазин уже отдал';
    end if;
    if coalesce(p_restock, true) and v.branch_id is not null then
      for v_item in
        select i.variant_id, i.qty
        from order_return_items i
        join company_variants cv on cv.id = i.variant_id
        where i.return_id = v.id and cv.track_stock
        order by i.name
      loop
        perform app.move_company_stock(v.supplier_org, v.branch_id, v_item.variant_id, v_item.qty, 'return', v.order_id, 'Возврат № ' || v.number);
      end loop;
    end if;
  else
    raise exception 'Неизвестный статус';
  end if;

  update order_returns set
    status = p_status,
    supplier_comment = case when v_supplier and p_comment is not null then trim(p_comment) else supplier_comment end,
    restocked = (p_status = 'received' and coalesce(p_restock, true) and v.branch_id is not null),
    accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    received_at = case when p_status = 'received' then now() else received_at end
  where id = v.id;
end $$;

revoke all on function public.create_order_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_order_return(uuid, jsonb, text, text) to authenticated;
revoke all on function public.set_return_status(uuid, text, text, boolean) from public, anon;
grant execute on function public.set_return_status(uuid, text, text, boolean) to authenticated;
