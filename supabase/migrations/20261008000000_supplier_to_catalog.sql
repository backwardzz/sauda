-- Товары поставщиков попадают в общий справочник: магазин видит их в «Каталоге товаров» и добавляет к себе.
-- Справочник остаётся без цен; цена и условия заказа — на витрине поставщика.

-- Строку справочника с таким штрихкодом не трогаем: название и категория в ней уже выверены.
create function app.supplier_product_to_catalog() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.archived then
    insert into catalog_products (name, barcode, unit, category)
    values (new.name, new.barcode, new.unit, new.category)
    on conflict (barcode) do nothing;
  end if;
  return new;
end $$;

create trigger supplier_products_to_catalog after insert or update of barcode on public.supplier_products
  for each row execute function app.supplier_product_to_catalog();

-- товары, заведённые до этой миграции
insert into public.catalog_products (name, barcode, unit, category)
select distinct on (barcode) name, barcode, unit, category
from public.supplier_products
where not archived
order by barcode, created_at
on conflict (barcode) do nothing;
