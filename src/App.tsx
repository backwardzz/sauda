import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase';
import { useSession } from './lib/session';
import { AuthPage } from './pages/Auth';
import { Onboarding } from './pages/Onboarding';
import { Layout } from './pages/Layout';

const RELOADED = 'sauda:chunk-reload';

/**
 * Ленивая страница из именованного экспорта модуля. После новой выкладки старых файлов страниц на сервере нет:
 * открытая вкладка один раз перезагружается и получает новую сборку.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function page<K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) {
  return lazy(() =>
    load().then(
      (m) => {
        try { sessionStorage.removeItem(RELOADED); } catch { /* без хранилища */ }
        return { default: m[name] };
      },
      (e) => {
        let first = true;
        try {
          first = !sessionStorage.getItem(RELOADED);
          sessionStorage.setItem(RELOADED, '1');
        } catch { first = false; }
        if (first) location.reload();
        throw e;
      },
    ),
  );
}

// Страницы грузятся по требованию: кассир не качает кабинет владельца, компания — кассу магазина.
const Dashboard = page(() => import('./pages/Dashboard'), 'Dashboard');
const Products = page(() => import('./pages/Products'), 'Products');
const ProductCard = page(() => import('./pages/ProductCard'), 'ProductCard');
const Stock = page(() => import('./pages/Stock'), 'Stock');
const QuickProducts = page(() => import('./pages/QuickProducts'), 'QuickProducts');
const StockDocs = page(() => import('./pages/StockDocs'), 'StockDocs');
const StockDocEditor = page(() => import('./pages/StockDocEditor'), 'StockDocEditor');
const InvoiceImport = page(() => import('./pages/InvoiceImport'), 'InvoiceImport');
const Sales = page(() => import('./pages/Sales'), 'Sales');
const Canceled = page(() => import('./pages/Canceled'), 'Canceled');
const SalesStats = page(() => import('./pages/reports/SalesStats'), 'SalesStats');
const ShiftsReport = page(() => import('./pages/reports/Shifts'), 'ShiftsReport');
const CashiersReport = page(() => import('./pages/reports/Cashiers'), 'CashiersReport');
const DiscountsReport = page(() => import('./pages/reports/Discounts'), 'DiscountsReport');
const PnlReport = page(() => import('./pages/reports/Pnl'), 'PnlReport');
const AbcReport = page(() => import('./pages/reports/Abc'), 'AbcReport');
const Contractors = page(() => import('./pages/manage/Contractors'), 'Contractors');
const Users = page(() => import('./pages/manage/Users'), 'Users');
const Registers = page(() => import('./pages/manage/Registers'), 'Registers');
const Stores = page(() => import('./pages/manage/Stores'), 'Stores');
const Pos = page(() => import('./pages/Pos'), 'Pos');
const Market = page(() => import('./pages/market/Market'), 'Market');
const MarketCompany = page(() => import('./pages/market/MarketCompany'), 'MarketCompany');
const CartPage = page(() => import('./pages/market/Cart'), 'CartPage');
const Orders = page(() => import('./pages/market/Orders'), 'Orders');
const OrderView = page(() => import('./pages/market/OrderView'), 'OrderView');
const Catalog = page(() => import('./pages/catalog/Catalog'), 'Catalog');
const NewStore = page(() => import('./pages/catalog/NewStore'), 'NewStore');
const CompanyHome = page(() => import('./pages/company/CompanyHome'), 'CompanyHome');
const CompanyCatalog = page(() => import('./pages/company/CompanyCatalog'), 'CompanyCatalog');
const CompanyProduct = page(() => import('./pages/company/CompanyProduct'), 'CompanyProduct');
const CompanyGeo = page(() => import('./pages/company/CompanyGeo'), 'CompanyGeo');
const PriceAccess = page(() => import('./pages/company/PriceAccess'), 'PriceAccess');
const CompanyStock = page(() => import('./pages/company/CompanyStock'), 'CompanyStock');
const Profile = page(() => import('./pages/profile/Profile'), 'Profile');

const pageLoading = <div className="auth muted">Загрузка…</div>;

export function App() {
  const { user, loading, org, company, store, canManage } = useSession();

  if (!configured) {
    return (
      <div className="auth">
        <div className="auth-card stack">
          <h1>Не задано подключение к базе</h1>
          <p className="muted">
            Скопируйте <code>.env.example</code> в <code>.env.local</code> и укажите адрес и ключ Supabase.
          </p>
        </div>
      </div>
    );
  }
  if (loading) return <div className="auth muted">Загрузка…</div>;
  if (!user) return <AuthPage />;
  if (!org) return <Onboarding />;

  // Компания (производитель, дистрибьютор): каталог, склад и заказы магазинов, без кассы.
  if (org.kind === 'company') {
    // при переключении аккаунта витрина компании подгружается следом за списком организаций
    if (company?.org_id !== org.id) return <div className="auth muted">Загрузка…</div>;
    return (
      <Suspense fallback={pageLoading}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CompanyHome />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderView />} />
            <Route path="/catalog" element={<CompanyCatalog />} />
            <Route path="/catalog/:id" element={<CompanyProduct />} />
            <Route path="/stock" element={<CompanyStock />} />
            <Route path="/analytics" element={<CompanyGeo />} />
            <Route path="/price-access" element={<PriceAccess />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/users" element={<Users />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  }

  // страницы магазина не рисуются, пока не подгружены его торговые точки (например, сразу после переключения с компании)
  if (store?.org_id !== org.id) return <div className="auth muted">Загрузка…</div>;

  // Кассиру доступна касса и чеки; справочники, склад и отчёты — владельцу и менеджеру.
  if (!canManage) {
    return (
      <Suspense fallback={pageLoading}>
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route element={<Layout />}>
            <Route path="/sales" element={<Sales kind="sale" />} />
            <Route path="/returns" element={<Sales kind="return" />} />
          </Route>
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={pageLoading}>
      <Routes>
        <Route path="/pos" element={<Pos />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<ProductCard />} />
          <Route path="/products/:id" element={<ProductCard />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/catalog/starter" element={<NewStore />} />
          <Route path="/quick" element={<QuickProducts />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/invoice" element={<InvoiceImport />} />
          <Route path="/market" element={<Market />} />
          <Route path="/market/:id" element={<MarketCompany />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderView />} />
          <Route path="/docs/:kind" element={<StockDocs />} />
          <Route path="/docs/:kind/:id" element={<StockDocEditor />} />
          <Route path="/sales" element={<Sales kind="sale" />} />
          <Route path="/returns" element={<Sales kind="return" />} />
          <Route path="/canceled" element={<Canceled />} />
          <Route path="/reports/sales" element={<SalesStats />} />
          <Route path="/reports/shifts" element={<ShiftsReport />} />
          <Route path="/reports/cashiers" element={<CashiersReport />} />
          <Route path="/reports/discounts" element={<DiscountsReport />} />
          <Route path="/reports/pnl" element={<PnlReport />} />
          <Route path="/reports/abc" element={<AbcReport />} />
          <Route path="/customers" element={<Contractors kind="customer" />} />
          <Route path="/suppliers" element={<Contractors kind="supplier" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/users" element={<Users />} />
          <Route path="/registers" element={<Registers />} />
          <Route path="/stores" element={<Stores />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
