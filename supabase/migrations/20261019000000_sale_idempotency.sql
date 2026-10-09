-- Повтор продажи не создаёт второй чек. Касса присваивает каждому чеку свой id (client_id) до отправки:
-- если ответ потерялся (обрыв связи, таймаут) и касса отправляет чек снова, функция возвращает уже проведённый.
-- Это же основа офлайн-режима: чеки, пробитые без связи, досылаются очередью и могут уйти больше одного раза.

alter table public.sales add column client_id uuid;
create unique index sales_client_uq on public.sales (org_id, client_id) where client_id is not null;

drop function public.create_sale(uuid, jsonb, numeric, uuid, text);

-- Продажа. p_items: [{product_id, qty, price, discount}], price — розничная или оптовая цена товара,
-- discount — сумма скидки на строку. Наличными считается всё, что не оплачено картой.
-- p_client_id — id чека, выданный кассой; повтор с тем же id возвращает проведённый чек с repeated = true.
create function public.create_sale(
  p_shift uuid, p_items jsonb, p_paid_card numeric default 0,
  p_customer uuid default null, p_comment text default '', p_client_id uuid default null
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
  v_done sales%rowtype;
begin
  select * into v_shift from shifts where id = p_shift;
  if not found or not app.is_member(v_shift.org_id) then
    raise exception 'Нет доступа';
  end if;

  if p_client_id is not null then
    -- два одновременных повтора одного чека ждут друг друга, а не проводят его дважды
    perform pg_advisory_xact_lock(hashtextextended(v_shift.org_id::text || p_client_id::text, 0));
    select * into v_done from sales where org_id = v_shift.org_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_done.id, 'number', v_done.number, 'total', v_done.total, 'repeated', true);
    end if;
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
  insert into sales (org_id, store_id, register_id, shift_id, kind, number, customer_id, cashier_id, comment, client_id)
  values (v_shift.org_id, v_shift.store_id, v_shift.register_id, v_shift.id, 'sale', v_num,
          p_customer, auth.uid(), coalesce(p_comment, ''), p_client_id)
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

revoke all on function public.create_sale(uuid, jsonb, numeric, uuid, text, uuid) from public, anon;
grant execute on function public.create_sale(uuid, jsonb, numeric, uuid, text, uuid) to authenticated;
