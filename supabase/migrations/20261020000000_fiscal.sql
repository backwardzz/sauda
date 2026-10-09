-- Фискализация чеков через облачную кассу (Webkassa). Sauda не касса: продажа проводится как раньше,
-- а для кассы с включённой фискализацией появляется запись в fiscal_receipts со статусом pending.
-- Серверная функция fiscal (supabase/functions/fiscal) отправляет её в Webkassa и записывает фискальный номер.
-- Пароль кассира Webkassa лежит в Vault зашифрованным и читается только сервером (service_role).

-- НДС организации: null — не плательщик НДС (упрощёнка), иначе ставка в процентах для всех товаров.
alter table public.orgs add column vat_rate numeric(5, 2) check (vat_rate is null or vat_rate between 0 and 100);
grant update (vat_rate) on public.orgs to authenticated;

create table public.register_fiscal (
  register_id uuid primary key references public.registers on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  provider text not null default 'webkassa' check (provider in ('webkassa')),
  enabled boolean not null default false,
  -- заводской номер кассы в Webkassa (SWK…)
  cashbox text not null,
  login text not null,
  password_secret uuid not null,
  updated_at timestamptz not null default now()
);
create index register_fiscal_org_idx on public.register_fiscal (org_id);
alter table public.register_fiscal enable row level security;
create policy register_fiscal_read on public.register_fiscal for select to authenticated using (app.is_member(org_id));
revoke all on public.register_fiscal from anon, authenticated;
grant select (register_id, org_id, provider, enabled, cashbox, login, updated_at) on public.register_fiscal to authenticated;

create table public.fiscal_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  register_id uuid not null references public.registers on delete cascade,
  shift_id uuid not null references public.shifts on delete cascade,
  kind text not null check (kind in ('sale', 'return', 'cash_in', 'cash_out', 'z_report')),
  sale_id uuid unique references public.sales on delete cascade,
  cash_op_id uuid unique references public.cash_ops on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  last_error text,
  fiscal_number text,
  ticket_url text,
  -- касса Webkassa приняла чек без связи с ОФД и дошлёт его сама
  offline boolean not null default false,
  response jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index fiscal_receipts_shift_idx on public.fiscal_receipts (shift_id);
create index fiscal_receipts_unsent_idx on public.fiscal_receipts (register_id, created_at) where status <> 'done';
alter table public.fiscal_receipts enable row level security;
create policy fiscal_receipts_read on public.fiscal_receipts for select to authenticated using (app.is_member(org_id));
revoke all on public.fiscal_receipts from anon, authenticated;
grant select on public.fiscal_receipts to authenticated;

-- Каждая продажа, возврат, внесение и изъятие на фискальной кассе встают в очередь на отправку.
create function app.fiscal_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_shift shifts%rowtype;
begin
  select * into v_shift from shifts where id = new.shift_id;
  if not exists (select 1 from register_fiscal where register_id = v_shift.register_id and enabled) then
    return new;
  end if;
  if tg_table_name = 'sales' then
    insert into fiscal_receipts (org_id, register_id, shift_id, kind, sale_id)
    values (new.org_id, v_shift.register_id, new.shift_id, new.kind, new.id);
  else
    insert into fiscal_receipts (org_id, register_id, shift_id, kind, cash_op_id)
    values (new.org_id, v_shift.register_id, new.shift_id, case when new.kind = 'in' then 'cash_in' else 'cash_out' end, new.id);
  end if;
  return new;
end $$;

create trigger sales_fiscal after insert on public.sales for each row execute function app.fiscal_enqueue();
create trigger cash_ops_fiscal after insert on public.cash_ops for each row execute function app.fiscal_enqueue();

-- Настройка фискализации кассы. Пароль передаётся только при первом подключении или смене:
-- пустой p_password оставляет сохранённый.
create function public.set_register_fiscal(
  p_register uuid, p_cashbox text, p_login text, p_password text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reg registers%rowtype;
  v_cur register_fiscal%rowtype;
  v_secret uuid;
begin
  select * into v_reg from registers where id = p_register;
  if not found or not app.is_manager(v_reg.org_id) then
    raise exception 'Нет доступа';
  end if;
  if coalesce(trim(p_cashbox), '') = '' or coalesce(trim(p_login), '') = '' then
    raise exception 'Укажите номер кассы и логин Webkassa';
  end if;

  select * into v_cur from register_fiscal where register_id = p_register;
  if coalesce(p_password, '') <> '' then
    if found then
      perform vault.update_secret(v_cur.password_secret, p_password);
      v_secret := v_cur.password_secret;
    else
      v_secret := vault.create_secret(p_password, 'webkassa:' || p_register::text, 'Пароль кассира Webkassa');
    end if;
  elsif found then
    v_secret := v_cur.password_secret;
  else
    raise exception 'Укажите пароль кассира Webkassa';
  end if;

  insert into register_fiscal (register_id, org_id, enabled, cashbox, login, password_secret)
  values (p_register, v_reg.org_id, coalesce(p_enabled, false), trim(p_cashbox), trim(p_login), v_secret)
  on conflict (register_id) do update
  set enabled = excluded.enabled, cashbox = excluded.cashbox, login = excluded.login,
      password_secret = excluded.password_secret, updated_at = now();
end $$;

-- Отключение и удаление настроек вместе с паролем.
create function public.delete_register_fiscal(p_register uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cur register_fiscal%rowtype;
begin
  select * into v_cur from register_fiscal where register_id = p_register;
  if not found then
    return;
  end if;
  if not app.is_manager(v_cur.org_id) then
    raise exception 'Нет доступа';
  end if;
  delete from register_fiscal where register_id = p_register;
  delete from vault.secrets where id = v_cur.password_secret;
end $$;

-- Учётные данные кассы для серверной функции fiscal. Только service_role.
create function public.fiscal_credentials(p_register uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cashbox', f.cashbox, 'login', f.login, 'password', s.decrypted_secret, 'enabled', f.enabled)
  from register_fiscal f join vault.decrypted_secrets s on s.id = f.password_secret
  where f.register_id = p_register
$$;

revoke all on function public.set_register_fiscal(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.set_register_fiscal(uuid, text, text, text, boolean) to authenticated;
revoke all on function public.delete_register_fiscal(uuid) from public, anon;
grant execute on function public.delete_register_fiscal(uuid) to authenticated;
revoke all on function public.fiscal_credentials(uuid) from public, anon, authenticated;
grant execute on function public.fiscal_credentials(uuid) to service_role;
revoke all on function app.fiscal_enqueue() from public;

-- Закрыть смену фискальной кассы можно, только когда все её чеки дошли до Webkassa
-- и снят Z-отчёт (его отправляет функция fiscal перед закрытием).
create or replace function public.close_shift(p_shift uuid, p_closing_cash numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_shift shifts%rowtype;
  v_expected numeric;
begin
  select * into v_shift from shifts where id = p_shift for update;
  if not found or not app.is_member(v_shift.org_id) then
    raise exception 'Нет доступа';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'Смена уже закрыта';
  end if;
  if exists (select 1 from register_fiscal where register_id = v_shift.register_id and enabled) then
    if exists (select 1 from fiscal_receipts where shift_id = p_shift and kind <> 'z_report' and status <> 'done') then
      raise exception 'Не все чеки отправлены в Webkassa: отправьте их и закройте смену снова';
    end if;
    if not exists (select 1 from fiscal_receipts where shift_id = p_shift and kind = 'z_report' and status = 'done') then
      raise exception 'Сначала снимите Z-отчёт в Webkassa';
    end if;
  end if;

  v_expected := app.shift_cash(p_shift);
  update shifts
  set closed_at = now(), expected_cash = v_expected, closing_cash = coalesce(p_closing_cash, v_expected)
  where id = p_shift;
  return v_expected;
end $$;
