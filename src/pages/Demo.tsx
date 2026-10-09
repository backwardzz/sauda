import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { db, errorText } from '../lib/supabase';
import { AUTH_MODE_KEY } from './Auth';

/** Выйти из демо и открыть регистрацию. */
async function toRegistration(signOut: () => Promise<void>) {
  try { sessionStorage.setItem(AUTH_MODE_KEY, 'register'); } catch { /* откроется вход */ }
  await signOut();
}

/** Анонимный вход без магазина: база создаёт демо-магазин (повторный вызов вернёт уже созданный). */
export function DemoStarter() {
  const { reload, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    db.rpc('start_demo').then(({ error }) => {
      if (!alive) return;
      if (error) setError(errorText(error));
      else void reload();
    });
    return () => { alive = false; };
  }, [reload]);

  return (
    <div className="auth">
      <div className="auth-card stack">
        <div className="brand"><span className="brand-mark">S</span>Sauda</div>
        {error ? (
          <>
            <p className="error-text">Не удалось открыть демо: {error}</p>
            <button className="btn" onClick={signOut}>Вернуться ко входу</button>
          </>
        ) : (
          <p className="muted">Готовим демо-магазин: товары, остатки и продажи за две недели…</p>
        )}
      </div>
    </div>
  );
}

/** Плашка над кабинетом демо-магазина. */
export function DemoBanner() {
  const { signOut } = useSession();
  return (
    <div className="demo-banner">
      <span>
        <b>Демо-магазин.</b> Пробивайте чеки, принимайте товар, смотрите отчёты — данные удалятся через 3 дня.
        Заказы компаниям и Webkassa в демо отключены.
      </span>
      <button className="btn small primary" onClick={() => toRegistration(signOut)}>Зарегистрироваться</button>
    </div>
  );
}
