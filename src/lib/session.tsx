import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useChanged } from './hooks';
import { queryClient } from './queryClient';
import { db, q } from './supabase';
import type { Branch, Company, Org, Register, Role, Store } from './types';

interface Membership {
  role: Role;
  org: Org;
  /** Филиал компании, к которому привязан сотрудник; null — головной офис (у магазинов всегда null). */
  branchId: string | null;
}

interface SessionState {
  /** undefined — сессия ещё не прочитана */
  user: User | null | undefined;
  loading: boolean;
  memberships: Membership[];
  org: Org | null;
  role: Role | null;
  canManage: boolean;
  /** Филиал сотрудника компании: он видит и ведёт только его. null — головной офис, видит все филиалы. */
  branchId: string | null;
  stores: Store[];
  store: Store | null;
  registers: Register[];
  /** Витрина и филиалы — только у компании. Сотруднику филиала в списке виден только его филиал. */
  company: Company | null;
  branches: Branch[];
  setOrgId: (id: string) => void;
  setStoreId: (id: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Вход по коду или ссылке восстановления: прежде чем открыть кабинет, нужно задать новый пароль. */
  recovering: boolean;
  setRecovering: (on: boolean) => void;
}

const Ctx = createContext<SessionState | null>(null);

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватный режим: выбор просто не запомнится
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(stored('sauda:org'));
  const [stores, setStores] = useState<Store[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [storeId, setStoreIdState] = useState<string | null>(stored('sauda:store'));
  // флаг переживает перезагрузку вкладки: иначе после обновления страницы кабинет откроется со старым паролем
  const [recovering, setRecoveringState] = useState(() => {
    try { return sessionStorage.getItem('sauda:recovery') === '1'; } catch { return false; }
  });
  const setRecovering = useCallback((on: boolean) => {
    try {
      if (on) sessionStorage.setItem('sauda:recovery', '1');
      else sessionStorage.removeItem('sauda:recovery');
    } catch { /* без хранилища флаг живёт до перезагрузки */ }
    setRecoveringState(on);
  }, []);

  useEffect(() => {
    db.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        // сохранённая сессия может принадлежать удалённому пользователю: сервер ответит 4xx — выходим.
        // При обрыве сети статуса нет, и сессия остаётся.
        const { error } = await db.auth.getUser();
        if (error && typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
          await db.auth.signOut({ scope: 'local' });
          return setUser(null);
        }
      }
      setUser(data.session?.user ?? null);
    });
    const { data } = db.auth.onAuthStateChange((event, session) => {
      // переход по ссылке «восстановить пароль» из письма
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setUser((prev) => (prev?.id === session?.user?.id ? prev : (session?.user ?? null)));
    });
    return () => data.subscription.unsubscribe();
  }, [setRecovering]);

  const userId = user?.id;

  // кэш запросов принадлежит входу: после выхода или смены пользователя чужие данные не показываются
  useEffect(() => {
    queryClient.clear();
  }, [userId]);

  const reload = useCallback(async () => {
    // без входа списки очищаются при отрисовке, ниже
    if (!userId) return;
    await db.rpc('accept_invites');
    const rows = await q<{ role: Role; branch_id: string | null; orgs: Org }[]>(
      db.from('org_members').select('role, branch_id, orgs(*)').eq('user_id', userId).order('created_at') as never,
    );
    const list = rows.filter((r) => r.orgs).map((r) => ({ role: r.role, org: r.orgs, branchId: r.branch_id }));
    const current = list.find((m) => m.org.id === orgId) ?? list[0];
    const isCompany = current?.org.kind === 'company';
    const [s, r, c, b] = current
      ? await Promise.all([
          q<Store[]>(db.from('stores').select('*').eq('org_id', current.org.id).order('created_at')),
          q<Register[]>(db.from('registers').select('*').eq('org_id', current.org.id).order('created_at')),
          isCompany ? q<Company | null>(db.from('companies').select('*').eq('org_id', current.org.id).maybeSingle()) : null,
          isCompany
            ? q<Branch[]>(db.from('company_branches').select('*').eq('org_id', current.org.id).order('is_main', { ascending: false }).order('created_at'))
            : [],
        ])
      : [[], [], null, []];
    // компания и её магазины появляются одним обновлением: страницы магазина не рисуются без торговой точки
    setMemberships(list);
    setStores(s);
    setRegisters(r);
    setCompany(c);
    setBranches(b);
  }, [userId, orgId]);

  if (useChanged([user, reload]) && user !== undefined) {
    if (!loading) setLoading(true);
    if (!userId) {
      setMemberships([]);
      setStores([]);
      setRegisters([]);
      setCompany(null);
      setBranches([]);
    }
  }
  useEffect(() => {
    if (user === undefined) return;
    let alive = true;
    // reload меняет состояние только после ответов базы (после await), а не синхронно в эффекте
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
      .catch((e) => console.error(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [user, reload]);

  const value = useMemo<SessionState>(() => {
    const current = memberships.find((m) => m.org.id === orgId) ?? memberships[0] ?? null;
    const currentStore = stores.find((s) => s.id === storeId) ?? stores[0] ?? null;
    return {
      user,
      loading: user === undefined || loading,
      memberships,
      org: current?.org ?? null,
      role: current?.role ?? null,
      canManage: current?.role === 'owner' || current?.role === 'manager',
      branchId: current?.branchId ?? null,
      stores,
      store: currentStore,
      registers,
      company,
      branches: current?.branchId ? branches.filter((b) => b.id === current.branchId) : branches,
      setOrgId: (id) => {
        store('sauda:org', id);
        setOrgIdState(id);
      },
      setStoreId: (id) => {
        store('sauda:store', id);
        setStoreIdState(id);
      },
      reload,
      signOut: async () => {
        setRecovering(false);
        await db.auth.signOut();
      },
      recovering,
      setRecovering,
    };
  }, [user, loading, memberships, orgId, stores, storeId, registers, company, branches, reload, recovering, setRecovering]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession вне SessionProvider');
  return s;
}

/** Для страниц, общих для магазина и компании: у компании торговых точек нет. */
export function useOrg() {
  const s = useSession();
  if (!s.org || !s.user) throw new Error('Нет выбранной организации');
  return { ...s, org: s.org, user: s.user };
}

/** Для страниц кабинета магазина: организация и магазин там всегда есть. */
export function useWorkspace() {
  const s = useSession();
  if (!s.org || !s.store || !s.user) throw new Error('Нет выбранной организации');
  return { ...s, org: s.org, store: s.store, user: s.user };
}

/** Для страниц кабинета компании: витрина и главный филиал там всегда есть. */
export function useCompany() {
  const s = useSession();
  if (!s.org || !s.user || !s.company) throw new Error('Нет выбранной компании');
  // общий каталог, доступ к ценам и филиалы компании меняет только головной офис
  return { ...s, org: s.org, user: s.user, company: s.company, isHq: s.branchId == null, canEditCatalog: s.canManage && s.branchId == null };
}
