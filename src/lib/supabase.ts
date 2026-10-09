import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// вне Vite (тесты под Node) import.meta.env не существует
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
// типы таблиц и функций генерируются из схемы: npm run db:types
export const db = createClient<Database>(url || 'http://127.0.0.1:54321', key || 'missing');
/** Адрес и публичный ключ проекта: их же указывает учётная система компании в запросах к API. */
export const API_URL = `${url || 'http://127.0.0.1:54321'}/rest/v1/rpc`;
export const PUBLIC_KEY = key || '';

const NO_RIGHTS = 'Недостаточно прав для этого действия';
const BAD_CODE = 'Код неверный или устарел. Проверьте его или запросите новый';
const TOO_OFTEN = 'Слишком много попыток. Подождите немного и повторите';

/** Нарушенное ограничение базы — по его имени: имена наши и не меняются вместе с текстом ошибки Postgres. */
const CONSTRAINTS: [RegExp, string][] = [
  [/company_variants_barcode_uq/, 'Вид товара с таким штрихкодом уже есть в каталоге'],
  [/products_barcode_uq/, 'Товар с таким штрихкодом уже есть'],
  [/company_stock_qty_check/, 'Остаток не может стать отрицательным'],
  [/stores_city_required/, 'Укажите город торговой точки'],
  [/invites_org_id_email_key/, 'Этот адрес уже приглашён'],
];

/** Коды ошибок: SQLSTATE от Postgres и code от Supabase Auth. Не зависят от формулировок и языка сообщений. */
const CODES: Record<string, string> = {
  '42501': NO_RIGHTS, // insufficient_privilege: в том числе отказ правил RLS
  '23503': 'Запись используется в других документах', // foreign_key_violation
  invalid_credentials: 'Неверная почта или пароль',
  user_already_exists: 'Пользователь с такой почтой уже зарегистрирован',
  email_exists: 'Пользователь с такой почтой уже зарегистрирован',
  email_not_confirmed: 'Почта не подтверждена: введите код из письма',
  otp_expired: BAD_CODE,
  captcha_failed: 'Проверка «я не робот» не пройдена, попробуйте ещё раз',
  over_request_rate_limit: TOO_OFTEN,
  over_email_send_rate_limit: TOO_OFTEN,
};

/** По тексту — запасной путь: для ошибок без кода (сеть) и для старых версий сервера. */
const MESSAGES: [RegExp, string][] = [
  [/permission denied for table/, NO_RIGHTS],
  [/row-level security/, NO_RIGHTS],
  [/violates foreign key constraint/, 'Запись используется в других документах'],
  [/Invalid login credentials/, 'Неверная почта или пароль'],
  [/User already registered/, 'Пользователь с такой почтой уже зарегистрирован'],
  [/Password should be at least/, 'Пароль слишком короткий: нужно минимум 6 символов'],
  [/Password should contain/, 'Пароль слишком простой: нужны и буквы, и цифры'],
  [/Email not confirmed/, 'Почта не подтверждена: введите код из письма'],
  [/Token has expired or is invalid|otp_expired/, BAD_CODE],
  [/captcha/i, 'Проверка «я не робот» не пройдена, попробуйте ещё раз'],
  [/you can only request this after|rate limit/i, TOO_OFTEN],
  [/Failed to fetch|NetworkError/, 'Нет связи с сервером'],
];

export function errorText(e: unknown): string {
  const obj = typeof e === 'object' && e ? (e as { message?: unknown; code?: unknown }) : {};
  const msg = e instanceof Error ? e.message : 'message' in obj ? String(obj.message) : String(e);
  for (const [re, text] of CONSTRAINTS) if (re.test(msg)) return text;
  const code = typeof obj.code === 'string' ? obj.code : '';
  if (CODES[code]) return CODES[code];
  for (const [re, text] of MESSAGES) if (re.test(msg)) return text;
  return msg;
}

/** Разворачивает ответ supabase-js: возвращает данные или бросает ошибку с понятным текстом. */
// Тип результата задаёт вызывающий: строки часто читаются в типы приложения из types.ts, а не в сырые строки схемы.
export async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(errorText(error));
  return data as T;
}

/** Строка поиска → безопасный фрагмент для фильтров PostgREST (запятые и скобки ломают синтаксис or()). */
export function safeTerm(s: string): string {
  return s.replace(/[,()%*\\"]/g, ' ').trim();
}
