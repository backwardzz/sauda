-- Области — отдельный справочник: область → города → адреса (торговые точки магазинов и филиалы компаний).
-- Раньше область была текстом в строке города, и порядок списка задавался только на сайте.

create table public.regions (
  id smallint generated always as identity primary key,
  name text not null unique,
  -- порядок в списках: города республиканского значения первыми, области по алфавиту
  sort smallint not null
);

alter table public.regions enable row level security;
create policy regions_read on public.regions for select to authenticated using (true);
-- справочник нужен уже на странице регистрации, до входа
create policy regions_read_anon on public.regions for select to anon using (true);

insert into public.regions (name, sort) values ('Города республиканского значения', 0);
insert into public.regions (name, sort)
select region, row_number() over (order by region)
from (select distinct region from public.cities where region <> '') r;

alter table public.cities add column region_id smallint references public.regions;
update public.cities c set region_id = r.id
from public.regions r
where r.name = case when c.region = '' then 'Города республиканского значения' else c.region end;

-- вместе со столбцом уходит прежнее ограничение unique (name, region)
alter table public.cities
  alter column region_id set not null,
  drop column region,
  add constraint cities_region_name_key unique (region_id, name);
create index cities_region_idx on public.cities (region_id, name);
