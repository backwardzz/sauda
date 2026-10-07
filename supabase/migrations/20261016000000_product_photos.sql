-- Фото товаров компании с компьютера: файл кладётся в хранилище, в товаре остаётся ссылка на него.
-- Картинка сжимается в браузере до загрузки; путь файла — <id компании>/<случайное имя>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Читают все (хранилище публичное: фото видны на витрине). Кладут и убирают файлы только сотрудники
-- с правом вести каталог, и только в папку своей компании.
create policy product_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] in (select o::text from app.my_managed_orgs() o));
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] in (select o::text from app.my_managed_orgs() o));

-- Ссылка на фото — по-прежнему только https; исключение — хранилище локального стенда разработчика, оно работает по http.
alter table public.company_products drop constraint company_products_image_url_check;
alter table public.company_products add constraint company_products_image_url_check check (
  image_url = '' or image_url ~* '^https://'
  or image_url ~ '^http://(127\.0\.0\.1|localhost):\d+/storage/v1/object/public/product-photos/'
);
