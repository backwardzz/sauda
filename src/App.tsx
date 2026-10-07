import { Navigate, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase';
import { useSession } from './lib/session';
import { AuthPage } from './pages/Auth';
import { Onboarding } from './pages/Onboarding';
import { Layout } from './pages/Layout';
import { Dashboard } from './pages/Dashboard';
import { Products } from './pages/Products';
import { ProductCard } from './pages/ProductCard';
import { Stock } from './pages/Stock';
import { QuickProducts } from './pages/QuickProducts';
import { StockDocs } from './pages/StockDocs';
import { StockDocEditor } from './pages/StockDocEditor';
import { InvoiceImport } from './pages/InvoiceImport';
import { Sales } from './pages/Sales';
import { Canceled } from './pages/Canceled';
import { SalesStats } from './pages/reports/SalesStats';
import { ShiftsReport } from './pages/reports/Shifts';
import { CashiersReport } from './pages/reports/Cashiers';
import { DiscountsReport } from './pages/reports/Discounts';
import { PnlReport } from './pages/reports/Pnl';
import { AbcReport } from './pages/reports/Abc';
import { Contractors } from './pages/manage/Contractors';
import { Users } from './pages/manage/Users';
import { Registers } from './pages/manage/Registers';
import { Stores } from './pages/manage/Stores';
import { Pos } from './pages/Pos';
import { Market } from './pages/market/Market';
import { MarketCompany } from './pages/market/MarketCompany';
import { CartPage } from './pages/market/Cart';
import { Orders } from './pages/market/Orders';
import { OrderView } from './pages/market/OrderView';
import { Catalog } from './pages/catalog/Catalog';
import { NewStore } from './pages/catalog/NewStore';
import { CompanyHome } from './pages/company/CompanyHome';
import { CompanyCatalog } from './pages/company/CompanyCatalog';
import { CompanyProduct } from './pages/company/CompanyProduct';
import { CompanyGeo } from './pages/company/CompanyGeo';
import { CompanyStock } from './pages/company/CompanyStock';
import { Profile } from './pages/profile/Profile';

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
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<CompanyHome />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderView />} />
          <Route path="/catalog" element={<CompanyCatalog />} />
          <Route path="/catalog/:id" element={<CompanyProduct />} />
          <Route path="/stock" element={<CompanyStock />} />
          <Route path="/analytics" element={<CompanyGeo />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/users" element={<Users />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // страницы магазина не рисуются, пока не подгружены его торговые точки (например, сразу после переключения с компании)
  if (store?.org_id !== org.id) return <div className="auth muted">Загрузка…</div>;

  // Кассиру доступна касса и чеки; справочники, склад и отчёты — владельцу и менеджеру.
  if (!canManage) {
    return (
      <Routes>
        <Route path="/pos" element={<Pos />} />
        <Route element={<Layout />}>
          <Route path="/sales" element={<Sales kind="sale" />} />
          <Route path="/returns" element={<Sales kind="return" />} />
        </Route>
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    );
  }

  return (
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
  );
}
