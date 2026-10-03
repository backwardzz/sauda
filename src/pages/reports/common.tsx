import { useState } from 'react';
import { useWorkspace } from '../../lib/session';
import { lastDays, PeriodPicker, periodRange, type Period } from '../../ui/Period';

/** Общий фильтр отчётов: период и «текущий магазин / все магазины». */
export function useReportScope(days = 30) {
  const workspace = useWorkspace();
  const { org, store, stores } = workspace;
  const [period, setPeriod] = useState<Period>(lastDays(days));
  const [allStores, setAllStores] = useState(false);
  const range = periodRange(period);
  const storeId = allStores ? null : store.id;

  const controls = (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      {stores.length > 1 && (
        <div className="segmented">
          <button className={!allStores ? 'active' : ''} onClick={() => setAllStores(false)}>{store.name}</button>
          <button className={allStores ? 'active' : ''} onClick={() => setAllStores(true)}>Все магазины</button>
        </div>
      )}
    </>
  );

  return {
    workspace,
    org,
    store,
    period,
    storeId,
    /** Параметры для функций report_* */
    args: { p_org: org.id, p_from: range.from, p_to: range.to, p_store: storeId },
    range,
    controls,
    label: `${period.from} — ${period.to}`,
  };
}

export interface SalesRow {
  key: string;
  label: string;
  barcode: string;
  unit: string;
  qty_sold: number;
  qty_returned: number;
  sales_sum: number;
  returns_sum: number;
  discount: number;
  revenue: number;
  cost: number;
  profit: number;
  receipts: number;
}
