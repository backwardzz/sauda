export type Role = 'owner' | 'manager' | 'cashier';
export type Unit = 'шт' | 'кг' | 'л' | 'м';
export const UNITS: Unit[] = ['шт', 'кг', 'л', 'м'];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  cashier: 'Кассир',
};

export interface Org {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  /** Магазин ведёт учёт и кассу, поставщик — каталог и заказы магазинов. */
  kind: 'store' | 'supplier';
  description: string;
  phone: string;
  min_order: number;
  delivery_note: string;
}

export interface SupplierProduct {
  id: string;
  org_id: string;
  name: string;
  barcode: string;
  unit: Unit;
  category: string;
  price: number;
  /** Кратность заказа: товар отпускается упаковками. */
  pack_qty: number;
  available: boolean;
  archived: boolean;
}

export type OrderStatus = 'new' | 'confirmed' | 'shipped' | 'received' | 'canceled';

export const ORDER_STATUS: Record<OrderStatus, { label: string; badge: string }> = {
  new: { label: 'Новый', badge: 'accent' },
  confirmed: { label: 'Подтверждён', badge: 'warn' },
  shipped: { label: 'Отгружен', badge: 'warn' },
  received: { label: 'Принят', badge: 'ok' },
  canceled: { label: 'Отменён', badge: '' },
};

export interface OrderItem {
  id: string;
  order_id: string;
  name: string;
  barcode: string;
  unit: string;
  qty: number;
  qty_shipped: number | null;
  price: number;
}

export interface Order {
  id: string;
  number: number;
  supplier_org: string;
  store_org: string;
  store_id: string;
  status: OrderStatus;
  supplier_name: string;
  store_org_name: string;
  store_name: string;
  store_address: string;
  comment: string;
  supplier_comment: string;
  total: number;
  supply_doc: string | null;
  created_at: string;
  confirmed_at: string | null;
  shipped_at: string | null;
  received_at: string | null;
}

export interface Store {
  id: string;
  org_id: string;
  name: string;
  address: string;
}

export interface Register {
  id: string;
  org_id: string;
  store_id: string;
  name: string;
  active: boolean;
  receipt_header: string;
  receipt_footer: string;
}

export interface Category {
  id: string;
  org_id: string;
  parent_id: string | null;
  name: string;
  markup_pct: number;
}

export interface Contractor {
  id: string;
  org_id: string;
  kind: 'supplier' | 'customer';
  name: string;
  phone: string;
  comment: string;
}

export interface QuickGroup {
  id: string;
  org_id: string;
  name: string;
  sort: number;
}

export interface Product {
  id: string;
  org_id: string;
  kind: 'product' | 'service';
  name: string;
  unit: Unit;
  barcode: string;
  extra_barcodes: string[];
  sku: string;
  category_id: string | null;
  supplier_id: string | null;
  purchase_price: number;
  sale_price: number;
  wholesale_price: number;
  min_stock: number | null;
  quick_group_id: string | null;
  quick_name: string;
  quick_sort: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockRow {
  id: string;
  org_id: string;
  name: string;
  unit: Unit;
  barcode: string;
  sku: string;
  category_id: string | null;
  supplier_id: string | null;
  purchase_price: number;
  sale_price: number;
  min_stock: number | null;
  store_id: string;
  qty: number;
  purchase_sum: number;
  sale_sum: number;
  /** Остаток не больше критического. */
  low: boolean;
}

export type DocKind = 'posting' | 'writeoff' | 'supply' | 'transfer' | 'inventory';

export interface StockDoc {
  id: string;
  org_id: string;
  store_id: string;
  kind: DocKind;
  status: 'draft' | 'posted';
  number: number;
  comment: string;
  /** У инвентаризации — излишки минус недостача, у остальных — сумма по закупочным ценам. */
  total: number;
  supplier_id: string | null;
  to_store_id: string | null;
  paid: number;
  created_by: string | null;
  created_at: string;
}

export interface StockMove {
  id: number;
  delta: number;
  qty_after: number;
  reason: 'posting' | 'writeoff' | 'sale' | 'return' | 'supply' | 'transfer_out' | 'transfer_in' | 'inventory';
  ref_number: number | null;
  created_at: string;
}

export interface Shift {
  id: string;
  org_id: string;
  store_id: string;
  register_id: string;
  cashier_id: string | null;
  number: number;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number | null;
  closing_cash: number | null;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  parent_item_id: string | null;
  name: string;
  barcode: string;
  unit: string;
  qty: number;
  price: number;
  discount: number;
  total: number;
  cost: number;
}

export interface Sale {
  id: string;
  org_id: string;
  store_id: string;
  register_id: string;
  shift_id: string;
  kind: 'sale' | 'return';
  parent_id: string | null;
  number: number;
  customer_id: string | null;
  cashier_id: string | null;
  subtotal: number;
  discount: number;
  total: number;
  cost: number;
  paid_cash: number;
  paid_card: number;
  comment: string;
  created_at: string;
}

export const MOVE_REASON: Record<StockMove['reason'], string> = {
  posting: 'Оприходование',
  writeoff: 'Списание',
  sale: 'Продажа',
  return: 'Возврат',
  supply: 'Приёмка',
  transfer_out: 'Перемещение в другой магазин',
  transfer_in: 'Перемещение из другого магазина',
  inventory: 'Инвентаризация',
};

/** Строка документа из функции stock_doc_lines. */
export interface DocLine {
  product_id: string;
  name: string;
  barcode: string;
  unit: string;
  /** В инвентаризации — фактическое количество. */
  qty: number;
  price: number;
  sale_price: number | null;
  /** Учётный остаток на момент проведения инвентаризации. */
  expected: number | null;
  /** Текущий остаток в магазине документа. */
  stock: number;
  card_purchase: number;
  card_sale: number;
  updated_at: string;
}
