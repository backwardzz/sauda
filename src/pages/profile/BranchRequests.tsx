import { useState } from 'react';
import { dateTime } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { toast } from '../../ui/toast';

interface Request {
  id: string;
  user_name: string;
  user_email: string;
  branch_id: string | null;
  branch_name: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  comment: string;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
}

const NEW = 'new';

/** Заявки сотрудников на кабинет филиала: владелец одобряет (в существующий или новый филиал) или отклоняет. */
export function BranchRequests() {
  const { org, role, branches, reload } = useOrg();
  const owner = role === 'owner';
  const list = useQuery(() => q<Request[]>(db.rpc('branch_requests_list', { p_company: org.id })), [org.id]);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const pending = (list.data ?? []).filter((r) => r.status === 'pending');
  if (!pending.length) return null;

  const decide = async (r: Request, approve: boolean) => {
    const to = target[r.id] ?? r.branch_id ?? NEW;
    setBusy(r.id);
    try {
      await q(db.rpc('decide_branch_request', { p_request: r.id, p_approve: approve, p_branch: approve && to !== NEW ? to : undefined }));
      toast.ok(approve ? `${r.user_name || r.user_email}: кабинет филиала открыт` : 'Заявка отклонена');
      list.reload();
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="row" style={{ margin: '22px 0 10px' }}>
        <h2>Заявки филиалов</h2>
        <span className="badge warn">новых: {pending.length}</span>
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Сотрудник получит кабинет только своего филиала: его заказы, остатки, цены и сотрудники. Общий каталог, другие филиалы
        и доступ к ценам остаются у головного офиса.
      </p>
      <div className="branch-grid">
        {pending.map((r) => (
          <div className="card branch-card" key={r.id}>
            <div className="row">
              <b className="grow">{r.user_name || 'Без имени'}</b>
              <span className="muted">{dateTime(r.created_at)}</span>
            </div>
            <div className="branch-lines">
              <span>{r.user_email}</span>
              <span>
                {r.branch_id
                  ? <>Просит доступ к филиалу <b>{r.branch_name}</b>{r.city && `, ${r.city}`}</>
                  : <>Новый филиал <b>{r.name}</b>{[r.city, r.address, r.phone].filter(Boolean).map((x) => `, ${x}`)}</>}
              </span>
              {r.comment && <span className="muted">«{r.comment}»</span>}
            </div>
            {owner ? (
              <>
                <select value={target[r.id] ?? r.branch_id ?? NEW} onChange={(e) => setTarget({ ...target, [r.id]: e.target.value })}
                  aria-label="Филиал для этого сотрудника">
                  {!r.branch_id && <option value={NEW}>Создать новый филиал «{r.name}»</option>}
                  {branches.map((b) => <option key={b.id} value={b.id}>Привязать к филиалу: {b.name}</option>)}
                </select>
                <div className="row">
                  <button className="btn primary small" disabled={busy === r.id} onClick={() => decide(r, true)}>Одобрить</button>
                  <button className="btn small" disabled={busy === r.id} onClick={() => decide(r, false)}>Отклонить</button>
                </div>
              </>
            ) : <span className="muted">Решение принимает владелец компании</span>}
          </div>
        ))}
      </div>
    </>
  );
}
