// Все страницы кабинета магазина открываются без ошибок: страницы грузятся по требованию,
// и сломанный импорт или запрос к несуществующей колонке иначе всплывёт только у пользователя.
import { expect, test } from '@playwright/test';
import { collectErrors, signIn } from './helpers';

const PAGES: [string, string][] = [
  ['/', 'Показатели по магазинам'],
  ['/products', 'Список товаров'],
  ['/products/new', 'Товар | Создание'],
  ['/stock', 'Склад'],
  ['/quick', 'Быстрые товары'],
  ['/docs/supply', 'Приёмка'],
  ['/docs/writeoff', 'Списание'],
  ['/docs/inventory', 'Инвентаризация'],
  ['/sales', 'Чеки'],
  ['/returns', 'Возвраты покупателей'],
  ['/canceled', 'Отменённые товары'],
  ['/reports/sales', 'Статистика продаж'],
  ['/reports/shifts', 'Отчёты по сменам'],
  ['/reports/cashiers', 'Отчёты по кассирам'],
  ['/reports/discounts', 'Отчёт по скидкам'],
  ['/reports/pnl', 'Прибыли и убытки'],
  ['/reports/abc', 'ABC-анализ'],
  ['/catalog', 'Каталог товаров'],
  ['/market', 'Компании'],
  ['/orders', 'Мои заказы'],
  ['/customers', 'Покупатели'],
  ['/suppliers', 'Поставщики'],
  ['/users', 'Пользователи'],
  ['/registers', 'Управление кассами'],
  ['/stores', 'Торговые точки'],
  ['/profile', 'Профиль магазина'],
];

test('страницы кабинета открываются без ошибок', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  for (const [path, heading] of PAGES) {
    await test.step(path, async () => {
      await page.goto(`/#${path}`);
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Загрузка…', { timeout: 10_000 });
      expect(errors, `ошибки на ${path}`).toEqual([]);
    });
  }
});
