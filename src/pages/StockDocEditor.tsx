import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { DOC_KINDS, isDocKind, lineExpected, linePrice, lineSum, loadDocLines } from '../lib/docs';
import { dateTime, markupPct, money, parseNum, qty as fmtQty, round2, round3 } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useContractors, useTeamNames } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, errorText, q } from '../lib/supabase';
import type { DocLine, Product, StockDoc } from '../lib/types';
import { exportXlsx } from '../lib/xlsx';
import { Icon } from '../ui/Icon';
import { Confirm, Modal } from '../ui/Modal';
import { ProductSearch } from '../ui/ProductSearch';
import { toast } from '../ui/toast';

const VISIBLE = 300;

interface Payment {
  id: string;
  amount: number;
  comment: string;
  created_at: string;
  created_by: string | null;
}

export function StockDocEditor() {
  const { kind, id } = useParams();
  const navigate = useNavigate();
  const { org, stores } = useWorkspace();
  const teamName = useTeamNames();
  const suppliers = useContractors(org.id, 'supplier');

  const doc = useQuery(
    async () => (id ? q<StockDoc | null>(db.from('stock_docs').select('*').eq('id', id).eq('org_id', org.id).maybeSingle()) : null),
    [id, org.id],
  );
  const [lines, setLines] = useState<DocLine[] | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [search, setSearch] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [bump, setBump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'post' | 'delete' | null>(null);
  const [zeroMissing, setZeroMissing] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payComment, setPayComment] = useState('');

  const d = doc.data;
  const posted = d?.status === 'posted';

  const reloadLines = () => {
    if (!id) return;
    loadDocLines(id)
      .then((l) => {
        setLines(l);
        setLinesError(null);
      })
      .catch((e) => setLinesError(errorText(e)));
  };
  useEffect(reloadLines, [id]);
  useEffect(() => {
    if (d) setComment(d.comment);
  }, [d?.id, d?.comment]);

  const payments = useQuery(
    async () =>
      d && d.kind === 'supply' && d.status === 'posted'
        ? q<Payment[]>(db.from('doc_payments').select('*').eq('doc_id', d.id).order('created_at'))
        : [],
    [d?.id, d?.status, d?.paid],
  );

  const validKind = isDocKind(kind) ? kind : null;
  const all = lines ?? [];
  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      validKind
        ? all.filter(
            (l) =>
              (!term || l.name.toLowerCase().includes(term) || l.barcode.includes(term)) &&
              (!onlyDiff || lineSum(validKind, l, posted) !== 0 || Number(l.qty) !== lineExpected(l, posted)),
          )
        : [],
    [all, term, onlyDiff, validKind, posted],
  );

  if (!validKind) return <Navigate to="/" replace />;
  const meta = DOC_KINDS[validKind];
  const back = () => navigate(`/docs/${validKind}`);

  if (doc.loading && !d) return <div className="empty">Загрузка…</div>;
  if (!d || d.kind !== validKind) return <div className="empty">Документ не найден</div>;

  const sums = all.map((l) => lineSum(validKind, l, posted));
  const total = round2(sums.reduce((s, x) => s + x, 0));
  const shortage = round2(sums.filter((x) => x < 0).reduce((s, x) => s + x, 0));
  const surplus = round2(sums.filter((x) => x > 0).reduce((s, x) => s + x, 0));
  const debt = round2(Number(d.total) - Number(d.paid));

  const saveHeader = async (patch: { comment?: string; supplier?: string | null; toStore?: string | null }) => {
    try {
      await q(
        db.rpc('update_stock_doc', {
          p_doc: d.id,
          p_comment: patch.comment ?? comment,
          p_supplier: patch.supplier !== undefined ? patch.supplier : d.supplier_id,
          p_to_store: patch.toStore !== undefined ? patch.toStore : d.to_store_id,
        }),
      );
      doc.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const setItem = (productId: string, l: { qty: number | null; price?: number; sale_price?: number | null }) =>
    q(db.rpc('set_stock_doc_item', { p_doc: d.id, p_product: productId, p_qty: l.qty, p_price: l.price ?? null, p_sale_price: l.sale_price ?? null }));

  const add = async (product: Product, weight?: number) => {
    const existing = all.find((l) => l.product_id === product.id);
    const next = round3((existing ? Number(existing.qty) : 0) + (weight ?? 1));
    const price = existing ? Number(existing.price) : Number(product.purchase_price);
    try {
      await setItem(product.id, { qty: next, price, sale_price: existing?.sale_price ?? null });
      let stock = existing?.stock;
      if (stock == null) {
        const row = await q<{ qty: number } | null>(
          db.from('stock').select('qty').eq('store_id', d.store_id).eq('product_id', product.id).maybeSingle(),
        );
        stock = Number(row?.qty ?? 0);
      }
      const line: DocLine = {
        product_id: product.id, name: product.name, barcode: product.barcode, unit: product.unit, qty: next, price,
        sale_price: existing?.sale_price ?? null, expected: null, stock, card_purchase: Number(product.purchase_price),
        card_sale: Number(product.sale_price), updated_at: new Date().toISOString(),
      };
      // только что добавленный товар встаёт первой строкой: при сканировании видно, что он учтён
      setLines((prev) => [line, ...(prev ?? []).filter((l) => l.product_id !== product.id)]);
    } catch (e) {
      toast.error(e);
    }
  };

  const commit = async (l: DocLine, patch: Partial<Pick<DocLine, 'qty' | 'price' | 'sale_price'>>) => {
    const next = { ...l, ...patch };
    const same = next.qty === Number(l.qty) && next.price === Number(l.price) && next.sale_price === l.sale_price;
    if (same) return;
    if (validKind === 'inventory' ? next.qty < 0 : next.qty <= 0) {
      toast.error(validKind === 'inventory' ? 'Количество не может быть отрицательным' : 'Количество должно быть больше нуля. Чтобы убрать товар, нажмите крестик.');
      return setBump((b) => b + 1);
    }
    try {
      await setItem(l.product_id, { qty: next.qty, price: Number(next.price), sale_price: next.sale_price });
      setLines((prev) => (prev ?? []).map((x) => (x.product_id === l.product_id ? next : x)));
    } catch (e) {
      toast.error(e);
      setBump((b) => b + 1);
    }
  };

  const remove = async (l: DocLine) => {
    try {
      await setItem(l.product_id, { qty: null });
      setLines((prev) => (prev ?? []).filter((x) => x.product_id !== l.product_id));
    } catch (e) {
      toast.error(e);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      await q(db.rpc('post_stock_doc_draft', { p_doc: d.id, p_zero_missing: validKind === 'inventory' && zeroMissing }));
      toast.ok(meta.posted);
      back();
    } catch (e) {
      toast.error(e);
      setBusy(false);
      setConfirm(null);
    }
  };

  const removeDoc = async () => {
    setBusy(true);
    try {
      await q(db.rpc('delete_stock_doc', { p_doc: d.id }));
      toast.ok('Черновик удалён');
      back();
    } catch (e) {
      toast.error(e);
      setBusy(false);
      setConfirm(null);
    }
  };

  const pay = async () => {
    const amount = payAmount.trim() === '' ? debt : parseNum(payAmount);
    if (amount <= 0) return toast.error('Укажите сумму');
    setBusy(true);
    try {
      await q(db.rpc('pay_supply', { p_doc: d.id, p_amount: amount, p_comment: payComment.trim() }));
      toast.ok('Платёж записан');
      setPayAmount('');
      setPayComment('');
      doc.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!all.length) return toast.error('В документе нет товаров');
    exportXlsx(`${meta.one} № ${d.number}`, meta.one, all.map((l) =>
      validKind === 'inventory'
        ? {
            'Товар': l.name, 'Штрихкод': l.barcode, 'Ед. изм': l.unit, 'Учётный остаток': lineExpected(l, posted), 'Фактически': Number(l.qty),
            'Разница': round3(Number(l.qty) - lineExpected(l, posted)), 'Цена': linePrice(validKind, l, posted), 'Сумма разницы': lineSum(validKind, l, posted),
          }
        : {
            'Товар': l.name, 'Штрихкод': l.barcode, 'Ед. изм': l.unit, 'Количество': Number(l.qty), 'Закупочная цена': linePrice(validKind, l, posted),
            ...(validKind === 'supply' ? { 'Продажная цена': l.sale_price ?? l.card_sale } : {}), 'Сумма': lineSum(validKind, l, posted),
          },
    )).catch(toast.error);
  };

  const num = (value: number | null | undefined, onCommit: (n: number) => void, opts: { label: string; placeholder?: string; emptyNull?: () => void } ) => (
    <input
      className="num-input"
      key={`${value}:${bump}`}
      defaultValue={value == null ? '' : String(value)}
      placeholder={opts.placeholder}
      inputMode="decimal"
      aria-label={opts.label}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={(e) => (e.target.value.trim() === '' && opts.emptyNull ? opts.emptyNull() : onCommit(parseNum(e.target.value)))}
    />
  );

  const isInv = validKind === 'inventory';
  const withStock = validKind === 'writeoff' || validKind === 'transfer';
  const colCount = isInv ? 6 : validKind === 'supply' ? 7 : withStock ? 6 : 5;

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={back} aria-label="Назад к списку"><Icon name="back" /></button>
        <h1>{meta.one} № {d.number}</h1>
        <span className={`badge ${posted ? 'ok' : 'warn'}`}>{posted ? 'Проведён' : 'Черновик'}</span>
        <span className="muted">{stores.find((s) => s.id === d.store_id)?.name} · {dateTime(d.created_at)} · {teamName(d.created_by)}</span>
      </div>

      <div className="toolbar">
        {!posted && <button className="btn primary" disabled={busy || !all.length} onClick={() => (isInv ? setConfirm('post') : post())}>Провести</button>}
        {!posted && <button className="btn danger" disabled={busy} onClick={() => setConfirm('delete')}>Удалить черновик</button>}
        <button className="btn" onClick={back}>Закрыть</button>
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>

      <div className="card filter-grid">
        {validKind === 'supply' && (
          <label className="field">
            <span>Поставщик <b>*</b></span>
            <select value={d.supplier_id ?? ''} disabled={posted} onChange={(e) => saveHeader({ supplier: e.target.value || null })}>
              <option value="">Выберите поставщика</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {validKind === 'transfer' && (
          <>
            <label className="field">
              <span>Из магазина</span>
              <input value={stores.find((s) => s.id === d.store_id)?.name ?? ''} disabled />
            </label>
            <label className="field">
              <span>В магазин <b>*</b></span>
              <select value={d.to_store_id ?? ''} disabled={posted} onChange={(e) => saveHeader({ toStore: e.target.value || null })}>
                <option value="">Выберите магазин</option>
                {stores.filter((s) => s.id !== d.store_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="field" style={{ gridColumn: validKind === 'transfer' ? 'auto' : 'span 2' }}>
          <span>Комментарий</span>
          <input value={comment} disabled={posted} onChange={(e) => setComment(e.target.value)}
            onBlur={() => comment !== d.comment && saveHeader({ comment })} placeholder={validKind === 'supply' ? 'Номер накладной' : ''} />
        </label>
      </div>

      {isInv && (
        <div className="stat-grid">
          <Tile label="Позиций в документе" value={fmtQty(all.length)} />
          <Tile label="Недостача" value={money(Math.abs(shortage))} unit={org.currency} tone={shortage < 0 ? 'error-text' : ''} />
          <Tile label="Излишки" value={money(surplus)} unit={org.currency} tone={surplus > 0 ? 'ok-text' : ''} />
          <Tile label="Итог" value={money(total)} unit={org.currency} />
        </div>
      )}

      {!posted && (
        <div className="card pad" style={{ marginBottom: 12 }}>
          <ProductSearch orgId={org.id} onPick={add} autoFocus goodsOnly
            placeholder={isInv ? 'Сканируйте товар: каждое сканирование добавляет 1 к фактическому количеству' : 'Добавить товар: название или штрихкод (можно сканером)'} />
        </div>
      )}

      {all.length > 8 && (
        <div className="toolbar">
          <input className="search" type="search" placeholder="Поиск в документе" value={search} onChange={(e) => setSearch(e.target.value)} />
          {isInv && (
            <label className="check-row">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              Только с расхождением
            </label>
          )}
        </div>
      )}

      <div className="table-wrap">
        <table className="table doc-lines">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Штрихкод</th>
              {isInv && <th className="right">Учётный остаток</th>}
              {withStock && <th className="right">Остаток</th>}
              <th className="right">{isInv ? 'Фактически' : 'Количество'}</th>
              {isInv ? <th className="right">Разница</th> : <th className="right">Закупочная цена, {org.currency}</th>}
              {validKind === 'supply' && <th className="right">Продажная цена, {org.currency}</th>}
              {validKind === 'supply' && <th className="right">Наценка %</th>}
              <th className="right">{isInv ? `Сумма разницы, ${org.currency}` : `Сумма, ${org.currency}`}</th>
              {!posted && <th style={{ width: 44 }} />}
            </tr>
          </thead>
          <tbody>
            {linesError ? (
              <tr><td colSpan={colCount + 1} className="table-note error-text">{linesError}</td></tr>
            ) : lines == null ? (
              <tr><td colSpan={colCount + 1} className="table-note">Загрузка…</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={colCount + 1} className="table-note">
                  {all.length ? 'Ничего не найдено' : posted ? 'В документе нет товаров' : 'Найдите товар в поле выше, и он появится в документе. Изменения сохраняются сами.'}
                </td>
              </tr>
            ) : (
              shown.slice(0, VISIBLE).map((l) => {
                const price = linePrice(validKind, l, posted);
                const expected = lineExpected(l, posted);
                const diff = round3(Number(l.qty) - expected);
                const sum = lineSum(validKind, l, posted);
                const sale = l.sale_price ?? l.card_sale;
                return (
                  <tr key={l.product_id}>
                    <td>{l.name}</td>
                    <td className="num">{l.barcode}</td>
                    {isInv && <td className="right">{fmtQty(expected)} {l.unit}</td>}
                    {withStock && <td className="right">{posted ? '' : `${fmtQty(l.stock)} ${l.unit}`}</td>}
                    <td className="right">
                      {posted ? fmtQty(l.qty) : num(Number(l.qty), (n) => commit(l, { qty: round3(n) }), { label: `Количество: ${l.name}` })}
                      <span className="muted" style={{ marginLeft: 6 }}>{l.unit}</span>
                    </td>
                    {isInv ? (
                      <td className={`right ${diff < 0 ? 'error-text' : diff > 0 ? 'ok-text' : ''}`}>{diff > 0 ? '+' : ''}{fmtQty(diff)}</td>
                    ) : (
                      <td className="right">
                        {!posted && (validKind === 'posting' || validKind === 'supply')
                          ? num(Number(l.price), (n) => commit(l, { price: round2(n) }), { label: `Закупочная цена: ${l.name}` })
                          : money(price)}
                      </td>
                    )}
                    {validKind === 'supply' && (
                      <td className="right">
                        {posted
                          ? money(sale)
                          : num(l.sale_price, (n) => commit(l, { sale_price: round2(n) }), {
                              label: `Продажная цена: ${l.name}`, placeholder: money(l.card_sale), emptyNull: () => commit(l, { sale_price: null }),
                            })}
                      </td>
                    )}
                    {validKind === 'supply' && <td className="right">{markupPct(price, Number(sale))}</td>}
                    <td className={`right ${isInv && sum < 0 ? 'error-text' : isInv && sum > 0 ? 'ok-text' : ''}`}>{money(sum)}</td>
                    {!posted && (
                      <td>
                        <button className="icon-btn small danger" onClick={() => remove(l)} aria-label={`Убрать: ${l.name}`}><Icon name="x" size={15} /></button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          {all.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}>Итого: позиций {all.length}</td>
                {(isInv || withStock) && <td />}
                <td className="right">{fmtQty(all.reduce((s, l) => s + Number(l.qty), 0))}</td>
                <td />
                {validKind === 'supply' && <><td /><td /></>}
                <td className="right">{money(total)}</td>
                {!posted && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {shown.length > VISIBLE && (
        <p className="hint" style={{ marginTop: 8 }}>Показаны первые {VISIBLE} строк из {shown.length}. Остальные найдутся через поиск в документе.</p>
      )}
      {!posted && validKind === 'supply' && (
        <p className="hint" style={{ marginTop: 10 }}>
          После проведения закупочная цена в карточках станет как в документе. Продажная изменится только там, где вы её указали.
        </p>
      )}
      {!posted && isInv && (
        <p className="hint" style={{ marginTop: 10 }}>
          Учётный остаток берётся на момент проведения: продажи во время подсчёта учитываются автоматически.
        </p>
      )}

      {validKind === 'supply' && posted && (
        <div className="card pad" style={{ marginTop: 16, maxWidth: 720 }}>
          <div className="section-title">Оплата поставщику</div>
          <dl className="kv" style={{ maxWidth: 360 }}>
            <dt>Сумма приёмки</dt><dd>{money(d.total)} {org.currency}</dd>
            <dt>Оплачено</dt><dd>{money(d.paid)} {org.currency}</dd>
            <dt className="total">Осталось</dt><dd className={`total ${debt > 0 ? 'error-text' : 'ok-text'}`}>{money(debt)} {org.currency}</dd>
          </dl>
          {(payments.data ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              {payments.data!.map((p) => (
                <div className="list-row" key={p.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <span className="muted">{dateTime(p.created_at)}</span>
                  <span className="grow">{p.comment || 'Платёж'} · {teamName(p.created_by)}</span>
                  <b className="num">{money(p.amount)}</b>
                </div>
              ))}
            </div>
          )}
          {debt > 0 && (
            <div className="row wrap" style={{ marginTop: 12 }}>
              <input className="num-input" style={{ width: 150 }} value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                placeholder={money(debt)} inputMode="decimal" aria-label="Сумма платежа" />
              <input className="grow" value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Комментарий: наличными, перевод" />
              <button className="btn primary" disabled={busy} onClick={pay}>Внести платёж</button>
            </div>
          )}
        </div>
      )}

      {confirm === 'delete' && (
        <Confirm title="Удалить черновик" text={`${meta.one} № ${d.number} и все добавленные в него товары будут удалены. Остатки не изменятся.`}
          confirmLabel="Удалить" danger busy={busy} onConfirm={removeDoc} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'post' && (
        <Modal title="Провести инвентаризацию" onClose={() => setConfirm(null)} width={500}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>Отмена</button>
              <button className="btn primary" disabled={busy} onClick={post}>Провести</button>
            </>
          }>
          <div className="stack">
            <p>Остатки {all.length} товаров станут равны подсчитанным. Недостача: {money(Math.abs(shortage))} {org.currency}, излишки: {money(surplus)} {org.currency}.</p>
            <label className="check-row" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Полная инвентаризация: обнулить остатки всех товаров, которых нет в документе
                <span className="hint" style={{ display: 'block' }}>Отмечайте, только если пересчитан весь магазин. Отменить это нельзя.</span>
              </span>
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

function Tile({ label, value, unit, tone = '' }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone}`}>{value}{unit && <span className="stat-unit">{unit}</span>}</div>
    </div>
  );
}
