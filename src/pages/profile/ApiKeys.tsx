import { Fragment, useState } from 'react';
import { dateOnly, dateTime } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { useOrg } from '../../lib/session';
import { API_URL, db, PUBLIC_KEY, q } from '../../lib/supabase';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const copy = async (text: string, ok: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.ok(ok);
  } catch {
    toast.error('Не получилось скопировать: выделите текст и скопируйте вручную');
  }
};

/** Обмен с учётной системой компании (1С и другие): ключи доступа и описание запросов. Видит только владелец. */
export function ApiKeys() {
  const { org, branches } = useOrg();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // выпущенный ключ показывается один раз: в базе остаётся только его хеш
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keys = useQuery(
    () => q<ApiKey[]>(db.from('company_api_keys').select('id, name, prefix, created_at, last_used_at, revoked_at')
      .eq('org_id', org.id).is('revoked_at', null).order('created_at')),
    [org.id],
  );

  const create = async () => {
    setBusy(true);
    try {
      setIssued(await q<string>(db.rpc('create_api_key', { p_org: org.id, p_name: name })));
      keys.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!window.confirm(`Отозвать ключ «${k.name}»? Обмен, который им пользуется, перестанет работать.`)) return;
    try {
      await q(db.rpc('revoke_api_key', { p_key: k.id }));
      toast.ok('Ключ отозван');
      keys.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const close = () => { setCreating(false); setIssued(null); setName(''); };

  const example = `POST ${API_URL}/api_stock
apikey: ${PUBLIC_KEY}
X-Sauda-Key: <ключ компании>
Content-Type: application/json

{
  "items": [
    { "barcode": "4870000000011", "price": 370, "stock": 40 },
    { "barcode": "4870000009992", "stock": 7 }
  ]
}`;

  return (
    <>
      <div className="row" style={{ margin: '22px 0 10px' }}>
        <h2>Обмен с 1С</h2>
        <span className="muted">остатки и цены из вашей учётной системы</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Ключ доступа</button>
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Учётная система сама присылает в Sauda остатки и цены — магазины видят их сразу. Для подключения программисту нужны ключ доступа и описание запросов ниже.
      </p>

      <div className="card">
        {keys.data?.length === 0 && <div className="list-row muted">Ключей пока нет. Выпустите ключ и передайте его программисту.</div>}
        {keys.data?.map((k) => (
          <div className="list-row" key={k.id}>
            <b>{k.name}</b>
            <code className="muted">{k.prefix}…</code>
            <span className="spacer" />
            <span className="muted">
              выпущен {dateOnly(k.created_at)} · {k.last_used_at ? `последний запрос ${dateTime(k.last_used_at)}` : 'ещё не использовался'}
            </span>
            <button className="icon-btn small danger" onClick={() => revoke(k)} aria-label={`Отозвать ключ: ${k.name}`}><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>

      <details className="card pad api-docs">
        <summary>Описание запросов для программиста</summary>
        <p>Все запросы — <code>POST</code> на адрес <code>{API_URL}/&lt;запрос&gt;</code> с двумя заголовками: <code>apikey</code> (общий, он ниже в примере) и <code>X-Sauda-Key</code> (ключ компании). Тело и ответ — JSON.</p>
        <dl className="kv info">
          <dt><code>api_ping</code></dt><dd>Проверка связи и ключа. Тело — <code>{'{}'}</code>.</dd>
          <dt><code>api_stock</code></dt><dd>Остатки и цены. Товар ищется по штрихкоду; меняется только то, что передано в строке. До 5000 строк за запрос.</dd>
          <dt><code>api_catalog</code></dt><dd>Каталог компании, как он лежит в Sauda: штрихкоды, цены, остатки по филиалам — для сверки.</dd>
          <dt><code>api_branches</code></dt><dd>Филиалы компании и их <code>id</code>.</dd>
        </dl>
        <div className="section-title">Пример: остатки и цены</div>
        <pre className="code-block">{example}</pre>
        <button className="btn" onClick={() => copy(example, 'Пример скопирован')}><Icon name="copy" size={16} />Скопировать пример</button>
        <div className="section-title">Поля строки в api_stock</div>
        <dl className="kv info">
          <dt><code>barcode</code></dt><dd>Штрихкод, обязателен.</dd>
          <dt><code>price</code></dt><dd>Цена для магазинов.</dd>
          <dt><code>stock</code></dt><dd>Остаток на складе — итоговое число, не разница.</dd>
          <dt><code>active</code></dt><dd><code>false</code> снимает товар с продажи, <code>true</code> возвращает.</dd>
          <dt><code>name</code>, <code>label</code>, <code>unit</code>, <code>category</code>, <code>pack_qty</code></dt>
          <dd>Нужны только для товара, которого ещё нет в каталоге: с <code>name</code> он будет создан, без него штрихкод вернётся в <code>not_found</code>.</dd>
        </dl>
        <p>Ответ: <code>{'{ "updated": 2, "created": 0, "not_found": [], "errors": [] }'}</code>.</p>
        <div className="section-title">Склады</div>
        <p>Без поля <code>branch</code> остатки ставятся на главный филиал, а <code>price</code> — это базовая цена компании. Чтобы обновить другой склад, добавьте рядом с <code>items</code> поле <code>"branch": "&lt;id филиала&gt;"</code> — тогда и остаток, и <code>price</code> относятся к этому складу: цена становится его собственной.</p>
        <dl className="kv info">
          {branches.map((b) => <Fragment key={b.id}><dt>{b.name}{b.is_main && ' (главный)'}</dt><dd><code>{b.id}</code></dd></Fragment>)}
        </dl>
      </details>

      {creating && (
        <Modal title={issued ? 'Ключ выпущен' : 'Новый ключ доступа'} onClose={close} width={520}
          footer={issued
            ? <><span className="spacer" /><button className="btn primary" onClick={close}>Готово, ключ сохранён</button></>
            : <><span className="spacer" /><button className="btn" onClick={close}>Отмена</button><button className="btn primary" disabled={busy || !name.trim()} onClick={create}>Выпустить</button></>}>
          {issued ? (
            <div className="stack">
              <p>Скопируйте ключ и передайте программисту. <b>Больше он показан не будет</b> — если потеряется, выпустите новый.</p>
              <pre className="code-block">{issued}</pre>
              <button className="btn" onClick={() => copy(issued, 'Ключ скопирован')}><Icon name="copy" size={16} />Скопировать ключ</button>
            </div>
          ) : (
            <label className="field">
              <span>Название — для чего этот ключ</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="1С, склад в Алматы" />
            </label>
          )}
        </Modal>
      )}
    </>
  );
}
