import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { DOC_KINDS, isDocKind } from '../lib/docs';
import { dateTime, money } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useContractors, useTeamNames } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q } from '../lib/supabase';
import type { StockDoc } from '../lib/types';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { lastDays, PeriodPicker, periodRange } from '../ui/Period';
import { toast } from '../ui/toast';

/** Приложение «Накладные в Sauda»: на GitHub Pages лежит рядом, при локальной разработке — на порту 5179. */
function invoicesUrl(): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local ? 'http://localhost:5179/' : new URL('../umag-ocr/', location.href.split('#')[0]).href;
}

export function StockDocs() {
  const { kind } = useParams();
  const navigate = useNavigate();
  const { org, store, stores } = useWorkspace();
  const teamName = useTeamNames();
  const suppliers = useContractors(org.id, 'supplier');
  const [period, setPeriod] = useState(lastDays(30));
  const [busy, setBusy] = useState(false);
  const valid = isDocKind(kind);

  const docs = useQuery(async () => {
    if (!valid) return [];
    const { from, to } = periodRange(period);
    const scoped = () => {
      const base = db.from('stock_docs').select('*').eq('org_id', org.id).eq('kind', kind);
      // перемещение видно и в магазине-отправителе, и в магазине-получателе
      return kind === 'transfer' ? base.or(`store_id.eq.${store.id},to_store_id.eq.${store.id}`) : base.eq('store_id', store.id);
    };
    // черновики показываются всегда, проведённые — за выбранный период
    const [drafts, posted] = await Promise.all([
      q<StockDoc[]>(scoped().eq('status', 'draft').order('created_at', { ascending: false }).limit(200)),
      q<StockDoc[]>(scoped().eq('status', 'posted').gte('created_at', from).lt('created_at', to)
        .order('created_at', { ascending: false }).limit(500)),
    ]);
    return [...drafts, ...posted];
  }, [org.id, store.id, kind, period]);

  if (!valid) return <Navigate to="/" replace />;
  const meta = DOC_KINDS[kind];
  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name ?? '—';
  const supplierName = (id: string | null) => (suppliers.data ?? []).find((s) => s.id === id)?.name ?? '—';
  const needSecondStore = kind === 'transfer' && stores.length < 2;

  const create = async () => {
    setBusy(true);
    try {
      const id = await q<string>(db.rpc('create_stock_doc', { p_store: store.id, p_kind: kind }));
      navigate(`/docs/${kind}/${id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const rows = docs.data ?? [];
  const posted = rows.filter((d) => d.status === 'posted');
  const debt = (d: StockDoc) => Number(d.total) - Number(d.paid);

  const columns: Column<StockDoc>[] = [
    { key: 'number', title: 'Номер', fixed: true, sortable: true, value: (d) => d.number, render: (d) => <a>№ {d.number}</a> },
    { key: 'date', title: 'Дата', sortable: true, value: (d) => d.created_at, render: (d) => dateTime(d.created_at) },
    {
      key: 'status', title: 'Статус документа',
      render: (d) => <span className={`badge ${d.status === 'posted' ? 'ok' : 'warn'}`}>{d.status === 'posted' ? 'Проведён' : 'Черновик'}</span>,
    },
    ...(kind === 'supply' ? [{ key: 'supplier', title: 'Поставщик', value: (d: StockDoc) => supplierName(d.supplier_id) }] : []),
    ...(kind === 'transfer'
      ? [
          { key: 'from', title: 'Откуда', value: (d: StockDoc) => storeName(d.store_id) },
          { key: 'to', title: 'Куда', value: (d: StockDoc) => storeName(d.to_store_id) },
        ]
      : []),
    { key: 'user', title: 'Пользователь', value: (d) => teamName(d.created_by) },
    { key: 'comment', title: 'Комментарий', value: (d) => d.comment },
    {
      key: 'total', title: kind === 'inventory' ? `Излишки − недостача, ${org.currency}` : `Общая сумма, ${org.currency}`,
      align: 'right', sortable: true, value: (d) => Number(d.total),
      render: (d) =>
        d.status === 'draft' ? <span className="muted">—</span>
        : kind === 'inventory' ? <span className={d.total < 0 ? 'error-text' : d.total > 0 ? 'ok-text' : ''}>{money(d.total)}</span>
        : money(d.total),
    },
    ...(kind === 'supply'
      ? ([
          { key: 'paid', title: 'Оплачено', align: 'right', render: (d) => (d.status === 'posted' ? money(d.paid) : '') },
          {
            key: 'debt', title: 'Осталось', align: 'right',
            render: (d) => (d.status !== 'posted' ? '' : debt(d) > 0 ? <span className="error-text">{money(debt(d))}</span> : <span className="badge ok">Оплачено</span>),
          },
        ] as Column<StockDoc>[])
      : []),
  ];

  const sum = (f: (d: StockDoc) => number) => money(posted.reduce((s, d) => s + Number(f(d)), 0));

  return (
    <>
      <div className="page-head">
        <h1>{meta.title}</h1>
        <span className="muted">{meta.hint}</span>
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={busy || needSecondStore} onClick={create}><Icon name="plus" size={16} />{meta.one}</button>
        {kind === 'supply' && (
          <a className="btn" href={invoicesUrl()} target="_blank" rel="noopener" title="Распознать фото накладной и создать из неё приёмку">
            <Icon name="doc" size={16} />Из фото накладной
          </a>
        )}
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {needSecondStore && (
        <p className="hint" style={{ marginBottom: 12 }}>
          Для перемещения нужны хотя бы две торговые точки. Добавьте вторую в разделе «Управление → Торговые точки».
        </p>
      )}
      <DataTable id={`docs-${kind}`} columns={columns} rows={rows} rowKey={(d) => d.id} loading={docs.loading}
        error={docs.error} empty="За выбранный период документов нет" onRowClick={(d) => navigate(`/docs/${kind}/${d.id}`)}
        footer={{ number: 'Итого проведено', total: sum((d) => d.total), ...(kind === 'supply' ? { paid: sum((d) => d.paid), debt: sum(debt) } : {}) }} />
    </>
  );
}
