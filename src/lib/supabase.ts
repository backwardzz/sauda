import { createClient } from '@supabase/supabase-js';

// вне Vite (тесты под Node) import.meta.env не существует
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const db = createClient(url || 'http://127.0.0.1:54321', key || 'missing');
/** Адрес и публичный ключ проекта: их же указывает учётная система компании в запросах к API. */
export const API_URL = `${url || 'http://127.0.0.1:54321'}/rest/v1/rpc`;
export const PUBLIC_KEY = key || '';

const KNOWN_ERRORS: [RegExp, string][] = [
  [/company_variants_barcode_uq/, 'Вид товара с таким штрихкодом уже есть в каталоге'],
  [/products_barcode_uq/, 'Товар с таким штрихкодом уже есть'],
  [/company_stock_qty_check/, 'Остаток не может стать отрицательным'],
  [/stores_city_required/, 'Укажите город торговой точки'],
  [/permission denied for table/, 'Недостаточно прав для этого действия'],
  [/invites_org_id_email_key/, 'Этот адрес уже приглашён'],
  [/row-level security/, 'Недостаточно прав для этого действия'],
  [/violates foreign key constraint/, 'Запись используется в других документах'],
  [/Invalid login credentials/, 'Неверная почта или пароль'],
  [/User already registered/, 'Пользователь с такой почтой уже зарегистрирован'],
  [/Password should be at least/, 'Пароль слишком короткий: нужно минимум 6 символов'],
  [/Password should contain/, 'Пароль слишком простой: нужны и буквы, и цифры'],
  [/Email not confirmed/, 'Почта не подтверждена: введите код из письма'],
  [/Token has expired or is invalid|otp_expired/, 'Код неверный или устарел. Проверьте его или запросите новый'],
  [/captcha/i, 'Проверка «я не робот» не пройдена, попробуйте ещё раз'],
  [/you can only request this after|rate limit/i, 'Слишком много попыток. Подождите немного и повторите'],
  [/Failed to fetch|NetworkError/, 'Нет связи с сервером'],
];

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
  for (const [re, text] of KNOWN_ERRORS) if (re.test(msg)) return text;
  return msg;
}

/** Разворачивает ответ supabase-js: возвращает данные или бросает ошибку с понятным текстом. */
export async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(errorText(error));
  return data as T;
}

/** Строка поиска → безопасный фрагмент для фильтров PostgREST (запятые и скобки ломают синтаксис or()). */
export function safeTerm(s: string): string {
  return s.replace(/[,()%*\\"]/g, ' ').trim();
}
