// Первый запуск на новом компьютере: локальная база, .env.local, демо-данные и вход разработчика.
// Запуск: npm run setup (нужны Node.js 22 и запущенный Docker). Повторный запуск безопасен: .env.local не перезаписывается.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit' });
const read = (cmd: string) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) throw new Error(`Нужен Node.js 22 или новее, сейчас ${process.versions.node} (версия указана в .nvmrc)`);
try {
  read('docker info');
} catch {
  throw new Error('Docker не запущен: запустите Docker Desktop и повторите');
}

console.log('\n1. Локальная база Supabase');
run('npm run db:start');

const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  console.log('\n2. .env.local уже есть — оставляю как есть');
} else {
  console.log('\n2. Создаю .env.local');
  // строки вида KEY="value"
  const status = Object.fromEntries(
    read('npx supabase status -o env')
      .split(/\r?\n/)
      .map((l) => /^(\w+)="?(.*?)"?$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
  const email = 'demo@sauda.test';
  const password = randomBytes(9).toString('base64url');
  writeFileSync(envFile, [
    `VITE_SUPABASE_URL=${status.API_URL}`,
    `VITE_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
    'VITE_TURNSTILE_SITE_KEY=',
    `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
    `DEMO_EMAIL=${email}`,
    `DEMO_PASSWORD=${password}`,
    '',
  ].join('\n'));
  // .env.local удалили, а база осталась: демо-вход получает новый пароль, иначе сидер не войдёт
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const demo = data?.users.find((u) => u.email === email);
  if (demo) await admin.auth.admin.updateUserById(demo.id, { password });
}

console.log('\n3. Демо-данные');
run('npm run seed');
run('npm run dev-user');

console.log('\nГотово: npm run dev — сайт; вход dev / admin1 или демо-почта и пароль из .env.local');
