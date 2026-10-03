// Создаёт вход для разработки (логин dev, пароль admin1) в базе из .env.local — локальной или облачной.
// В облаке письмо не отправляется: почта dev@sauda.test сразу считается подтверждённой.
// Запуск: npm run dev-user. Нужны VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('В .env.local нужны VITE_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (Settings → API в панели Supabase)');
}

const DEV_EMAIL = 'dev@sauda.test';
const DEV_PASSWORD = 'admin1';
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (list.error) throw list.error;
  const user = list.data.users.find((u) => u.email === DEV_EMAIL);
  const res = user
    ? await admin.auth.admin.updateUserById(user.id, { password: DEV_PASSWORD, email_confirm: true })
    : await admin.auth.admin.createUser({ email: DEV_EMAIL, password: DEV_PASSWORD, email_confirm: true, user_metadata: { full_name: 'Разработчик' } });
  if (res.error) throw res.error;
  console.log(`${user ? 'Пароль обновлён' : 'Вход создан'}: логин dev, пароль ${DEV_PASSWORD} — база ${env.VITE_SUPABASE_URL}`);
  console.log('После первого входа сайт предложит создать компанию.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
