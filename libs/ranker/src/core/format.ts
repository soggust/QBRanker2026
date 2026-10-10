// How values read: grades, rates, innings, ranks and the colors that go with them

// Numbers with thousands commas ("4,183"): one formatter, reused (toLocaleString builds a new one per
// call, and the table formats every cell on every re-rank)
export const NUMBER = new Intl.NumberFormat('en-US');

const GRADES = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];

// 0-12 -> F..A+
export function grade(value: number): string {
  return GRADES[Math.min(12, Math.max(0, Math.round(value)))];
}

// A grade's color: red (0) to green (12), brighter at the red end so low grades stay readable on
// their dark pill (an F still 4.5:1 on it)
export function gradeColor(value: number): string {
  return `hsl(${Math.round((value / 12) * 120)}, 100%, ${Math.round(50 + (1 - value / 12) * 22)}%)`;
}

// A batting-average style rate: ".287" (1.012 for an OPS over 1)
export function avg3(value: number): string {
  const text = value.toFixed(3);
  return value < 1 && value >= 0 ? text.slice(1) : text;
}

// Innings in baseball notation: 175.333 -> "175.1" (a third per out)
export function innings(value: number): string {
  const outs = Math.round(value * 3);
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

// 1st, 2nd, 3rd, 11th...
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

// Where a rank sits in its list: 0 (last) to 1 (first)
export function rankPct(rank: number, of: number): number {
  return of > 1 ? (of - rank) / (of - 1) : 1;
}

// A rank's color: red (last) through orange (the middle) to green (first)
export function rankTone(pct: number | null): string {
  if (pct === null) return '#777';
  pct = Math.max(0, Math.min(1, pct));
  const hue = pct < 0.5 ? pct * 2 * 30 : 30 + (pct - 0.5) * 2 * 95;
  return `hsl(${Math.round(hue)}, 85%, ${Math.round(56 - pct * 6)}%)`;
}
