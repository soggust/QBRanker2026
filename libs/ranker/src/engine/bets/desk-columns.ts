// The Algorithm desk's sorting: a click on a column's header sorts its table by it (again: the other way), each
// table keeping its own; each table's rows read by column (a column with no value of its own sorts as none)
import { BacktestRow, CalibrationRow, ContextRow, ModelBet, ModelState, PropRow, SportTally, Tally } from './desk-model';

export type Dir = 1 | -1;
export type Column<T> = (row: T) => unknown;
export type Columns<T> = Record<string, Column<T>>;
// (a table's reading of a row by column, as the template's sorted() takes it)
export type ValueOf<T> = (row: T, key: string) => unknown;

// (the columns that sort as text, A first; a number column starts with its biggest)
export const TEXT_KEYS = new Set(['prop', 'book', 'label', 'sport', 'game', 'market', 'pick', 'start', 'term', 'on']);

// Two values in a column's order: equal ones level, a missing one last either way
export function compareValues(x: unknown, y: unknown, dir: Dir): number {
  if (x === y) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return ((x as number) < (y as number) ? -1 : 1) * dir;
}

export class TableSorts {
  constructor(private sorts: Record<string, { key: string; dir: Dir }> = {}) {}

  sortBy(table: string, key: string): void {
    const now = this.sorts[table];
    this.sorts[table] = now?.key === key ? { key, dir: now.dir === 1 ? -1 : 1 } : { key, dir: TEXT_KEYS.has(key) ? 1 : -1 };
  }

  ariaSort(table: string, key: string): 'ascending' | 'descending' | null {
    const s = this.sorts[table];
    return s?.key === key ? (s.dir === 1 ? 'ascending' : 'descending') : null;
  }

  // (a table's rows in its order: as given until a header's clicked)
  sorted<T>(table: string, rows: T[], value: ValueOf<T>): T[] {
    const s = this.sorts[table];
    if (!s) return rows;
    return [...rows].sort((a, b) => compareValues(value(a, s.key), value(b, s.key), s.dir));
  }
}

// (a table's columns as one reader: the column's own, else the fallback's, else none)
export const reader =
  <T>(columns: Columns<T>, fallback: ValueOf<T> = () => null): ValueOf<T> =>
  (row, key) =>
    Object.prototype.hasOwnProperty.call(columns, key) ? columns[key](row) : fallback(row, key);

// (a row's own field by name)
const field = <T>(row: T, key: string): unknown => (row as Record<string, unknown>)[key];

// (a difference of two, or none if either is missing)
const less = (a: number | null, b: number | null): number | null => (a !== null && b !== null ? a - b : null);

export const tallyValue = reader<Tally>({
  label: (t) => t.label,
  record: (t) => (t.won + t.lost ? t.won / (t.won + t.lost) : null),
  profit: (t) => t.profit,
  roi: (t) => t.roi,
  open: (t) => t.open,
  clv: (t) => t.clvBeat,
});

export const sportValue = reader<SportTally>(
  {
    test: (t) => t.state?.test?.winHit ?? null,
    disrupted: (t) => t.state?.postmortem?.disrupted ?? null,
  },
  tallyValue,
);

export const calibrationValue = reader<CalibrationRow>({ label: (c) => c.said }, field);

export const stateValue = reader<ModelState>(
  {
    label: (s) => s.label,
    history: (s) => s.history.finals,
    trust: (s) => s.trust['spread']?.trust ?? null,
    book: (s) => s.book ?? null,
  },
  (s, key) => s.params[key],
);

// (a bet's columns: its result and final score as the desk has them, graded or in play)
export const betValue = (result: (b: ModelBet) => { profit: number } | null, finalScore: (b: ModelBet) => string) =>
  reader<ModelBet>(
    {
      sport: (b) => b.sport,
      game: (b) => b.matchup,
      start: (b) => b.start,
      // (one decided in play, its game over but not graded yet: the latest, first)
      graded: (b) => b.gradedAt ?? (b.status === 'open' ? '9999' : b.start),
      market: (b) => b.market,
      pick: (b) => b.pick,
      result: (b) => result(b)?.profit ?? null,
      final: (b) => finalScore(b),
      why: (b) => b.why ?? null,
      clv: (b) => (b.clv ? (b.clv.ev ?? b.clv.pts ?? null) : null),
    },
    field,
  );

// (the model's log loss less the market's at the close; the book's own less Pinnacle's as the fair chance)
export const modelVsMarket = (t: BacktestRow): number | null => less(t.close.logLoss.model, t.close.logLoss.market);
export const pinnacleEdge = (t: BacktestRow): number | null => less(t.anchors.own, t.anchors.pinnacle);

export const backtestValue = reader<BacktestRow>({
  sport: (t) => t.sport,
  market: (t) => t.market,
  btBets: (t) => t.bets,
  btTrust: (t) => t.trust.trust,
  btClose: (t) => t.close.every.roi,
  btEarly: (t) => t.early.every.roi,
  btBeat: (t) => t.early.clv.beat,
  btLoss: modelVsMarket,
  btAnchor: pinnacleEdge,
});

export const propValue = reader<PropRow>({
  sport: (t) => t.sport,
  prop: (t) => t.label,
  rows: (t) => t.rows,
  mae: (t) => (t.check && t.check.maeBase ? t.check.mae / t.check.maeBase : null),
  overLine: (t) => t.check?.logLoss ?? null,
  sideHit: (t) => t.check?.sideHit ?? null,
  propTrust: (t) => t.trust?.trust ?? null,
});

export const contextValue = reader<ContextRow>({
  sport: (t) => t.sport,
  term: (t) => t.label,
  on: (t) => t.on,
  size: (t) => Math.abs(t.size),
  kept: (t) => (t.kept ? 1 : 0),
  games: (t) => t.games,
  gain: (t) => t.gain,
});
