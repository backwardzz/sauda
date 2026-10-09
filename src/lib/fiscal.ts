import { db } from './supabase';

/** Ответ серверной функции fiscal: ошибка приходит текстом для кассира. */
async function invoke(body: Record<string, string>): Promise<{ sent?: number; failed?: number }> {
  const { data, error } = await db.functions.invoke('fiscal', { body });
  if (error) {
    // у FunctionsHttpError текст ошибки лежит в теле ответа
    const ctx = (error as { context?: Response }).context;
    const reply = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error(reply?.error ?? 'Нет связи с сервером фискализации');
  }
  return data;
}

/**
 * Дослать в Webkassa неотправленные чеки кассы. Вызывается после продажи, возврата и операции с наличными
 * без ожидания: продажа уже проведена, а статус чека видно в окне чека и в шапке кассы.
 */
export function fiscalFlush(registerId: string) {
  return invoke({ action: 'flush', register_id: registerId });
}

/** Дослать чеки и снять Z-отчёт в Webkassa — после этого смену можно закрыть. */
export function fiscalZReport(shiftId: string) {
  return invoke({ action: 'z_report', shift_id: shiftId });
}
