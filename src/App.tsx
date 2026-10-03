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

export function App() {
  const { user, loading, org, canManage } = useSession();

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
        <Route path="/quick" element={<QuickProducts />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/invoice" element={<InvoiceImport />} />
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
        <Route path="/users" element={<Users />} />
        <Route path="/registers" element={<Registers />} />
        <Route path="/stores" element={<Stores />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
