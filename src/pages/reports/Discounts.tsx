import { useState } from 'react';
import { dateTime, money, qty } from '../../lib/format';
import { useQuery } from '../../lib/hooks';
import { exportXlsx } from '../../lib/xlsx';
import { DataTable, type Column } from '../../ui/DataTable';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { useReportScope } from './common';
import { listDiscountedItems } from '../../api/reports';

interface Row {
  id: string;
  name: string;
  barcode: string;
  unit: string;
  qty: number;
  price: number;
  discount: number;
  total: number;
  sales: { created_at: string; number: number };
}

export function DiscountsReport() {
  const scope = useReportScope();
  const [search, setSearch] = useState('');

  const data = useQuery(async () => {
    const rows = await listDiscountedItems<Row>(scope.org.id, scope.range.from, scope.range.to, scope.storeId);
    return rows.sort((a, b) => b.sales.created_at.localeCompare(a.sales.created_at));
  }, [scope.org.id, scope.range.from, scope.range.to, scope.storeId]);

  const term = search.trim().toLowerCase();
  const rows = (data.data ?? []).filter((r) => !term || r.name.toLowerCase().includes(term) || r.barcode.includes(term));

  const columns: Column<Row>[] = [
    { key: 'receipt', title: 'Чек', render: (r) => `№ ${r.sales.number}` },
    { key: 'name', title: 'Название товара', fixed: true, sortable: true, value: (r) => r.name },
    { key: 'barcode', title: 'Штрихкод', value: (r) => r.barcode },
    { key: 'qty', title: 'Количество', align: 'right', render: (r) => qty(r.qty) },
    { key: 'unit', title: 'Ед. изм', value: (r) => r.unit },
    { key: 'price', title: 'Начальная цена', align: 'right', render: (r) => money(r.price) },
    { key: 'discount', title: 'Скидка', align: 'right', sortable: true, value: (r) => r.discount, render: (r) => money(r.discount) },
    { key: 'total', title: 'Сумма со скидкой', align: 'right', sortable: true, value: (r) => r.total, render: (r) => money(r.total) },
    { key: 'time', title: 'Время продажи', sortable: true, value: (r) => r.sales.created_at, render: (r) => dateTime(r.sales.created_at) },
  ];

  const download = () => {
    if (!rows.length) return toast.error('Нет данных для выгрузки');
    exportXlsx(`Отчёт по скидкам ${scope.label}`, 'Скидки', rows.map((r) => ({
      'Чек': r.sales.number, 'Название товара': r.name, 'Штрихкод': r.barcode, 'Количество': r.qty, 'Ед. изм': r.unit,
      'Начальная цена': r.price, 'Скидка': r.discount, 'Сумма со скидкой': r.total, 'Время продажи': dateTime(r.sales.created_at),
    }))).catch(toast.error);
  };

  return (
    <>
      <div className="page-head">
        <h1>Отчёт по скидкам</h1>
        <span className="muted">Товары, проданные со скидкой</span>
      </div>
      <div className="toolbar">
        {scope.controls}
        <input className="search" type="search" placeholder="Название или штрихкод" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="spacer" />
        <button className="btn" onClick={download}><Icon name="download" size={16} />Скачать</button>
      </div>
      <DataTable id="discounts" columns={columns} rows={rows} rowKey={(r) => r.id} loading={data.loading} error={data.error}
        empty="За выбранный период скидок не было"
        footer={{ name: 'Итого', discount: money(rows.reduce((a, r) => a + Number(r.discount), 0)), total: money(rows.reduce((a, r) => a + Number(r.total), 0)) }} />
    </>
  );
}
