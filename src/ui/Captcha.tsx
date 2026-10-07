import { useEffect, useRef } from 'react';

interface Turnstile {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** Ключ сайта Cloudflare Turnstile. Пока он не задан, капчи нет и формы работают без неё. */
export const CAPTCHA_KEY = env.VITE_TURNSTILE_SITE_KEY || '';

let loading: Promise<Turnstile> | null = null;
function load(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    s.onerror = () => { loading = null; reject(new Error('captcha')); };
    document.head.append(s);
  });
  return loading;
}

/**
 * Проверка «я не робот». Токен одноразовый: после каждого запроса к серверу форма меняет `round`,
 * и проверка проходит заново.
 */
export function Captcha({ round, onToken }: { round: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const report = useRef(onToken);
  report.current = onToken;

  useEffect(() => {
    if (!CAPTCHA_KEY) return;
    let id: string | null = null;
    let gone = false;
    report.current(null);
    load().then((t) => {
      if (gone || !box.current) return;
      id = t.render(box.current, {
        sitekey: CAPTCHA_KEY,
        language: 'ru',
        theme: 'light',
        size: 'flexible',
        callback: (token: string) => report.current(token),
        'expired-callback': () => report.current(null),
        'error-callback': () => report.current(null),
      });
    }).catch(() => {});
    return () => {
      gone = true;
      if (id) (window as unknown as { turnstile: Turnstile }).turnstile.remove(id);
    };
  }, [round]);

  return CAPTCHA_KEY ? <div className="captcha" ref={box} /> : null;
}
