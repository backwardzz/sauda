import { useState } from 'react';

// спокойные цвета, на которых читается белый текст
const COLORS = ['#4b45e0', '#0f7a55', '#c2410c', '#0e7490', '#9333ea', '#be123c', '#4d7c0f', '#1d4ed8', '#a16207', '#475569'];

function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Инициалы: «Coca-Cola» → CC, «Асу (RG Brands)» → А, «Procter & Gamble» → PG, «ТОО «Напитки Азии»» → НА. */
function initials(name: string): string {
  // кавычки и форма собственности в инициалы не идут
  const clean = name.replace(/\(.*?\)/g, '').replace(/[«»"'„“”]/g, '').replace(/^\s*(ТОО|ИП|АО|КХ|ОО|ПК)\s+/i, '');
  const words = clean.split(/[\s\-&]+/).filter((w) => /\p{L}/u.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** Аватарка компании: логотип по ссылке, а без него — инициалы на постоянном для компании цвете. */
export function CompanyAvatar({ name, logo, size = 48 }: { name: string; logo?: string; size?: number }) {
  // запоминается адрес, который не загрузился: новый логотип показывается сразу
  const [broken, setBroken] = useState('');
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (logo && broken !== logo) {
    return (
      <span className="company-avatar logo" style={style}>
        <img src={logo} alt="" onError={() => setBroken(logo)} referrerPolicy="no-referrer" />
      </span>
    );
  }
  return (
    <span className="company-avatar" style={{ ...style, background: name ? colorOf(name) : 'var(--line-strong)' }} aria-hidden="true">
      {name ? initials(name) : '…'}
    </span>
  );
}

export function VerifiedBadge() {
  return (
    <span className="verified">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2l2.4 1.8 3-.2 1 2.8 2.6 1.6-.8 2.9 1 2.8-2.4 1.9-.4 3-3 .6-1.9 2.4-2.8-1-2.8 1-1.9-2.4-3-.6-.4-3L1.2 12l1-2.8-.8-2.9L4 4.7l1-2.8 3 .2z" />
        <path d="M8 12.2l2.7 2.7L16.2 9.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Подтверждённая компания
    </span>
  );
}
