import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorText } from '../lib/supabase';
import { useSession } from '../lib/session';
import { useAction } from '../ui/useAction';
import { createOrg } from '../api/org';

/**
 * Первый вход: у пользователя ещё нет организации.
 * После регистрации торговая точка или поставщик создаются сами из данных формы — человек видит только «Создаём кабинет…».
 * Приглашённые сюда не попадают: их пускает приглашение.
 */
export function Onboarding() {
  const { user, reload, signOut } = useSession();
  const navigate = useNavigate();
  const meta = (user?.user_metadata ?? {}) as {
    account_kind?: string; city_id?: number; phone?: string; full_name?: string; name?: string; org_name?: string; business?: string;
  };
  const kind = meta.account_kind === 'company' ? 'company' : 'store';
  const isStore = kind === 'store';
  const business = meta.business === 'pharmacy' ? 'pharmacy' : 'grocery';
  // всё нужное спросила форма регистрации; адрес, БИН, тип и описание компании заполняются позже в профиле
  const complete = (meta.account_kind === 'store' || meta.account_kind === 'company') && !!meta.org_name?.trim() && typeof meta.city_id === 'number';
  const [busy, run] = useAction(complete);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const create = () => {
    setError(null);
    return run(async () => {
      await createOrg({
        name: meta.org_name ?? '', kind, business, cityId: meta.city_id ?? null,
        phone: meta.phone ?? '', email: user?.email ?? '', contactName: meta.full_name ?? meta.name ?? '',
      });
      // новой торговой точке сразу предлагаются пакеты ходовых товаров с ценами компаний
      if (isStore && business === 'grocery') navigate('/catalog/starter');
      await reload();
    }, { keepBusy: true, onError: (e) => setError(errorText(e)) });
  };

  useEffect(() => {
    // в режиме разработки эффект запускается дважды: вторая организация не нужна
    if (!complete || started.current) return;
    started.current = true;
    void create();
    // запускается один раз при открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (complete && busy) return <div className="auth muted">{isStore ? 'Создаём кабинет торговой точки…' : 'Создаём кабинет поставщика…'}</div>;

  return (
    <div className="auth">
      <div className="auth-card stack">
        <div className="brand"><span className="brand-mark">S</span>Sauda</div>
        {complete ? (
          <>
            <h2>Не получилось создать кабинет</h2>
            <p className="error-text">{error}</p>
            <button type="button" className="btn primary large" onClick={() => void create()}>Повторить</button>
          </>
        ) : (
          <>
            <h2>Нет доступа</h2>
            <p>
              Аккаунт <b>{user?.email}</b> не привязан ни к одной торговой точке или компании.
              Попросите владельца пригласить этот адрес в разделе «Сотрудники» и войдите снова.
            </p>
            <button type="button" className="btn primary large" disabled={busy}
              onClick={() => run(reload)}>
              Проверить снова
            </button>
          </>
        )}
        <button type="button" className="btn ghost" onClick={signOut}>Выйти из {user?.email}</button>
      </div>
    </div>
  );
}
