import { useNavigate } from 'react-router-dom';
import { dateTime, money, qty } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { useTeamNames } from '../lib/refs';
import { useSession } from '../lib/session';
import { db, q } from '../lib/supabase';
import type { Sale, SaleItem } from '../lib/types';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

export interface SaleFull extends Sale {
  sale_items: SaleItem[];
  registers: { name: string; receipt_header: string; receipt_footer: string } | null;
  contractors: { name: string } | null;
  stores: { name: string; address: string } | null;
}

export const SALE_SELECT = '*, sale_items(*), registers(name, receipt_header, receipt_footer), contractors(name), stores(name, address)';

interface ReceiptProps {
  sale: SaleFull;
  orgName: string;
  currency: string;
  cashier: string;
  /** Сколько наличных дал покупатель: известно только в момент продажи. */
  received?: number;
}

export function Receipt({ sale, orgName, currency, cashier, received }: ReceiptProps) {
  const isReturn = sale.kind === 'return';
  return (
    <div className="receipt">
      <div className="center"><b>{sale.registers?.receipt_header || orgName}</b></div>
      <div className="center">{sale.stores?.name}</div>
      {sale.stores?.address && <div className="center">{sale.stores.address}</div>}
      <hr />
      <div className="r-row"><span>{isReturn ? 'Возврат' : 'Чек'} № {sale.number}</span><span>{dateTime(sale.created_at)}</span></div>
      <div className="r-row"><span>Касса: {sale.registers?.name}</span><span>{cashier}</span></div>
      {sale.contractors && <div>Покупатель: {sale.contractors.name}</div>}
      <hr />
      {sale.sale_items.map((i) => (
        <div key={i.id} style={{ marginBottom: 4 }}>
          <div>{i.name}</div>
          <div className="r-row">
            <span>{qty(i.qty)} {i.unit} × {money(i.price)}</span>
            <span>{money(i.total)}</span>
          </div>
          {i.discount > 0 && <div className="r-row"><span>скидка</span><span>−{money(i.discount)}</span></div>}
        </div>
      ))}
      <hr />
      {sale.discount > 0 && <div className="r-row"><span>Скидка</span><span>{money(sale.discount)}</span></div>}
      <div className="r-row r-total"><span>{isReturn ? 'К ВОЗВРАТУ' : 'ИТОГО'}</span><span>{money(sale.total)} {currency}</span></div>
      {sale.paid_cash > 0 && <div className="r-row"><span>Наличными</span><span>{money(received ?? sale.paid_cash)}</span></div>}
      {sale.paid_card > 0 && <div className="r-row"><span>Картой</span><span>{money(sale.paid_card)}</span></div>}
      {received != null && received > sale.paid_cash && (
        <div className="r-row"><span>Сдача</span><span>{money(received - sale.paid_cash)}</span></div>
      )}
      <hr />
      {!isReturn && sale.registers?.receipt_footer && <div className="center">{sale.registers.receipt_footer}</div>}
      <div className="center">Нефискальный документ</div>
    </div>
  );
}

interface Props {
  saleId: string;
  onClose: () => void;
  /** Показать кнопку перехода к оформлению возврата. */
  allowReturn?: boolean;
  received?: number;
}

export function SaleModal({ saleId, onClose, allowReturn, received }: Props) {
  const { org } = useSession();
  const navigate = useNavigate();
  const teamName = useTeamNames();
  const sale = useQuery(() => q<SaleFull>(db.from('sales').select(SALE_SELECT).eq('id', saleId).single() as never), [saleId]);
  const returns = useQuery(
    () => q<Pick<Sale, 'id' | 'number' | 'total' | 'created_at'>[]>(
      db.from('sales').select('id, number, total, created_at').eq('parent_id', saleId).order('created_at'),
    ),
    [saleId],
  );

  const s = sale.data;
  const title = s ? `${s.kind === 'return' ? 'Возврат' : 'Чек'} № ${s.number}` : 'Чек';

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          {allowReturn && s?.kind === 'sale' && (
            <button className="btn" onClick={() => navigate(`/pos?return=${s.id}`)}><Icon name="undo" size={16} />Оформить возврат</button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => window.print()} disabled={!s}><Icon name="printer" size={16} />Печать</button>
          <button className="btn primary" onClick={onClose}>Закрыть</button>
        </>
      }
    >
      {sale.error ? (
        <p className="error-text">{sale.error}</p>
      ) : !s ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <div className="stack">
          <Receipt sale={s} orgName={org?.name ?? ''} currency={org?.currency ?? ''} cashier={teamName(s.cashier_id)} received={received} />
          {s.comment && <p><span className="muted">Комментарий:</span> {s.comment}</p>}
          {(returns.data ?? []).length > 0 && (
            <div>
              <div className="muted" style={{ marginBottom: 4 }}>Возвраты по этому чеку</div>
              {returns.data!.map((r) => (
                <div className="r-row row" key={r.id} style={{ justifyContent: 'space-between' }}>
                  <span>№ {r.number} от {dateTime(r.created_at)}</span>
                  <span className="num">−{money(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
