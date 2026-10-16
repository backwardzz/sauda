// Вход и сессия. Страницы берут клиент входа отсюда, а не из подключения к базе.
import { db } from '../lib/supabase';

export const auth = db.auth;
