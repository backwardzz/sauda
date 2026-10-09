// Типы таблиц и функций базы для клиента supabase-js: src/lib/database.types.ts.
// Запуск: npm run db:types (нужна запущенная локальная база, npm run db:start). С --check только сверяет файл со схемой.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../src/lib/database.types.ts', import.meta.url);
const raw = execSync('npx supabase gen types typescript --local --schema public', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// Генератор объявляет аргументы функций ненулевыми, хотя в Postgres любой аргумент принимает null:
// приложение передаёт null, когда фильтр не выбран («все магазины») или значение сбрасывается.
// Json-аргументы (наборы строк импорта) принимают любые сериализуемые данные, а не только тип Json.
const arg = /("\w+"\??): ([^,}]+)/g;
const types = raw
  .replace(/Args: \{([^}]*)\}/g, (_, body: string) =>
    `Args: {${body.replace(arg, (_m, name: string, type: string) => `${name}: ${type.trim() === 'Json' ? 'unknown' : `${type.trim()} | null`}`)}}`)
  .replace(/\r\n/g, '\n');

const header = '// Сгенерировано scripts/db-types.ts из схемы базы — не править вручную.\n';
const next = header + types;

if (process.argv.includes('--check')) {
  // git на Windows может отдать файл с CRLF
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== next) {
    console.error('src/lib/database.types.ts не совпадает со схемой базы: выполните npm run db:types');
    process.exit(1);
  }
  console.log('Типы базы совпадают со схемой');
} else {
  writeFileSync(target, next);
  console.log('Типы базы обновлены: src/lib/database.types.ts');
}
