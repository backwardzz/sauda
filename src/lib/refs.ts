import { useCached } from './hooks';
import { db, q } from './supabase';
import type { Category, Contractor, QuickGroup } from './types';

// Справочники нужны многим страницам сразу: они в общем кэше и не перезапрашиваются при каждом переходе.

export function useCategories(orgId: string) {
  return useCached(['categories', orgId], () =>
    q<Category[]>(db.from('categories').select('*').eq('org_id', orgId).order('name')));
}

export function useContractors(orgId: string, kind: Contractor['kind']) {
  return useCached(['contractors', orgId, kind], () =>
    q<Contractor[]>(db.from('contractors').select('*').eq('org_id', orgId).eq('kind', kind).order('name')));
}

export function useQuickGroups(orgId: string) {
  return useCached(['quick_groups', orgId], () =>
    q<QuickGroup[]>(db.from('quick_groups').select('*').eq('org_id', orgId).order('sort').order('name')));
}

/** Имена сотрудников по id: RLS отдаёт только свой профиль и коллег по организации. Кэш сбрасывается при смене входа. */
export function useTeamNames() {
  const res = useCached(['team_names'], () =>
    q<{ id: string; full_name: string; email: string }[]>(db.from('profiles').select('id, full_name, email')));
  const map = new Map((res.data ?? []).map((p) => [p.id, p.full_name || p.email]));
  return (id: string | null | undefined) => (id ? map.get(id) ?? '—' : '—');
}

/** Категории деревом: корневые, под каждой её подкатегории. */
export function categoryTree(list: Category[]): { cat: Category; depth: number }[] {
  const out: { cat: Category; depth: number }[] = [];
  const ids = new Set(list.map((c) => c.id));
  for (const root of list.filter((c) => !c.parent_id || !ids.has(c.parent_id))) {
    out.push({ cat: root, depth: 0 });
    for (const child of list.filter((c) => c.parent_id === root.id)) out.push({ cat: child, depth: 1 });
  }
  return out;
}
