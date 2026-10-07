-- Аналитика компании по областям и городам: где какой товар заказывают, а где есть магазины, но заказов нет.

-- Заказы компании за период в разрезе «город магазина × товар × магазин» и число магазинов площадки по городам.
-- Считаются все неотменённые заказы по дате оформления: это спрос, а не только отгруженное.
-- Город берётся у торговой точки, в которую оформлен заказ.
-- sales:  [{city_id, product_id, store_org, qty, sum, orders}] — city_id null, если у точки город не указан;
-- market: [{city_id, stores}] — сколько магазинов площадки работает в городе (только число, без названий).
create function public.company_geo(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_member(p_org) or not exists (select 1 from orgs where id = p_org and kind = 'company') then
    raise exception 'Нет доступа';
  end if;
  return jsonb_build_object(
    'sales', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
        select s.city_id, v.product_id, o.store_org,
               sum(coalesce(i.qty_shipped, i.qty)) as qty,
               sum(round(coalesce(i.qty_shipped, i.qty) * i.price, 2)) as sum,
               count(distinct o.id) as orders
        from orders o
        join order_items i on i.order_id = o.id
        join company_variants v on v.id = i.variant_id
        join stores s on s.id = o.store_id
        where o.supplier_org = p_org and o.status <> 'canceled'
          and o.created_at >= p_from and o.created_at < p_to
        group by s.city_id, v.product_id, o.store_org
      ) t),
    'market', (
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
        select s.city_id, count(distinct s.org_id) as stores
        from stores s join orgs g on g.id = s.org_id
        where g.kind = 'store' and s.city_id is not null
        group by s.city_id
      ) m)
  );
end $$;

revoke all on function public.company_geo(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.company_geo(uuid, timestamptz, timestamptz) to authenticated;
