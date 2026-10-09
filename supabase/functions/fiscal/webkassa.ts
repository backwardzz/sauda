// Запросы к Webkassa. Без импортов: файл подключают и серверная функция (Deno), и юнит-тесты (Node).
//
// Коды и поля взяты из открытых интеграций (Postman-коллекция Webkassa в кабинете интегратора их подтвердит):
// базовый адрес https://devkkm.webkassa.kz/api/ (тест), методы Authorize → Token, Check, MoneyOperation, ZReport.
// TODO(webkassa-docs): сверить коды OperationType, PaymentType, TaxType, UnitCode с документацией.

export const WEBKASSA_TEST_URL = 'https://devkkm.webkassa.kz/api/';

/** Тип операции чека. */
export const OPERATION = { buy: 0, buyReturn: 1, sell: 2, sellReturn: 3 } as const;
export const PAYMENT = { cash: 0, card: 1 } as const;
export const TAX = { none: 0, vat: 100 } as const;
export const MONEY_OPERATION = { in: 0, out: 1 } as const;
/** Единицы измерения по классификатору (МКЕИ). */
export const UNIT_CODE: Record<string, number> = { шт: 796, кг: 166, л: 112, м: 6 };

export interface SaleForCheck {
  id: string;
  kind: 'sale' | 'return';
  total: number;
  paid_cash: number;
  paid_card: number;
  items: { name: string; barcode: string; unit: string; qty: number; price: number; discount: number; total: number }[];
}

const money = (n: number) => Math.round(n * 100) / 100;

/** НДС внутри суммы: ставка rate% уже включена в цену. */
export const vatIn = (sum: number, rate: number) => money((sum * rate) / (100 + rate));

/**
 * Тело запроса Check для продажи или возврата Sauda.
 * ExternalCheckNumber — id чека Sauda: повтор того же запроса не пробивает второй фискальный чек.
 * vatRate: null — организация не плательщик НДС.
 */
export function checkRequest(token: string, cashbox: string, sale: SaleForCheck, vatRate: number | null) {
  const payments = [
    { Sum: money(Number(sale.paid_cash)), PaymentType: PAYMENT.cash },
    { Sum: money(Number(sale.paid_card)), PaymentType: PAYMENT.card },
  ].filter((p) => p.Sum > 0);
  return {
    Token: token,
    CashboxUniqueNumber: cashbox,
    OperationType: sale.kind === 'sale' ? OPERATION.sell : OPERATION.sellReturn,
    Positions: sale.items.map((i) => ({
      Count: Number(i.qty),
      Price: money(Number(i.price)),
      Discount: money(Number(i.discount)),
      Markup: 0,
      TaxType: vatRate == null ? TAX.none : TAX.vat,
      TaxPercent: vatRate ?? 0,
      Tax: vatRate == null ? 0 : vatIn(Number(i.total), vatRate),
      PositionName: i.name.slice(0, 250),
      PositionCode: i.barcode || undefined,
      UnitCode: UNIT_CODE[i.unit] ?? UNIT_CODE['шт'],
    })),
    // пустой чек без оплат (полная скидка) Webkassa не примет — такой чек считается наличными на 0
    Payments: payments.length ? payments : [{ Sum: 0, PaymentType: PAYMENT.cash }],
    Change: 0,
    ExternalCheckNumber: sale.id,
  };
}

export function moneyRequest(token: string, cashbox: string, kind: 'in' | 'out', amount: number, id: string) {
  return {
    Token: token,
    CashboxUniqueNumber: cashbox,
    OperationType: MONEY_OPERATION[kind],
    Sum: money(Number(amount)),
    ExternalCheckNumber: id,
  };
}

export interface WebkassaReply<T> {
  Data?: T;
  Errors?: { Code: number; Text: string }[];
}

/** Ответ Webkassa → данные или текст ошибки для кассира. */
export function unwrap<T>(reply: WebkassaReply<T>): { data: T } | { error: string; code?: number } {
  if (reply.Errors?.length) {
    const e = reply.Errors[0];
    return { error: e.Text || `Ошибка Webkassa ${e.Code}`, code: e.Code };
  }
  if (reply.Data === undefined) return { error: 'Webkassa вернула пустой ответ' };
  return { data: reply.Data };
}
