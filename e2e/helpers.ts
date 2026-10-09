import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

/** Вход владельцем демо-магазина (npm run seed): у него один магазин с открытой сегодняшней сменой. */
export async function signIn(page: Page) {
  if (!env.DEMO_EMAIL || !env.DEMO_PASSWORD) throw new Error('В .env.local нужны DEMO_EMAIL и DEMO_PASSWORD (npm run setup)');
  await page.goto('/');
  await page.getByLabel('Почта или логин').fill(env.DEMO_EMAIL);
  await page.getByLabel('Пароль').fill(env.DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Показатели по магазинам' })).toBeVisible();
}

/** Ошибки страницы: необработанные исключения и console.error. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}
