-- Картинки товаров в каталогах поставщиков: ссылка на изображение, сам файл на площадке не хранится.

alter table public.supplier_products add column image_url text not null default '';

-- p_rows: [{name, barcode, unit, price, category, pack_qty, image_url}]
create or replace function public.import_supplier_products(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_id uuid;
  v_unit text;
  v_image text;
  v_created int := 0;
  v_updated int := 0;
begin
  if not app.is_manager(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'supplier') then
    raise exception 'Нет доступа';
  end if;
  for v_row in
    select * from jsonb_to_recordset(p_rows)
      as x(name text, barcode text, unit text, price numeric, category text, pack_qty numeric, image_url text)
  loop
    continue when coalesce(trim(v_row.name), '') = '' or coalesce(trim(v_row.barcode), '') = '';
    v_unit := case when v_row.unit in ('шт', 'кг', 'л', 'м') then v_row.unit end;
    -- только ссылки https: адрес попадает в <img> на страницах магазинов
    v_image := case when trim(v_row.image_url) ~* '^https://' then trim(v_row.image_url) end;
    select id into v_id from supplier_products where org_id = p_org and barcode = trim(v_row.barcode) and not archived;
    if v_id is null then
      insert into supplier_products (org_id, name, barcode, unit, category, price, pack_qty, image_url)
      values (p_org, trim(v_row.name), trim(v_row.barcode), coalesce(v_unit, 'шт'), coalesce(trim(v_row.category), ''),
              greatest(coalesce(v_row.price, 0), 0), case when v_row.pack_qty > 0 then v_row.pack_qty else 1 end,
              coalesce(v_image, ''));
      v_created := v_created + 1;
    else
      update supplier_products set
        name = trim(v_row.name),
        unit = coalesce(v_unit, unit),
        category = coalesce(nullif(trim(v_row.category), ''), category),
        price = coalesce(greatest(v_row.price, 0), price),
        pack_qty = case when v_row.pack_qty > 0 then v_row.pack_qty else pack_qty end,
        image_url = coalesce(v_image, image_url)
      where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end $$;

alter table public.supplier_products
  add constraint supplier_products_image_https check (image_url = '' or image_url ~* '^https://');
