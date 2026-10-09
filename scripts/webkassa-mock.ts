// Двойник Webkassa для разработки без доступа к их тестовому стенду: отвечает на Authorize, Check,
// MoneyOperation и ZReport в том же формате и печатает запросы. Функция fiscal ходит сюда,
// если в supabase/functions/.env указано WEBKASSA_URL=http://host.docker.internal:8788/api/
// Запуск: npx tsx scripts/webkassa-mock.ts [порт]. FAIL=1 — отвечать ошибкой на чеки (проверка очереди).
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8788);
let check = 0;
let shiftOpen = false;
const seen = new Map<string, number>();

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const method = (req.url ?? '').replace(/^\/api\//, '');
    const body = raw ? JSON.parse(raw) : {};
    console.log('%s %s', method, JSON.stringify({ ...body, Password: body.Password ? '***' : undefined }));
    const reply = (data: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const error = (Code: number, Text: string) => reply({ Errors: [{ Code, Text }] });

    if (method === 'Authorize') {
      return body.Login && body.Password ? reply({ Data: { Token: 'mock-token' } }) : error(1, 'Неверный логин или пароль');
    }
    if (body.Token !== 'mock-token') return error(2, 'Срок действия токена истёк');
    if (method === 'Check' || method === 'MoneyOperation') {
      if (process.env.FAIL) return error(500, 'Сервис временно недоступен');
      // повтор с тем же ExternalCheckNumber возвращает уже пробитый чек
      const number = seen.get(body.ExternalCheckNumber) ?? ++check;
      seen.set(body.ExternalCheckNumber, number);
      shiftOpen = true;
      return reply({
        Data: {
          CheckNumber: String(1000 + number),
          DateTime: new Date().toISOString(),
          OfflineMode: false,
          ShiftNumber: 1,
          TicketUrl: `https://example.invalid/ticket/${1000 + number}`,
        },
      });
    }
    if (method === 'ZReport') {
      if (!shiftOpen) return error(3, 'Смена не открыта');
      shiftOpen = false;
      return reply({ Data: { ReportNumber: 1, DocumentCount: check } });
    }
    return error(404, `Неизвестный метод ${method}`);
  });
}).listen(port, () => console.log(`Двойник Webkassa: http://localhost:${port}/api/`));
