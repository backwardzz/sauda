import { createClient } from '@supabase/supabase-js';

// вне Vite (тесты под Node) import.meta.env не существует
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const db = createClient(url || 'http://127.0.0.1:54321', key || 'missing');

const KNOWN_ERRORS: [RegExp, string][] = [
  [/products_barcode_uq/, 'Товар с таким штрихкодом уже есть'],
  [/invites_org_id_email_key/, 'Этот адрес уже приглашён'],
  [/row-level security/, 'Недостаточно прав для этого действия'],
  [/violates foreign key constraint/, 'Запись используется в других документах'],
  [/Invalid login credentials/, 'Неверная почта или пароль'],
  [/User already registered/, 'Пользователь с такой почтой уже зарегистрирован'],
  [/Password should be at least/, 'Пароль слишком короткий: нужно минимум 6 символов'],
  [/Email not confirmed/, 'Почта не подтверждена: перейдите по ссылке из письма'],
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
