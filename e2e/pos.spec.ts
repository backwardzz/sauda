// Касса глазами кассира: продажа, чек, возврат по номеру чека.
import { expect, test } from '@playwright/test';
import { collectErrors, signIn } from './helpers';

test('продажа и возврат на кассе', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto('/#/pos');

  // плитка быстрого товара → строка чека
  await page.locator('button', { hasText: 'Булочка с маком' }).click();
  await expect(page.getByText('Позиций: 1, товаров: 1')).toBeVisible();

  // кнопка оплаты должна быть на экране без прокрутки: кассир не ищет её
  const payButton = page.getByRole('button', { name: 'Оплатить' });
  await expect(payButton).toBeInViewport();
  await payButton.click();
  await expect(page.getByRole('heading', { name: 'Оплата' })).toBeVisible();
  await page.getByRole('button', { name: 'Провести продажу' }).click();

  const receipt = page.getByRole('heading', { name: /^Чек № \d+$/ });
  await expect(receipt).toBeVisible();
  const number = Number((await receipt.innerText()).replace(/\D/g, ''));
  await page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(page.getByText('Позиций: 0, товаров: 0')).toBeVisible();

  // возврат всего чека по номеру
  await page.getByRole('button', { name: 'Возврат' }).first().click();
  await page.getByLabel('Номер чека продажи').fill(String(number));
  await page.getByRole('button', { name: 'Найти чек' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`^Возврат по чеку № ${number} `) })).toBeVisible();
  await page.getByRole('button', { name: 'Всё', exact: true }).first().click();
  await page.getByRole('button', { name: 'Оформить возврат' }).click();
  await expect(page.getByRole('heading', { name: /^Возврат № \d+$/ })).toBeVisible();

  expect(errors).toEqual([]);
});
