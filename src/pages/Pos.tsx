import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fiscalFlush } from '../lib/fiscal';
import { money, parseNum, qty as fmtQty, round2, round3 } from '../lib/format';
import { useChanged, useQuery, useStored } from '../lib/hooks';
import { useContractors, useQuickGroups } from '../lib/refs';
import { useWorkspace } from '../lib/session';
import { db, q } from '../lib/supabase';
import type { Product, Shift } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Confirm, Modal } from '../ui/Modal';
import { ProductSearch, type ProductSearchHandle } from '../ui/ProductSearch';
import { toast } from '../ui/toast';
import { PosReturn } from './PosReturn';
import { CashOpModal, CloseShiftModal, OpenShift } from './PosShift';
import { SaleModal } from './SaleModal';

interface Line {
  product: Product;
  qty: string;
  /** Количество, с которым строка была в чеке до правки: от него считается отмена. */
  kept: number;
  wholesale: boolean;
  discount: string;
}

const linePrice = (l: Line) => Number(l.wholesale ? l.product.wholesale_price : l.product.sale_price);
const lineBase = (l: Line) => round2(linePrice(l) * parseNum(l.qty));
const lineDiscount = (l: Line) => Math.min(Math.max(round2(parseNum(l.discount)), 0), lineBase(l));
const lineTotal = (l: Line) => round2(lineBase(l) - lineDiscount(l));

const CART_KEY = 'sauda:pos:cart';
const BILLS = [500, 1000, 2000, 5000, 10000, 20000];

function loadCart(registerId: string): Line[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) ?? 'null') as { register: string; lines: Line[] } | null;
    return saved?.register === registerId ? saved.lines : [];
  } catch {
    return [];
  }
}

export function Pos() {
  const { org, store, registers, user, canManage, signOut } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<ProductSearchHandle>(null);

  const available = registers.filter((r) => r.store_id === store.id && r.active);
  const [registerId, setRegisterId] = useStored<string | null>('sauda:pos:register', null);
  const register = available.find((r) => r.id === registerId) ?? (available.length === 1 ? available[0] : null);

  const shiftQuery = useQuery(
    async () =>
      register
        ? ((await q<Shift[]>(db.from('shifts').select('*').eq('register_id', register.id).is('closed_at', null).limit(1)))[0] ?? null)
        : null,
    [register?.id],
  );
  const shift = shiftQuery.data ?? null;

  // Webkassa: включена ли на кассе и сколько чеков смены ещё не дошло
  const fiscalOn = useQuery(
    async () => !!register && (await q<{ enabled: boolean }[]>(db.from('register_fiscal').select('enabled').eq('register_id', register.id)))[0]?.enabled === true,
    [register?.id],
  );
  const unsent = useQuery(async () => {
    if (!shift) return 0;
    const { count, error } = await db.from('fiscal_receipts').select('id', { count: 'exact', head: true })
      .eq('shift_id', shift.id).neq('status', 'done').neq('kind', 'z_report');
    if (error) throw error;
    return count ?? 0;
  }, [shift?.id]);
  const [sending, setSending] = useState(false);
  /** Дослать чеки в Webkassa. После продажи — в фоне: чек уже проведён, статус видно в окне чека. */
  const sendFiscal = async (loud = false) => {
    if (!register || !fiscalOn.data) return;
    setSending(true);
    try {
      const r = await fiscalFlush(register.id);
      if (loud && r.failed) toast.error('Webkassa не приняла часть чеков, попробуйте позже');
      else if (loud) toast.ok('Чеки отправлены в Webkassa');
    } catch (e) {
      if (loud) toast.error(e);
    } finally {
      setSending(false);
      unsent.reload();
    }
  };

  const customers = useContractors(org.id, 'customer');
  const groups = useQuickGroups(org.id);
  const quick = useQuery(
    () => q<Product[]>(
      db.from('products').select('*').eq('org_id', org.id).eq('archived', false).not('quick_group_id', 'is', null)
        .order('quick_sort').order('name').limit(1000),
    ),
    [org.id],
  );

  const [lines, setLines] = useState<Line[]>([]);
  const [group, setGroup] = useState<string | null>(null);
  const [customer, setCustomer] = useState('');
  const [modal, setModal] = useState<'pay' | 'return' | 'cash' | 'close' | 'clear' | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; received?: number } | null>(null);
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [busy, setBusy] = useState(false);
  const returnSale = params.get('return');

  // касса та же, пока не сменился её id: перечитанный объект кассы не должен сбрасывать чек
  if (useChanged([register?.id], true) && register) setLines(loadCart(register.id));
  useEffect(() => {
    if (!register) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ register: register.id, lines }));
    } catch {
      // без хранилища чек не переживёт перезагрузку страницы
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, register?.id]);
  // окно возврата открывается один раз на смену, а не при каждом перечитывании смены
  if (useChanged([returnSale, shift?.id], true) && returnSale && shift) setModal('return');

  const groupList = groups.data ?? [];
  const activeGroup = groupList.find((g) => g.id === group) ?? groupList[0] ?? null;
  const tiles = (quick.data ?? []).filter((p) => p.quick_group_id === activeGroup?.id);

  const subtotal = round2(lines.reduce((s, l) => s + lineBase(l), 0));
  const discount = round2(lines.reduce((s, l) => s + lineDiscount(l), 0));
  const total = round2(subtotal - discount);

  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);

  const logCancel = (l: Line, from: number, to: number) => {
    if (!register || from <= to) return;
    // запрос supabase-js уходит только после then(): без него отмена не записалась бы
    db.rpc('log_cancel', { p_register: register.id, p_product: l.product.id, p_name: l.product.name, p_qty_from: from, p_qty_to: to })
      .then(({ error }) => error && console.warn('Отмена не записана:', error.message));
  };

  const add = (product: Product, weight?: number) => {
    if (Number(product.sale_price) <= 0) return toast.error(`У товара «${product.name}» не указана продажная цена`);
    setLines((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id);
      if (i < 0) return [...prev, { product, qty: String(weight ?? 1), kept: weight ?? 1, wholesale: false, discount: '' }];
      const next = [...prev];
      const value = round3(parseNum(next[i].qty) + (weight ?? 1));
      next[i] = { ...next[i], product, qty: String(value), kept: value };
      return next;
    });
  };

  const patch = (id: string, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...p } : l)));

  const remove = (l: Line) => {
    logCancel(l, l.kept, 0);
    setLines((prev) => prev.filter((x) => x.product.id !== l.product.id));
    focusSearch();
  };

  const step = (l: Line, delta: number) => {
    const value = round3(parseNum(l.qty) + delta);
    if (value <= 0) return remove(l);
    if (delta < 0) logCancel(l, l.kept, value);
    patch(l.product.id, { qty: String(value), kept: value });
  };

  /** Количество, введённое руками, фиксируется при выходе из поля. */
  const commitQty = (l: Line) => {
    const value = round3(parseNum(l.qty));
    if (value <= 0) return remove(l);
    logCancel(l, l.kept, value);
    patch(l.product.id, { qty: String(value), kept: value });
  };

  const clear = () => {
    lines.forEach((l) => logCancel(l, l.kept, 0));
    setLines([]);
    setCustomer('');
    setModal(null);
    focusSearch();
  };

  const openPay = () => {
    if (!lines.length) return;
    setCash('');
    setCard('');
    setModal('pay');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F4' && !modal && !receipt) {
        e.preventDefault();
        openPay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cardSum = Math.min(Math.max(round2(parseNum(card)), 0), total);
  const cashDue = round2(total - cardSum);
  const cashGiven = cash.trim() === '' ? cashDue : round2(parseNum(cash));
  const change = round2(cashGiven - cashDue);
  const bills = useMemo(() => [...new Set(BILLS.map((b) => Math.ceil(cashDue / b) * b))].filter((b) => b > cashDue).slice(0, 4), [cashDue]);

  /**
   * id чека для повторов: если ответ на оплату потерялся, повторная отправка того же чека вернёт уже проведённый,
   * а не пробьёт второй. Пока содержимое чека не менялось, id тот же; изменили чек — это уже другая продажа.
   */
  const attempt = useRef<{ content: string; id: string } | null>(null);

  const pay = async () => {
    if (!shift) return;
    if (change < 0) return toast.error('Получено меньше, чем нужно оплатить наличными');
    const sale = {
      p_shift: shift.id,
      p_items: lines.map((l) => ({ product_id: l.product.id, qty: parseNum(l.qty), price: linePrice(l), discount: lineDiscount(l) })),
      p_paid_card: cardSum,
      p_customer: customer || null,
    };
    const content = JSON.stringify(sale);
    if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
    setBusy(true);
    try {
      const res = await q<{ id: string; number: number; total: number }>(
        db.rpc('create_sale', { ...sale, p_client_id: attempt.current.id }),
      );
      attempt.current = null;
      setLines([]);
      setCustomer('');
      setModal(null);
      setReceipt({ id: res.id, received: cashDue > 0 ? cashGiven : undefined });
      void sendFiscal();
    } catch (e) {
      toast.error(e);
      // цены могли поменять в кабинете, пока чек был открыт: подтягиваем свежие
      if (e instanceof Error && e.message.includes('изменилась')) {
        const fresh = await q<Product[]>(db.from('products').select('*').in('id', lines.map((l) => l.product.id)));
        setLines((prev) => prev.map((l) => ({ ...l, product: fresh.find((p) => p.id === l.product.id) ?? l.product })));
        setModal(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const applyPercent = (value: string) => {
    const pct = Math.min(Math.max(parseNum(value), 0), 100);
    setLines((prev) => prev.map((l) => ({ ...l, discount: pct ? String(round2((lineBase(l) * pct) / 100)) : '' })));
  };

  const exit = () => navigate(canManage ? '/' : '/sales');

  if (!available.length) {
    return (
      <div className="auth">
        <div className="auth-card stack">
          <h1>Нет активных касс</h1>
          <p className="muted">В магазине «{store.name}» нет ни одной активной кассы.</p>
          {canManage
            ? <button className="btn primary" onClick={() => navigate('/registers')}>Перейти к кассам</button>
            : <button className="btn" onClick={signOut}>Выйти</button>}
        </div>
      </div>
    );
  }
  if (!register) {
    return (
      <div className="auth">
        <div className="auth-card stack">
          <h1>Выберите кассу</h1>
          {available.map((r) => (
            <button key={r.id} className="btn large" onClick={() => setRegisterId(r.id)}>{r.name}</button>
          ))}
          <button className="btn ghost" onClick={exit}>Назад</button>
        </div>
      </div>
    );
  }
  if (shiftQuery.loading && !shift) return <div className="auth muted">Загрузка…</div>;
  if (!shift) {
    return (
      <div className="pos">
        <div className="pos-top">
          <button className="btn" onClick={exit}><Icon name="back" size={16} />{canManage ? 'В кабинет' : 'Чеки'}</button>
          <span className="spacer" />
          {available.length > 1 && <button className="btn" onClick={() => setRegisterId(null)}>Сменить кассу</button>}
        </div>
        <OpenShift register={register} currency={org.currency} onOpened={shiftQuery.reload} />
      </div>
    );
  }

  return (
    <div className="pos">
      <div className="pos-top">
        <button className="btn" onClick={exit}><Icon name="back" size={16} />{canManage ? 'В кабинет' : 'Чеки'}</button>
        <b>{register.name}</b>
        <span className="muted">Смена № {shift.number} · {store.name}</span>
        <span className="spacer" />
        {(unsent.data ?? 0) > 0 && (
          <button className="btn danger" disabled={sending} onClick={() => void sendFiscal(true)}
            title="Чеки проведены в Sauda, но ещё не приняты Webkassa">
            {sending ? 'Отправка…' : `Не отправлено в Webkassa: ${unsent.data}`}
          </button>
        )}
        <button className="btn" onClick={() => setModal('return')}><Icon name="undo" size={16} />Возврат</button>
        <button className="btn" onClick={() => setModal('cash')}><Icon name="cash" size={16} />Внесение / изъятие</button>
        <button className="btn" onClick={() => setModal('close')}><Icon name="clock" size={16} />Закрыть смену</button>
        <span className="muted">{(user.user_metadata?.full_name as string) || user.email}</span>
      </div>

      <div className="pos-main">
        <div className="pos-panel">
          <div className="pos-search">
            <ProductSearch ref={searchRef} orgId={org.id} onPick={add} autoFocus placeholder="Сканируйте штрихкод или введите название" />
          </div>
          <div className="pos-lines">
            {lines.length === 0 ? (
              <div className="empty">Чек пуст. Отсканируйте товар или выберите его справа.</div>
            ) : (
              lines.map((l) => (
                <div className="pos-line" key={l.product.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="pos-line-name" title={l.product.name}>{l.product.name}</div>
                    <div className="pos-line-sub">
                      {money(linePrice(l))} {org.currency} за {l.product.unit}
                      {Number(l.product.wholesale_price) > 0 && (
                        <button className="btn ghost small" style={{ marginLeft: 6, height: 22 }}
                          onClick={() => patch(l.product.id, { wholesale: !l.wholesale })}>
                          {l.wholesale ? 'оптовая цена' : 'розничная цена'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="qty-box">
                    <button onClick={() => step(l, -1)} aria-label="Меньше">−</button>
                    <input value={l.qty} onChange={(e) => patch(l.product.id, { qty: e.target.value })} onBlur={() => commitQty(l)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} inputMode="decimal" aria-label="Количество" />
                    <button onClick={() => step(l, 1)} aria-label="Больше">+</button>
                  </div>
                  <input className="num-input" value={l.discount} placeholder="скидка" inputMode="decimal" aria-label="Скидка на строку"
                    onChange={(e) => patch(l.product.id, { discount: e.target.value })} />
                  <b className="num" style={{ textAlign: 'right' }}>{money(lineTotal(l))}</b>
                  <button className="icon-btn small danger" onClick={() => remove(l)} aria-label="Убрать из чека"><Icon name="x" size={16} /></button>
                </div>
              ))
            )}
          </div>
          <div className="pos-total">
            <div className="stack" style={{ gap: 6 }}>
              <div className="row">
                <select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Покупатель" style={{ maxWidth: 190 }}>
                  <option value="">Розничный покупатель</option>
                  {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input className="num-input" style={{ width: 96 }} placeholder="скидка %" inputMode="decimal" aria-label="Скидка на весь чек, %"
                  disabled={!lines.length} onChange={(e) => applyPercent(e.target.value)} />
                <button className="btn" disabled={!lines.length} onClick={() => setModal('clear')}>Очистить</button>
              </div>
              <div className="muted">
                Позиций: {lines.length}, товаров: {fmtQty(lines.reduce((s, l) => s + parseNum(l.qty), 0))}
                {discount > 0 && <> · скидка {money(discount)}</>}
              </div>
            </div>
            <span className="spacer" />
            <div className="pos-total-sum">{money(total)} <span className="stat-unit">{org.currency}</span></div>
            <button className="btn primary pos-pay" disabled={!lines.length} onClick={openPay}>Оплатить</button>
          </div>
        </div>

        <div className="pos-panel">
          {groupList.length === 0 ? (
            <div className="empty">
              Здесь будут быстрые товары — плитки для позиций без штрихкода.
              {canManage && <> Настройте их в кабинете: «Товары → Быстрые товары».</>}
            </div>
          ) : (
            <>
              <div className="quick-tabs">
                {groupList.map((g) => (
                  <button key={g.id} className={activeGroup?.id === g.id ? 'active' : ''} onClick={() => setGroup(g.id)}>{g.name}</button>
                ))}
              </div>
              <div className="quick-grid">
                {tiles.length === 0 && <div className="muted">В группе нет товаров</div>}
                {tiles.map((p) => (
                  <button key={p.id} className="quick-tile" onClick={() => { add(p); focusSearch(); }}>
                    <b>{p.quick_name || p.name}</b>
                    <span className="num muted">{money(p.sale_price)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {modal === 'pay' && (
        <Modal title="Оплата" onClose={() => setModal(null)} width={520}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)}>Назад</button>
              <button className="btn primary large" disabled={busy || change < 0} onClick={pay}>Провести продажу</button>
            </>
          }>
          <div className="stack">
            <div>
              <div className="muted">К оплате</div>
              <div className="pay-sum">{money(total)} {org.currency}</div>
            </div>
            <div className="pay-grid">
              <label className="field pay-field">
                <span>Получено наличными</span>
                <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" placeholder={money(cashDue)} autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && pay()} />
              </label>
              <label className="field pay-field">
                <span>Картой</span>
                <input value={card} onChange={(e) => setCard(e.target.value)} inputMode="decimal" placeholder="0" onKeyDown={(e) => e.key === 'Enter' && pay()} />
              </label>
            </div>
            <div className="quick-cash">
              <button className="btn" onClick={() => { setCard(''); setCash(''); }}>Наличными без сдачи</button>
              {bills.map((b) => <button key={b} className="btn" onClick={() => setCash(String(b))}>{money(b)}</button>)}
              <button className="btn" onClick={() => { setCard(String(total)); setCash(''); }}><Icon name="card" size={16} />Всё картой</button>
            </div>
            <dl className="kv">
              <dt>Наличными к оплате</dt><dd>{money(cashDue)}</dd>
              <dt>Картой</dt><dd>{money(cardSum)}</dd>
              <dt className="total">{change < 0 ? 'Не хватает' : 'Сдача'}</dt>
              <dd className={`total ${change < 0 ? 'error-text' : ''}`}>{money(Math.abs(change))} {org.currency}</dd>
            </dl>
          </div>
        </Modal>
      )}

      {modal === 'clear' && (
        <Confirm title="Очистить чек" text="Все товары будут убраны из чека и попадут в отчёт «Отменённые товары»."
          confirmLabel="Очистить" danger onConfirm={clear} onClose={() => setModal(null)} />
      )}
      {modal === 'cash' && <CashOpModal shift={shift} currency={org.currency} onClose={() => { setModal(null); void sendFiscal(); focusSearch(); }} />}
      {modal === 'close' && (
        <CloseShiftModal shift={shift} currency={org.currency} fiscal={fiscalOn.data === true} onClose={() => setModal(null)}
          onClosed={() => { setModal(null); shiftQuery.reload(); }} />
      )}
      {modal === 'return' && (
        <PosReturn orgId={org.id} shift={shift} currency={org.currency} saleId={returnSale}
          onClose={() => { setModal(null); setParams({}); focusSearch(); }}
          onDone={(id) => { setModal(null); setParams({}); setReceipt({ id }); void sendFiscal(); }} />
      )}
      {receipt && (
        <SaleModal saleId={receipt.id} received={receipt.received} onClose={() => { setReceipt(null); quick.reload(); focusSearch(); }} />
      )}
    </div>
  );
}
