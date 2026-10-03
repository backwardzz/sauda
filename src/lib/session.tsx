import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { db, q } from './supabase';
import type { Org, Register, Role, Store } from './types';

interface Membership {
  role: Role;
  org: Org;
}

interface SessionState {
  /** undefined — сессия ещё не прочитана */
  user: User | null | undefined;
  loading: boolean;
  memberships: Membership[];
  org: Org | null;
  role: Role | null;
  canManage: boolean;
  stores: Store[];
  store: Store | null;
  registers: Register[];
  setOrgId: (id: string) => void;
  setStoreId: (id: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
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
  const [storeId, setStoreIdState] = useState<string | null>(stored('sauda:store'));

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
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      setUser((prev) => (prev?.id === session?.user?.id ? prev : (session?.user ?? null)));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = user?.id;

  const reload = useCallback(async () => {
    if (!userId) {
      setMemberships([]);
      setStores([]);
      setRegisters([]);
      return;
    }
    await db.rpc('accept_invites');
    const rows = await q<{ role: Role; orgs: Org }[]>(
      db.from('org_members').select('role, orgs(*)').eq('user_id', userId).order('created_at') as never,
    );
    const list = rows.filter((r) => r.orgs).map((r) => ({ role: r.role, org: r.orgs }));
    setMemberships(list);
    const current = list.find((m) => m.org.id === orgId) ?? list[0];
    if (!current) {
      setStores([]);
      setRegisters([]);
      return;
    }
    const [s, r] = await Promise.all([
      q<Store[]>(db.from('stores').select('*').eq('org_id', current.org.id).order('created_at')),
      q<Register[]>(db.from('registers').select('*').eq('org_id', current.org.id).order('created_at')),
    ]);
    setStores(s);
    setRegisters(r);
  }, [userId, orgId]);

  useEffect(() => {
    if (user === undefined) return;
    let alive = true;
    setLoading(true);
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
      stores,
      store: currentStore,
      registers,
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
        await db.auth.signOut();
      },
    };
  }, [user, loading, memberships, orgId, stores, storeId, registers, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession вне SessionProvider');
  return s;
}

/** Для страниц, общих для магазина и поставщика: у поставщика торговых точек нет. */
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
