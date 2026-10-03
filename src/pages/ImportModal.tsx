import { useState } from 'react';
import { db, q } from '../lib/supabase';
import { parseImport, type ImportRow } from '../lib/importParse';
import { exportXlsx, readXlsx } from '../lib/xlsx';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';

interface Props {
  orgId: string;
  storeId: string;
  storeName: string;
  onClose: () => void;
  onDone: () => void;
}

const CHUNK = 500;

export function ImportModal({ orgId, storeId, storeName, onClose, onDone }: Props) {
  const [parsed, setParsed] = useState<{ items: ImportRow[]; found: string[]; file: string } | null>(null);
  const [withStock, setWithStock] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setParsed({ ...parseImport(await readXlsx(file)), file: file.name });
    } catch (e) {
      toast.error(e);
    }
  };

  const run = async () => {
    if (!parsed) return;
    const total = { created: 0, updated: 0, skipped: 0 };
    try {
      for (let i = 0; i < parsed.items.length; i += CHUNK) {
        setProgress(i);
        const res = await q<typeof total>(
          db.rpc('import_products', {
            p_org: orgId,
            p_store: withStock ? storeId : null,
            p_rows: parsed.items.slice(i, i + CHUNK),
          }),
        );
        total.created += res.created;
        total.updated += res.updated;
        total.skipped += res.skipped;
      }
      toast.ok(`Импорт завершён: новых ${total.created}, обновлено ${total.updated}`);
      onDone();
    } catch (e) {
      toast.error(e);
      setProgress(null);
      if (total.created + total.updated > 0) onDone();
    }
  };

  const template = () =>
    exportXlsx('Шаблон импорта товаров', 'Товары', [
      {
        'Название': 'Вода питьевая 1 л', 'Штрихкод': '4870000000011', 'Доп. код': '', 'Ед. изм': 'шт',
        'Закупочная цена': 150, 'Продажная цена': 220, 'Оптовая цена': 200, 'Категория': 'Напитки',
        'Поставщик': 'ТОО Поставщик', 'Остаток': 24,
      },
    ]);

  const hasQty = parsed?.found.includes('Остаток');
  const busy = progress !== null;

  return (
    <Modal
      title="Импорт товаров из Excel"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={template} disabled={busy}>Скачать шаблон</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="btn primary" onClick={run} disabled={!parsed?.items.length || busy}>
            {busy ? `Загружено ${progress} из ${parsed?.items.length}` : 'Импортировать'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">
          Подойдёт выгрузка из другой учётной программы: нужна строка заголовков со столбцами «Название» и
          «Штрихкод». Товары с уже существующим штрихкодом обновятся, остальные добавятся.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => pick(e.target.files?.[0])} disabled={busy} />
        {parsed && (
          <div className="card pad stack">
            <div><b>{parsed.file}</b>: товаров {parsed.items.length}</div>
            <div className="muted">Найдены столбцы: {parsed.found.join(', ')}</div>
            {hasQty && (
              <label className="check-row">
                <input type="checkbox" checked={withStock} onChange={(e) => setWithStock(e.target.checked)} />
                Поставить остатки на склад «{storeName}» (только товарам с нулевым остатком)
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
