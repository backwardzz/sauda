import { useEffect, useState } from 'react';
import { parseNum } from '../../lib/format';
import { useOrg } from '../../lib/session';
import { db, q } from '../../lib/supabase';
import { toast } from '../../ui/toast';

/** Карточка поставщика на витрине: как компанию видят магазины. */
export function CompanyProfile() {
  const { org, role, reload } = useOrg();
  const [form, setForm] = useState({ name: '', description: '', phone: '', min: '', delivery: '' });
  const [busy, setBusy] = useState(false);
  const owner = role === 'owner';

  useEffect(() => {
    setForm({ name: org.name, description: org.description, phone: org.phone, min: Number(org.min_order) ? String(org.min_order) : '', delivery: org.delivery_note });
  }, [org]);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Укажите название');
    setBusy(true);
    try {
      await q(db.from('orgs').update({
        name: form.name.trim(), description: form.description.trim(), phone: form.phone.trim(),
        min_order: Math.max(parseNum(form.min), 0), delivery_note: form.delivery.trim(),
      }).eq('id', org.id));
      toast.ok('Профиль сохранён');
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Профиль компании</h1>
        <span className="muted">Эти сведения видят магазины в списке поставщиков</span>
      </div>
      <div className="card pad stack" style={{ maxWidth: 640 }}>
        <label className="field">
          <span>Название <b>*</b></span>
          <input value={form.name} disabled={!owner} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Чем торгуете</span>
          <textarea rows={2} value={form.description} disabled={!owner} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Молочная продукция собственного производства, доставка по городу" />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Телефон для магазинов</span>
            <input value={form.phone} disabled={!owner} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
          </label>
          <label className="field">
            <span>Минимальная сумма заказа, {org.currency}</span>
            <input className="num-input" value={form.min} disabled={!owner} onChange={(e) => setForm({ ...form, min: e.target.value })} inputMode="decimal" placeholder="без ограничения" />
          </label>
        </div>
        <label className="field">
          <span>Условия доставки</span>
          <input value={form.delivery} disabled={!owner} onChange={(e) => setForm({ ...form, delivery: e.target.value })} placeholder="Доставка вт и пт, заказ до 16:00 накануне" />
        </label>
        {owner
          ? <div><button className="btn primary" disabled={busy} onClick={save}>Сохранить</button></div>
          : <p className="hint">Менять профиль может только владелец компании.</p>}
      </div>
    </>
  );
}
