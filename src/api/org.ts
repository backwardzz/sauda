// Организация и люди: торговые точки, сотрудники, приглашения, контрагенты, справочник городов.
// Слой данных: только здесь названы таблицы, столбцы и функции базы. Страницы зовут эти функции.
import type { Contractor, Org, Role, Store } from '../lib/types';
import { db, q } from '../lib/supabase';

export interface CityRow {
  id: number;
  name: string;
  region_id: number;
  regions: { name: string; sort: number };
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  branch_id: string | null;
  created_at: string;
}

export const acceptInvites = () =>
  db.rpc('accept_invites');

export const listMemberships = (userId: string) =>
  q<{ role: Role; branch_id: string | null; orgs: Org }[]>(
    db.from('org_members').select('role, branch_id, orgs(*)').eq('user_id', userId).order('created_at') as never,
  );

export const listStores = (orgId: string) =>
  q<Store[]>(db.from('stores').select('*').eq('org_id', orgId).order('created_at'));

export const listCities = () =>
  q<CityRow[]>(db.from('cities').select('id, name, region_id, regions(name, sort)') as never);

export const invitePending = (email: string) =>
  db.rpc('invite_pending', { p_email: email });

export const startDemo = () =>
  db.rpc('start_demo');

export const listContractors = (orgId: string, kind: "supplier" | "customer") =>
  q<Contractor[]>(db.from('contractors').select('*').eq('org_id', orgId).eq('kind', kind).order('name'));

export const listProfiles = () =>
  q<{ id: string; full_name: string; email: string }[]>(db.from('profiles').select('id, full_name, email'));

export const addSupplier = (orgId: string, name: string) =>
  q<Contractor>(
    db.from('contractors').insert({ org_id: orgId, kind: 'supplier', name: name }).select().single(),
  );

export const addContractor = (row: { org_id: string; kind: "supplier" | "customer"; name: string; phone: string; comment: string; }) =>
  q(db.from('contractors').insert(row));

export const updateContractor = (row: { org_id: string; kind: "supplier" | "customer"; name: string; phone: string; comment: string; }, id: string) =>
  q(db.from('contractors').update(row).eq('id', id));

export const deleteContractor = (id: string) =>
  q(db.from('contractors').delete().eq('id', id));

export const listMembers = (orgId: string) =>
  q<{ user_id: string; role: Role; created_at: string; branch_id: string | null }[]>(
    db.from('org_members').select('user_id, role, created_at, branch_id').eq('org_id', orgId).order('created_at'),
  );

export const listInvites = (orgId: string) =>
  q<Invite[]>(db.from('invites').select('*').eq('org_id', orgId).order('created_at'));

export const addInvite = (orgId: string, email: string, role: Role, branchId: string | null) =>
  q(db.from('invites').insert({ org_id: orgId, email: email, role: role, branch_id: branchId }));

export const setMemberRole = (value: string, orgId: string, userId: string) =>
  q(db.from('org_members').update({ role: value as Role }).eq('org_id', orgId).eq('user_id', userId));

export const setMemberBranch = (value: string, orgId: string, userId: string) =>
  q(db.from('org_members').update({ branch_id: value || null }).eq('org_id', orgId).eq('user_id', userId));

export const deleteInvite = (inviteId: string) =>
  q(db.from('invites').delete().eq('id', inviteId));

export const removeMember = (orgId: string, userId: string) =>
  q(db.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId));

export const setVatRate = (vatRate: number | null, orgId: string) =>
  q(db.from('orgs').update({ vat_rate: vatRate }).eq('id', orgId));

export const addStore = (row: { org_id: string; name: string; city_id: number; address: string; phone: string; }) =>
  q<Store>(db.from('stores').insert(row).select().single());

export const updateStore = (row: { org_id: string; name: string; city_id: number; address: string; phone: string; }, id: string) =>
  q(db.from('stores').update(row).eq('id', id));

export const deleteStore = (id: string) =>
  q(db.from('stores').delete().eq('id', id));

export const setLogo = (logo: string, orgId: string) =>
  q(db.from('orgs').update({ logo_url: logo }).eq('id', orgId));

/** Новая организация из данных регистрации. Адрес, БИН, тип и описание компании заполняются позже в профиле. */
export const createOrg = (p: {
  name: string; kind: 'store' | 'company'; business: 'grocery' | 'pharmacy'; cityId: number | null; phone: string; email: string; contactName: string;
}) =>
  q<string>(db.rpc('create_org', {
    p_name: p.name, p_store: p.name, p_kind: p.kind, p_business: p.business, p_city: p.cityId,
    p_profile: {
      phone: p.phone, address: '', bin: '', email: p.email, contact_name: p.contactName,
      ...(p.kind === 'store' ? {} : { company_type: 'distributor', description: '' }),
    },
  }));

export const updateOrgProfile = (orgId: string, p: { name: string; phone: string; email: string; contactName: string; bin: string }) =>
  q(db.from('orgs').update({ name: p.name, phone: p.phone, email: p.email, contact_name: p.contactName, bin: p.bin }).eq('id', orgId));
