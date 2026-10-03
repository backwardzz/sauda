export type Grade = 'A' | 'B' | 'C';

/** A — товары, дающие первые 80% суммы, B — следующие 15%, C — оставшиеся 5%. */
export function grade<T extends { key: string }>(rows: T[], value: (r: T) => number): Map<string, Grade> {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  const total = sorted.reduce((s, r) => s + Math.max(value(r), 0), 0);
  const out = new Map<string, Grade>();
  let acc = 0;
  for (const r of sorted) {
    const v = Math.max(value(r), 0);
    // класс определяется долей, накопленной до товара: первый товар всегда A
    const before = total > 0 ? acc / total : 1;
    out.set(r.key, v <= 0 ? 'C' : before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C');
    acc += v;
  }
  return out;
}
