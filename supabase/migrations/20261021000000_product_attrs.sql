-- Объём или вес, процент, количество в упаковке и тип упаковки — отдельными колонками товара, а не внутри названия:
-- «Coca cola 0.45л ж/б» → название «Coca cola», объём 0,45 л, упаковка ж/б.
-- name остаётся полным названием: его печатает чек, отправляет Webkassa, по нему ищут товар и строят документы.
-- Триггер держит их согласованными в обе стороны:
--   правят title или колонки (карточка товара) → name собирается из них;
--   приходит одно name (импорт, накладная, каталог, старый клиент) → оно раскладывается по колонкам.

alter table public.products
  -- короткое название без размера; пустое — разобрать из name
  add column title text not null default '',
  add column size_value numeric(12, 3) check (size_value > 0),
  add column size_unit text check (size_unit in ('мл', 'л', 'г', 'кг')),
  add column percent numeric(5, 2) check (percent >= 0 and percent <= 100),
  add column pack_qty numeric(10, 0) check (pack_qty > 0),
  add column pack_unit text check (pack_unit in ('шт', 'пак', 'таб', 'капс')),
  add column package text check (length(package) <= 20),
  add constraint products_size_pair check ((size_value is null) = (size_unit is null)),
  add constraint products_pack_pair check ((pack_qty is null) = (pack_unit is null));

-- Число без лишних нулей и с запятой: 0.450 → «0,45».
create function app.num_text(n numeric) returns text
language sql immutable as $$ select replace(trim_scale(n)::text, '.', ',') $$;

create function app.product_full_name(
  p_title text, p_size_value numeric, p_size_unit text, p_percent numeric, p_pack_qty numeric, p_pack_unit text, p_package text
) returns text
language sql immutable as $$
  select concat_ws(' ',
    nullif(trim(p_title), ''),
    app.num_text(p_percent) || '%',
    app.num_text(p_size_value) || ' ' || p_size_unit,
    app.num_text(p_pack_qty) || ' ' || p_pack_unit,
    nullif(trim(p_package), ''))
$$;

-- Разбор названия. Берётся первое совпадение каждого вида; что не распознано, остаётся в названии.
create function app.split_product_name(
  p_name text,
  out title text, out size_value numeric, out size_unit text, out percent numeric,
  out pack_qty numeric, out pack_unit text, out package text
)
language plpgsql immutable as $$
declare
  s text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  m text[];
  -- граница: начало или конец строки, пробел, скобка, точка, запятая
  pkg constant text := '(^|[\s.,(])(ж/б|жб|ст/б|стб|пэт|pet|м/у|мяг/уп|т/п|тетрапак)(?=$|[\s.,)])';
  pct constant text := '(\d+(?:[.,]\d+)?) ?%';
  -- «2х0,5л» — две бутылки по 0,5 л; «5*» у коньяка — звёзды, а не упаковка
  sz constant text := '(?:(\d+) ?[xх×] ?)?(\d+(?:[.,]\d+)?) ?(мл|ml|литр[а-яё]*|л|l|кг|kg|гр|г|g)(?![a-zа-яё0-9])\.?';
  pk constant text := '(\d+) ?(шт|штук[а-яё]*|пакетик[а-яё]*|пакет[а-яё]*|пак|таблет[а-яё]*|табл|таб|капсул[а-яё]*|капс)(?![a-zа-яё])\.?';
begin
  m := regexp_match(s, pkg, 'i');
  if m is not null then
    package := case lower(m[2])
      when 'жб' then 'ж/б' when 'стб' then 'ст/б' when 'пэт' then 'ПЭТ' when 'pet' then 'ПЭТ'
      when 'мяг/уп' then 'м/у' when 'тетрапак' then 'т/п' else lower(m[2]) end;
    s := regexp_replace(s, pkg, '\1', 'i');
  end if;

  m := regexp_match(s, pct, 'i');
  if m is not null and replace(m[1], ',', '.')::numeric <= 100 then
    percent := replace(m[1], ',', '.')::numeric;
    s := regexp_replace(s, pct, ' ', 'i');
  end if;

  m := regexp_match(s, sz, 'i');
  if m is not null and replace(m[2], ',', '.')::numeric > 0 then
    size_value := replace(m[2], ',', '.')::numeric;
    size_unit := case
      when lower(m[3]) in ('мл', 'ml') then 'мл'
      when lower(m[3]) in ('кг', 'kg') then 'кг'
      when lower(m[3]) in ('гр', 'г', 'g') then 'г'
      else 'л' end;
    if m[1] is not null and m[1]::numeric > 0 then
      pack_qty := m[1]::numeric;
      pack_unit := 'шт';
    end if;
    s := regexp_replace(s, sz, ' ', 'i');
  end if;

  if pack_qty is null then
    m := regexp_match(s, pk, 'i');
    if m is not null and m[1]::numeric > 0 then
      pack_qty := m[1]::numeric;
      pack_unit := case
        when lower(m[2]) like 'шт%' then 'шт'
        when lower(m[2]) like 'пак%' then 'пак'
        when lower(m[2]) like 'таб%' then 'таб'
        else 'капс' end;
      s := regexp_replace(s, pk, ' ', 'i');
    end if;
  end if;

  -- после выреза остаются висящие точки, запятые и двойные пробелы: «Маргарин Rama классик 70%.200гр»
  s := regexp_replace(s, '\s+([.,])(?=\s|$)', '', 'g');
  s := regexp_replace(s, '[\s.,/\\-]+$', '');
  s := regexp_replace(trim(s), '\s+', ' ', 'g');
  -- название из одного размера («0,5 л») не разбираем: иначе от названия ничего не останется
  if s = '' then
    title := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
    size_value := null; size_unit := null; percent := null; pack_qty := null; pack_unit := null; package := null;
  else
    title := s;
  end if;
end $$;

create function app.products_name() returns trigger
language plpgsql as $$
declare
  p record;
begin
  if tg_op = 'UPDATE'
     and (new.title, new.size_value, new.size_unit, new.percent, new.pack_qty, new.pack_unit, new.package)
         is not distinct from (old.title, old.size_value, old.size_unit, old.percent, old.pack_qty, old.pack_unit, old.package) then
    if new.name is not distinct from old.name then
      return new;
    end if;
    -- поменяли только полное название: раскладываем его заново
    new.title := null;
  end if;

  if coalesce(new.title, '') = '' then
    p := app.split_product_name(new.name);
    new.title := p.title;
    new.size_value := p.size_value;
    new.size_unit := p.size_unit;
    new.percent := p.percent;
    new.pack_qty := p.pack_qty;
    new.pack_unit := p.pack_unit;
    new.package := p.package;
  end if;
  new.title := trim(new.title);
  new.package := nullif(trim(new.package), '');
  new.name := app.product_full_name(new.title, new.size_value, new.size_unit, new.percent, new.pack_qty, new.pack_unit, new.package);
  if new.name = '' then
    raise exception 'Укажите название товара';
  end if;
  return new;
end $$;

create trigger products_name before insert or update on public.products
for each row execute function app.products_name();

-- Разложить уже заведённые товары. updated_at не трогаем: товар по сути не менялся.
alter table public.products disable trigger products_touch;
update public.products p
set title = s.title, size_value = s.size_value, size_unit = s.size_unit, percent = s.percent,
    pack_qty = s.pack_qty, pack_unit = s.pack_unit, package = s.package
from public.products x, lateral app.split_product_name(x.name) s
where x.id = p.id;
alter table public.products enable trigger products_touch;


grant insert (title, size_value, size_unit, percent, pack_qty, pack_unit, package),
      update (title, size_value, size_unit, percent, pack_qty, pack_unit, package)
  on public.products to authenticated;
