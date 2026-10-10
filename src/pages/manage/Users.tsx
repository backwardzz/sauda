import { useState } from 'react';
import { dateOnly } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { ROLE_LABEL, type Role } from '../../lib/types';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { Confirm, Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

interface Member {
  user_id: string;
  role: Role;
  created_at: string;
  /** Филиал компании: сотрудник видит только его. null — головной офис. */
  branch_id: string | null;
  name: string;
  email: string;
}

interface Invite {
  id: string;
  email: string;
  role: Role;
  branch_id: string | null;
  created_at: string;
}

const ROLE_HINT: Record<Role, string> = {
  owner: 'Полный доступ, включая сотрудников',
  manager: 'Товары, склад, отчёты и касса',
  cashier: 'Только касса и чеки',
};

const COMPANY_ROLE: Record<Role, { label: string; hint: string }> = {
  owner: { label: 'Владелец', hint: 'Полный доступ, профиль компании и сотрудники' },
  manager: { label: 'Менеджер', hint: 'Каталог, цены, склад и заказы' },
  cashier: { label: 'Сотрудник', hint: 'Только заказы магазинов' },
};

export function Users() {
  const { org, user, role, canManage, branchId, branches } = useOrg();
  const isOwner = role === 'owner';
  // руководитель филиала приглашает и убирает сотрудников своего филиала; остальное — владелец
  const branchManager = org.kind === 'company' && canManage && !!branchId;
  const canAdmin = isOwner || branchManager;
  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter((r) => isOwner || r !== 'owner');
  const canEdit = (m: Member) => m.user_id !== user.id && (isOwner || (branchManager && m.role !== 'owner'));
  // у компании те же три уровня доступа, но называются по-своему
  const company = org.kind === 'company';
  const label = (r: Role) => (company ? COMPANY_ROLE[r].label : ROLE_LABEL[r]);
  const hint = (r: Role) => (company ? COMPANY_ROLE[r].hint : ROLE_HINT[r]);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('cashier');
  const [inviteBranch, setInviteBranch] = useState('');
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const members = useQuery(async () => {
    const [rows, profiles] = await Promise.all([
      q<{ user_id: string; role: Role; created_at: string; branch_id: string | null }[]>(
        db.from('org_members').select('user_id, role, created_at, branch_id').eq('org_id', org.id).order('created_at'),
      ),
      q<{ id: string; full_name: string; email: string }[]>(db.from('profiles').select('id, full_name, email')),
    ]);
    return rows.map<Member>((m) => {
      const p = profiles.find((x) => x.id === m.user_id);
      return { ...m, name: p?.full_name || '—', email: p?.email ?? '' };
    });
  }, [org.id]);

  const invites = useQuery(
    async () => (canAdmin ? q<Invite[]>(db.from('invites').select('*').eq('org_id', org.id).order('created_at')) : []),
    [org.id, canAdmin],
  );

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(ok);
      members.reload();
      invites.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const invite = () => {
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) return toast.error('Укажите почту сотрудника');
    if ((members.data ?? []).some((m) => m.email.toLowerCase() === value)) return toast.error('Этот сотрудник уже добавлен');
    void act(async () => {
      // сотрудник филиала увидит только свой филиал; владельцем может быть только сотрудник головного офиса
      const branch = branchManager ? branchId : inviteRole === 'owner' ? null : inviteBranch || null;
      await q(db.from('invites').insert({ org_id: org.id, email: value, role: inviteRole, branch_id: branch }));
      setInviting(false);
      setEmail('');
    }, 'Приглашение создано');
  };

  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? 'Филиал' : 'Головной офис');

  const columns: Column<Member>[] = [
    { key: 'name', title: 'ФИО', fixed: true, sortable: true, value: (m) => m.name, render: (m) => <>{m.name}{m.user_id === user.id && <span className="badge" style={{ marginLeft: 8 }}>это вы</span>}</> },
    { key: 'email', title: 'Почта', value: (m) => m.email },
    {
      key: 'role', title: 'Должность',
      render: (m) =>
        canEdit(m) ? (
          <select value={m.role} disabled={busy} aria-label={`Должность: ${m.name}`}
            onChange={(e) => act(() => q(db.from('org_members').update({ role: e.target.value as Role }).eq('org_id', org.id).eq('user_id', m.user_id)), 'Должность изменена')}>
            {roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        ) : (
          label(m.role)
        ),
    },
    ...(org.kind === 'company' ? [{
      key: 'branch', title: 'Филиал',
      render: (m: Member) =>
        isOwner && m.user_id !== user.id && m.role !== 'owner' ? (
          <select value={m.branch_id ?? ''} disabled={busy} aria-label={`Филиал: ${m.name}`}
            onChange={(e) => act(() => q(db.from('org_members').update({ branch_id: e.target.value || null }).eq('org_id', org.id).eq('user_id', m.user_id)),
              e.target.value ? 'Сотрудник видит только этот филиал' : 'Сотрудник видит все филиалы')}>
            <option value="">Головной офис — все филиалы</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : (
          branchName(m.branch_id)
        ),
    } satisfies Column<Member>] : []),
    { key: 'since', title: 'В команде с', render: (m) => dateOnly(m.created_at) },
    {
      key: 'actions', title: '', fixed: true, width: '50px',
      render: (m) =>
        canEdit(m) ? (
          <button className="icon-btn small danger" onClick={() => setRemoving(m)} aria-label={`Убрать доступ: ${m.name}`}><Icon name="trash" size={15} /></button>
        ) : null,
    },
  ];

  const inviteColumns: Column<Invite>[] = [
    { key: 'email', title: 'Почта', fixed: true, value: (i) => i.email },
    { key: 'role', title: 'Должность', value: (i) => label(i.role) },
    ...(org.kind === 'company' ? [{ key: 'branch', title: 'Филиал', value: (i: Invite) => branchName(i.branch_id) } satisfies Column<Invite>] : []),
    { key: 'date', title: 'Приглашён', render: (i) => dateOnly(i.created_at) },
    {
      key: 'actions', title: '', fixed: true, width: '50px',
      render: (i) => (
        <button className="icon-btn small danger" onClick={() => act(() => q(db.from('invites').delete().eq('id', i.id)), 'Приглашение отменено')} aria-label="Отменить приглашение">
          <Icon name="x" size={15} />
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Пользователи</h1>
        <span className="muted">{org.name}</span>
      </div>
      {canAdmin && (
        <div className="toolbar">
          <button className="btn primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} />Пользователь</button>
        </div>
      )}
      <DataTable id="members" columns={columns} rows={members.data ?? []} rowKey={(m) => m.user_id} loading={members.loading} error={members.error} />

      {canAdmin && (invites.data ?? []).length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 22 }}>Ожидают регистрации</div>
          <DataTable id="invites" columns={inviteColumns} rows={invites.data ?? []} rowKey={(i) => i.id} />
          <p className="hint" style={{ marginTop: 8 }}>
            Сотрудник получит доступ, когда зарегистрируется или войдёт с этой почтой. Отправьте ему ссылку на сайт.
          </p>
        </>
      )}

      {inviting && (
        <Modal title="Новый пользователь" onClose={() => setInviting(false)} width={460}
          footer={
            <>
              <button className="btn" onClick={() => setInviting(false)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={invite}>Пригласить</button>
            </>
          }>
          <div className="stack">
            <label className="field">
              <span>Почта сотрудника <b>*</b></span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Должность</span>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                {roles.map((r) => <option key={r} value={r}>{label(r)} — {hint(r)}</option>)}
              </select>
            </label>
            {org.kind === 'company' && isOwner && inviteRole !== 'owner' && branches.length > 0 && (
              <label className="field">
                <span>Филиал</span>
                <select value={inviteBranch} onChange={(e) => setInviteBranch(e.target.value)}>
                  <option value="">Головной офис — видит все филиалы</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} — видит только его</option>)}
                </select>
              </label>
            )}
            {branchManager && <p className="hint">Сотрудник будет работать в вашем филиале: {branchName(branchId)}.</p>}
            <p className="hint">Письмо не отправляется автоматически: сотрудник сам регистрируется на сайте с этой почтой и сразу получает доступ.</p>
          </div>
        </Modal>
      )}

      {removing && (
        <Confirm title="Убрать доступ" text={`${removing.name} (${removing.email}) больше не сможет войти в «${org.name}». Его чеки и смены сохранятся.`}
          confirmLabel="Убрать доступ" danger busy={busy} onClose={() => setRemoving(null)}
          onConfirm={() => act(async () => {
            await q(db.from('org_members').delete().eq('org_id', org.id).eq('user_id', removing.user_id));
            setRemoving(null);
          }, 'Доступ убран')} />
      )}
    </>
  );
}
