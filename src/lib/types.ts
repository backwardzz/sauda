export type Role = 'owner' | 'manager' | 'cashier';
export type Unit = 'шт' | 'кг' | 'л' | 'м';
export const UNITS: Unit[] = ['шт', 'кг', 'л', 'м'];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  cashier: 'Кассир',
};

export interface City {
  id: number;
  name: string;
  region_id: number;
  /** Название области; у Астаны, Алматы и Шымкента — «Города республиканского значения». */
  region: string;
  /** Порядок области в списках: 0 — города республиканского значения. */
  region_sort: number;
}

export type OrgKind = 'store' | 'company';

export interface Org {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  /** Магазин ведёт учёт и кассу, компания — каталог, склад и заказы магазинов. */
  kind: OrgKind;
  /** Чем торгует магазин. Аптека пока заглушка: отдельного учёта лекарств нет. */
  business: 'grocery' | 'pharmacy';
  phone: string;
  /** БИН или ИИН: 12 цифр либо пусто. */
  bin: string;
  email: string;
  contact_name: string;
  /** Логотип: ссылка https или сжатая картинка (data URL); пусто — инициалы. */
  logo_url: string;
  created_at: string;
}

export type CompanyType = 'manufacturer' | 'distributor' | 'wholesaler';

export const COMPANY_TYPE: Record<CompanyType, string> = {
  manufacturer: 'Производитель',
  distributor: 'Дистрибьютор',
  wholesaler: 'Оптовая компания',
};

/** Витрина компании: чем торгует и на каких условиях. */
export interface Company {
  org_id: string;
  company_type: CompanyType;
  description: string;
  website: string;
  min_order: number;
  delivery_note: string;
  payment_terms: string;
  /** Отметку «Подтверждённая компания» ставит администратор площадки. */
  verified: boolean;
  created_at: string;
}

/** Филиал компании: офис и склад в городе. */
export interface Branch {
  id: string;
  org_id: string;
  city_id: number;
  name: string;
  address: string;
  phone: string;
  manager_name: string;
  work_hours: string;
  is_main: boolean;
  /** Надбавка филиала ко всему прайсу компании, %; отрицательная — скидка. */
  markup_pct: number;
  /** Свой минимальный заказ; null — как у компании. */
  min_order: number | null;
  /** Свои условия доставки; пусто — как у компании. */
  delivery_note: string;
  created_at: string;
}

/** Товар компании: то, что покупатель видит в каталоге. Продаются его виды. */
export interface CompanyProduct {
  id: string;
  org_id: string;
  name: string;
  category: string;
  description: string;
  /** Ссылка https на фото товара; пусто — фото нет. */
  image_url: string;
  archived: boolean;
  created_at: string;
}

/** Вид товара: фасовка со своим штрихкодом, ценой и остатком. */
export interface Variant {
  id: string;
  org_id: string;
  product_id: string;
  /** Подпись внутри товара: «0,5 л». У товара с одним видом может быть пустой. */
  label: string;
  barcode: string;
  unit: Unit;
  price: number;
  /** Кратность заказа: товар отпускается упаковками. */
  pack_qty: number;
  /** Своё фото вида; пусто — берётся фото товара. */
  image_url: string;
  /** В продаже: вид виден магазинам. */
  active: boolean;
  /** Остаток учитывается: заказать можно не больше свободного. */
  track_stock: boolean;
  min_stock: number | null;
  sort: number;
  archived: boolean;
}

/** Строка функции company_stats: продажи и остатки одного вида. */
export interface VariantStats {
  variant_id: string;
  /** Сумма по всем филиалам; null — остаток не учитывается. */
  stock: number | null;
  /** Заказано магазинами и ещё не отгружено. */
  reserved: number;
  sold_qty: number;
  sold_sum: number;
  sold_qty_30: number;
  orders_count: number;
  stores_count: number;
  last_sold_at: string | null;
}

export interface StockMoveRow {
  id: number;
  branch_id: string;
  variant_id: string;
  delta: number;
  qty_after: number;
  reason: 'adjust' | 'import' | 'shipment';
  order_id: string | null;
  comment: string;
  created_at: string;
}

export const STOCK_REASON: Record<StockMoveRow['reason'], string> = {
  adjust: 'Правка остатка',
  import: 'Загрузка прайса',
  shipment: 'Отгрузка заказа',
};

/** Строка функции store_offers: вид товара компании глазами магазина. */
export interface Offer {
  variant_id: string;
  company_id: string;
  company_name: string;
  min_order: number;
  product_id: string;
  product_name: string;
  label: string;
  category: string;
  description: string;
  image_url: string;
  barcode: string;
  unit: Unit;
  price: number;
  pack_qty: number;
  /** Свободный остаток в филиале, который обслуживает магазин; null — без ограничения. */
  free: number | null;
  branch_id: string | null;
  branch_name: string;
  /** У компании есть филиал в городе магазина. */
  local: boolean;
}

/** Строка функции company_directory: карточка компании на витрине. */
export interface CompanyCard {
  id: string;
  name: string;
  logo_url: string;
  phone: string;
  company_type: CompanyType;
  description: string;
  min_order: number;
  delivery_note: string;
  payment_terms: string;
  verified: boolean;
  products: number;
  categories: string[];
  images: string[];
  cities: string[];
  city_ids: number[];
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
  variant_id: string | null;
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
  /** Филиал компании, который собирает заказ. */
  branch_id: string | null;
  branch_name: string;
  store_city: string;
  store_phone: string;
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
  city_id: number | null;
  phone: string;
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
  /** Компания на площадке, с которой связан этот поставщик. */
  partner_org_id: string | null;
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
