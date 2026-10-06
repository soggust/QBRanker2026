// The Game Log tab's table and chart, worked out once per log: the category headers over the columns, a
// per-game average row, and the chart's bars, oldest game first (the chart's columns stacked, with a dot
// for each touchdown and turnover; a team's margin above and below zero)
import type { GameLog, GameLogColumn, UpcomingGame } from '@ranker/engine/sport';

export interface GameLogViewRow {
  date: string;
  vs: string;
  playoff: boolean;
  logo?: string;
  outcome: 'W' | 'L' | 'T' | '';
  score: string;
  cells: string[];
}
export interface GameLogBar {
  // each stacked piece's share of the tallest bar (0-100); which side of zero (a margin)
  segments: number[];
  negative: boolean;
  outcome: 'W' | 'L' | 'T' | '';
  text: string;
  title: string;
  plus: number;
  minus: number;
}
export interface GameLogChartView {
  label: string;
  legend: string[];
  plusLabel: string | null;
  minusLabel: string | null;
  diverging: boolean;
  // the charted columns (highlighted in the table)
  keys: number[];
  bars: GameLogBar[];
}
export interface GameLogView {
  // the team's games still to play (rows after the played ones)
  upcoming: UpcomingGame[];
  groups: { label: string; span: number }[] | null;
  columns: GameLogColumn[];
  rows: GameLogViewRow[];
  average: string[] | null;
  chart: GameLogChartView | null;
}

// A value as a number: "324", "-3", "+2", ".312", "63.5", "17:42" (minutes); null for "7-15", "-", text
function numeric(text: string): number | null {
  const t = text.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  const clock = t.match(/^(\d+):(\d\d)$/);
  return clock ? Number(clock[1]) + Number(clock[2]) / 60 : null;
}

// An average shown the way the column's values are: "17:42", ".312", "6.4", "23.5"
function averageText(values: string[], avg: number): string {
  if (values.some((v) => /^\d+:\d\d$/.test(v.trim()))) {
    const m = Math.floor(avg);
    return `${m}:${String(Math.round((avg - m) * 60)).padStart(2, '0')}`;
  }
  const decimals = Math.max(1, ...values.map((v) => v.split('.')[1]?.length ?? 0));
  const text = avg.toFixed(decimals);
  return values.some((v) => v.trim().startsWith('.')) ? text.replace(/^(-?)0\./, '$1.') : text;
}

const OUTCOME = (result: string): GameLogViewRow['outcome'] => (/^[WLT]\b/.test(result) ? (result[0] as 'W' | 'L' | 'T') : '');

// A column's index by "Group LABEL" or LABEL (-1 when the log hasn't got it)
const columnIndex = (columns: GameLogColumn[], name: string) =>
  columns.findIndex((c) => `${c.group ?? ''} ${c.label}`.trim() === name) >= 0
    ? columns.findIndex((c) => `${c.group ?? ''} ${c.label}`.trim() === name)
    : columns.findIndex((c) => c.label === name);

// "Passing YDS" -> "Passing"; a lone label stays itself
const legendName = (c: GameLogColumn) => c.group || c.label;

export function gameLogView(log: GameLog, upcoming: UpcomingGame[] = []): GameLogView {
  const n = log.columns.length;
  // (oldest first, the games to come after them)
  const rows: GameLogViewRow[] = [...log.rows].reverse().map((row) => ({
    date: row.date,
    vs: row.vs,
    logo: row.logo,
    playoff: !!row.playoff,
    outcome: OUTCOME(row.result),
    score: row.result.replace(/^[WLT]\s*/, ''),
    cells: Array.from({ length: n }, (_, c) => row.values[c] ?? '-'),
  }));

  // category headers when the columns have them: runs of the same group
  let groups: GameLogView['groups'] = null;
  if (log.columns.some((c) => c.group)) {
    groups = [];
    for (const c of log.columns) {
      const last = groups.at(-1);
      if (last && last.label === (c.group ?? '')) last.span++;
      else groups.push({ label: c.group ?? '', span: 1 });
    }
  }

  // the average row: each column with 3 or more numbers (not text like "7-15" or a leader)
  const average =
    log.rows.length > 1
      ? log.columns.map((column, c) => {
          const texts = log.rows.map((row) => row.values[c] ?? '').filter((t) => numeric(t) !== null);
          if (column.wide || texts.length < 3) return '';
          return averageText(texts, texts.reduce((a, t) => a + numeric(t)!, 0) / texts.length);
        })
      : null;

  return { upcoming, groups, columns: log.columns, rows, average, chart: chartView(log) };
}

function chartView(log: GameLog): GameLogChartView | null {
  const ordered = [...log.rows].reverse();
  const value = (row: GameLog['rows'][number], c: number) => (c < 0 ? 0 : (numeric(row.values[c] ?? '') ?? 0));

  // a team's margins: one piece, above or below zero
  if (!log.chart) {
    if (ordered.length < 2 || !ordered.every((row) => row.margin !== undefined)) return null;
    const top = Math.max(...ordered.map((row) => Math.abs(row.margin!))) || 1;
    return {
      label: log.chartLabel ?? 'Margin',
      legend: [],
      plusLabel: null,
      minusLabel: null,
      // (below the line only when there's a loss to show)
      diverging: ordered.some((row) => row.margin! < 0),
      keys: [],
      bars: ordered.map((row) => ({
        segments: [(Math.abs(row.margin!) / top) * 100],
        negative: row.margin! < 0,
        outcome: OUTCOME(row.result),
        text: row.margin! > 0 ? `+${row.margin}` : String(row.margin),
        title: `${row.date} ${row.vs} · ${row.result}`,
        plus: 0,
        minus: 0,
      })),
    };
  }

  const stack = log.chart.stack.map((name) => columnIndex(log.columns, name)).filter((c) => c >= 0);
  if (!stack.length || ordered.length < 2) return null;
  const plus = (log.chart.plus ?? []).map((name) => columnIndex(log.columns, name));
  const minus = (log.chart.minus ?? []).map((name) => columnIndex(log.columns, name));
  const totals = ordered.map((row) => stack.reduce((t, c) => t + Math.max(0, value(row, c)), 0));
  // (combined: one piece, the total)
  const combine = !!log.chart.combine;
  const top = Math.max(...totals) || 1;
  const decimals = Math.max(0, ...ordered.flatMap((row) => stack.map((c) => (row.values[c] ?? '').split('.')[1]?.length ?? 0)));
  return {
    label: log.chart.label,
    legend: stack.length > 1 && !combine ? (log.chart.names ?? stack.map((c) => legendName(log.columns[c]))) : [],
    // the dots' names: the plus column's label ("TD", "HR"); several minus columns are turnovers
    plusLabel: plus.some((c) => c >= 0) ? log.columns[plus.find((c) => c >= 0)!].label : null,
    minusLabel: minus.some((c) => c >= 0) ? (log.chart.minus!.length > 1 ? 'Turnover' : log.columns[minus.find((c) => c >= 0)!].label) : null,
    diverging: false,
    keys: stack,
    bars: ordered.map((row, i) => {
      const total = totals[i];
      const plusCount = plus.reduce((t, c) => t + value(row, c), 0);
      const minusCount = minus.reduce((t, c) => t + value(row, c), 0);
      const parts = stack.map((c) => `${row.values[c] ?? '-'} ${legendName(log.columns[c]).toLowerCase()}`).join(', ');
      return {
        segments: combine ? [(total / top) * 100] : stack.map((c) => (Math.max(0, value(row, c)) / top) * 100),
        negative: false,
        outcome: OUTCOME(row.result),
        text: total.toFixed(decimals),
        title: `${row.date} ${row.vs} · ${row.result} · ${total.toFixed(decimals)}${stack.length > 1 ? ` (${parts})` : ''}`,
        plus: plusCount,
        minus: minusCount,
      };
    }),
  };
}
