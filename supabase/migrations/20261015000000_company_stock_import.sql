-- Загрузка остатков склада компании из Excel: сразу по нескольким филиалам.
-- Каталог при этом не меняется — новые товары заводятся загрузкой прайса в «Каталоге».
-- p_rows: [{barcode, branch_id, qty}]. Ответ: {updated, unchanged, not_found: [штрихкоды]}.
create function public.import_company_stock(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_var company_variants%rowtype;
  v_before numeric;
  v_updated int := 0;
  v_same int := 0;
  v_missing text[] := '{}';
begin
  if not app.is_manager(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;

  for v_row in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(barcode text, branch_id uuid, qty numeric)
  loop
    continue when coalesce(trim(v_row.barcode), '') = '' or v_row.qty is null or v_row.qty < 0;
    if not exists (select 1 from company_branches b where b.id = v_row.branch_id and b.org_id = p_org) then
      raise exception 'Филиал не найден';
    end if;
    select * into v_var from company_variants v
    where v.org_id = p_org and v.barcode = trim(v_row.barcode) and not v.archived;
    if not found then
      if not trim(v_row.barcode) = any (v_missing) then
        v_missing := v_missing || trim(v_row.barcode);
      end if;
      continue;
    end if;

    select s.qty into v_before from company_stock s where s.branch_id = v_row.branch_id and s.variant_id = v_var.id;
    if v_var.track_stock and coalesce(v_before, 0) = v_row.qty then
      v_same := v_same + 1;
      continue;
    end if;
    -- первая же цифра остатка включает учёт
    update company_variants v set track_stock = true where v.id = v_var.id and not v.track_stock;
    perform app.set_company_stock(p_org, v_row.branch_id, v_var.id, v_row.qty, 'import', '');
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('updated', v_updated, 'unchanged', v_same, 'not_found', to_jsonb(v_missing));
end $$;

revoke all on function public.import_company_stock(uuid, jsonb) from public, anon;
grant execute on function public.import_company_stock(uuid, jsonb) to authenticated;
