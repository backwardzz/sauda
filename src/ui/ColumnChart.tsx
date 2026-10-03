import { useState } from 'react';
import { money } from '../lib/format';

export interface ChartPoint {
  /** Подпись под столбцом, например «03.10». */
  label: string;
  /** Полная подпись для подсказки. */
  title: string;
  value: number;
}

const W = 720;
const H = 240;
const M = { top: 12, right: 8, bottom: 26, left: 58 };
// в единицах viewBox: на широком экране график растянут примерно в 1,3 раза, столбик остаётся не толще 24px
const MAX_BAR = 18;
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

/** Верх шкалы и шаг делений: круглые числа вида 1, 2, 5 × 10ⁿ. */
function scale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  return { top: Math.ceil(max / step) * step, step };
}

/** Столбики по дням, один ряд: без легенды, значение — в подсказке при наведении. */
export function ColumnChart({ points, unit, ariaLabel }: { points: ChartPoint[]; unit: string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const { top, step } = scale(Math.max(0, ...points.map((p) => p.value)));
  const band = plotW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(MAX_BAR, band - 2));
  const y = (v: number) => M.top + plotH - (Math.max(v, 0) / top) * plotH;
  const every = Math.ceil(points.length / 10);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  const hovered = hover == null ? null : points[hover];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {compact.format(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = M.left + band * i + band / 2;
          const h = M.top + plotH - y(p.value);
          const r = Math.min(4, barW / 2, h);
          const x0 = cx - barW / 2;
          const yTop = y(p.value);
          const base = M.top + plotH;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              {/* зона наведения шире самого столбика */}
              <rect x={M.left + band * i} y={M.top} width={band} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x0},${base} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${base} Z`}
                  fill={hover === i ? 'var(--accent-hover)' : 'var(--accent)'}
                />
              )}
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hover != null && (
        <div
          className="chart-tip"
          style={{
            left: `calc(16px + (100% - 32px) * ${(M.left + band * hover + band / 2) / W})`,
            top: `calc(8px + (100% - 20px) * ${y(hovered.value) / H} - 6px)`,
          }}
        >
          {hovered.title}: <b>{money(hovered.value)} {unit}</b>
        </div>
      )}
    </div>
  );
}
