import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { dateTime, fromDateInput, money, moneyShort, qty, toDateInput } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useTeamNames } from '../lib/refs';
import { ColumnChart, type ChartPoint } from '../ui/ColumnChart';
import { SaleModal } from './SaleModal';
import { useReportScope, type SalesRow } from './reports/common';
import { reportSales } from '../api/reports';
import { countProducts, listLowStock, stockTotals } from '../api/products';
import { listOpenShifts, listRecentSales } from '../api/pos';
import { listRecentSupplies } from '../api/docs';

export function Dashboard() {
  const scope = useReportScope(7);
  const { org, store } = scope;
  const teamName = useTeamNames();
  const [sale, setSale] = useState<string | null>(null);
  const { registers } = scope.workspace;
  const cur = org.currency;

  const days = useQuery(
    () => reportSales(scope.args),
    [scope.args.p_org, scope.args.p_from, scope.args.p_to, scope.args.p_store],
  );
  const stock = useQuery(async () => (await stockTotals(store.id))[0], [store.id]);
  const low = useQuery(
    () => listLowStock(store.id),
    [store.id],
  );
  const shifts = useQuery(
    () => listOpenShifts(org.id, store.id),
    [org.id, store.id],
  );
  const recent = useQuery(
    () => listRecentSales(org.id, store.id),
    [org.id, store.id],
  );

  const supplies = useQuery(
    () => listRecentSupplies(org.id, store.id),
    [org.id, store.id],
  );

  // пустая база товаров — повод предложить пакеты для нового магазина
  const products = useQuery(
    async () => (await countProducts(org.id)).count,
    [org.id],
  );

  const sum = (f: (r: SalesRow) => number) => (days.data ?? []).reduce((s, r) => s + Number(f(r)), 0);
  const revenue = sum((r) => r.revenue);
  const cost = sum((r) => r.cost);
  const receipts = sum((r) => r.receipts);

  // в отчёте есть только дни с продажами — пустые дни периода дорисовываются нулями
  const points = useMemo<ChartPoint[]>(() => {
    const byDay = new Map((days.data ?? []).map((r) => [r.key, Number(r.revenue)]));
    const out: ChartPoint[] = [];
    const end = fromDateInput(scope.period.to);
    for (const d = fromDateInput(scope.period.from); d <= end && out.length < 120; d.setDate(d.getDate() + 1)) {
      const key = toDateInput(d);
      out.push({
        label: `${key.slice(8)}.${key.slice(5, 7)}`,
        title: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }),
        value: byDay.get(key) ?? 0,
      });
    }
    return out;
  }, [days.data, scope.period.from, scope.period.to]);

  const storeRegisters = registers.filter((r) => r.store_id === store.id);

  return (
    <>
      <div className="page-head">
        <h1>Показатели по магазинам</h1>
        <span className="muted">{scope.storeId ? store.name : 'Все магазины'}</span>
      </div>
      {products.data === 0 && (
        <div className="card banner">
          <div className="grow">
            {org.business === 'pharmacy' ? (
              <>
                <b>Раздел для аптек в разработке</b>
                <div className="muted">Справочника лекарств пока нет: добавьте товары вручную или загрузите список из Excel.</div>
              </>
            ) : (
              <>
                <b>У вас новый магазин?</b>
                <div className="muted">Товаров пока нет. Возьмите готовый пакет ходовых товаров — названия, штрихкоды и категории уже заполнены.</div>
              </>
            )}
          </div>
          {org.business === 'pharmacy' ? (
            <Link className="btn" to="/products">Список товаров</Link>
          ) : (
            <>
              <Link className="btn" to="/catalog">Каталог товаров</Link>
              <Link className="btn primary" to="/catalog/starter">У меня новый магазин</Link>
            </>
          )}
        </div>
      )}
      <div className="toolbar">{scope.controls}</div>

      <div className="stat-grid">
        <Stat label="Выручка" value={moneyShort(revenue)} unit={cur} />
        <Stat label="Количество продаж" value={qty(receipts)} />
        <Stat label="Средний чек" value={moneyShort(receipts ? revenue / receipts : 0)} unit={cur} />
        <Stat label="Себестоимость" value={moneyShort(cost)} unit={cur} />
        <Stat label="Валовая прибыль" value={moneyShort(revenue - cost)} unit={cur} />
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-head">
            <h2>Выручка по дням, {cur}</h2>
            <span className="spacer" />
            <Link to="/reports/sales">Таблицей</Link>
          </div>
          {days.error ? (
            <div className="empty error-text">{days.error}</div>
          ) : (
            <ColumnChart points={points} unit={cur} ariaLabel={`Выручка по дням за период ${scope.label}`} />
          )}
          {!days.loading && revenue === 0 && <div className="empty" style={{ paddingTop: 0 }}>За выбранный период продаж не было</div>}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Склад</h2><span className="spacer" /><Link to="/stock">Открыть</Link></div>
            <div className="list-row"><span className="grow muted">Продажная стоимость</span><b className="num">{money(stock.data?.sale_sum)} {cur}</b></div>
            <div className="list-row"><span className="grow muted">Закупочная стоимость</span><b className="num">{money(stock.data?.purchase_sum)} {cur}</b></div>
            <div className="list-row"><span className="grow muted">Позиций с остатком</span><b className="num">{qty(stock.data?.positions)}</b></div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Приёмки</h2><span className="spacer" /><Link to="/docs/supply">Все приёмки</Link></div>
            {(supplies.data ?? []).length === 0 && <div className="empty">Приёмок от поставщиков ещё не было</div>}
            {(supplies.data ?? []).map((d) => (
              <div className="list-row" key={d.id}>
                <Link className="grow" to={`/docs/supply/${d.id}`}>{d.contractors?.name ?? `Приёмка № ${d.number}`}</Link>
                {Number(d.total) > Number(d.paid) && <span className="badge warn">не оплачено</span>}
                <b className="num">{money(d.total)}</b>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-head"><h2>Кассы</h2><span className="spacer" /><Link to="/registers">Управление</Link></div>
            {storeRegisters.length === 0 && <div className="empty">Касс нет</div>}
            {storeRegisters.map((r) => {
              const s = (shifts.data ?? []).find((x) => x.register_id === r.id);
              return (
                <div className="list-row" key={r.id}>
                  <span className="grow">{r.name}</span>
                  {!r.active ? <span className="badge">Не активна</span>
                    : s ? <span className="badge ok">Смена № {s.number} · {teamName(s.cashier_id)}</span>
                    : <span className="badge">Смена закрыта</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="dash-row">
        <div className="card">
          <div className="card-head"><h2>Последние чеки</h2><span className="spacer" /><Link to="/sales">Все чеки</Link></div>
          {(recent.data ?? []).length === 0 && <div className="empty">Продаж ещё не было. Откройте кассу и пробейте первый чек.</div>}
          {(recent.data ?? []).map((s) => (
            <div className="list-row" key={s.id}>
              <a className="grow" onClick={() => setSale(s.id)} style={{ cursor: 'pointer' }}>
                {s.kind === 'return' ? 'Возврат' : 'Чек'} № {s.number}
              </a>
              <span className="muted">{dateTime(s.created_at)}</span>
              <b className="num" style={{ minWidth: 90, textAlign: 'right' }}>{s.kind === 'return' ? '−' : ''}{money(s.total)}</b>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h2>Критические остатки</h2><span className="spacer" /><Link to="/stock">Склад</Link></div>
          {(low.data ?? []).length === 0 && (
            <div className="empty">Всё в порядке. Критический остаток задаётся в карточке товара.</div>
          )}
          {(low.data ?? []).map((r) => (
            <div className="list-row" key={r.id}>
              <Link className="grow" to={`/products/${r.id}`}>{r.name}</Link>
              <span className={`badge ${r.qty <= 0 ? 'danger' : 'warn'}`}>{qty(r.qty)} {r.unit} из {qty(r.min_stock)}</span>
            </div>
          ))}
        </div>
      </div>
      {sale && <SaleModal saleId={sale} onClose={() => setSale(null)} allowReturn />}
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</div>
    </div>
  );
}
