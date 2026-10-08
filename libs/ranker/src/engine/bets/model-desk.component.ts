import { Component, OnInit } from '@angular/core';

// The algorithm's admin panel (the Bets page, dev only): the code-only desk's play-money betting
// (libs/ranker/scripts/model/run.mjs: every market of every game, 0.5 to 3 units), read from each sport's
// data/model/ledger.json and state.json. Its bankroll and record, broken down by sport, market and stake,
// how well its chances match what happened, its bankroll over time, the bets still open, the latest graded,
// and every change it's made to itself and why.

interface ModelBet {
  id: string;
  sport: string;
  start: string;
  placedAt: string;
  gradedAt?: string;
  matchup: string;
  market: 'spread' | 'total' | 'ml';
  pick: string;
  odds: number;
  model: number;
  fair: number;
  p: number;
  ev: number;
  units: number;
  status: 'open' | 'won' | 'lost' | 'push';
  profit: number;
  final?: string;
}

interface ModelState {
  sport: string;
  label: string;
  updated: string;
  params: Record<string, number>;
  test: { games: number; maeMargin: number; maeTotal: number; winHit: number; winLogLoss: number } | null;
  trust: Record<string, { trust: number; n: number; fitted: boolean }>;
  history: { games: number; finals: number };
  changelog: { at: string; what: string; from: number; to: number; why: string; sport?: string }[];
  teams: { abbr: string; rating: number }[];
}

export interface Tally {
  label: string;
  bets: number;
  won: number;
  lost: number;
  push: number;
  staked: number;
  profit: number;
  roi: number | null;
  open: number;
}

const SPORTS = ['nfl', 'nba', 'nhl', 'mlb'];
const MARKET_NAMES: Record<string, string> = { spread: 'Spread', total: 'Total', ml: 'Moneyline' };

function tally(label: string, bets: ModelBet[]): Tally {
  const t: Tally = { label, bets: 0, won: 0, lost: 0, push: 0, staked: 0, profit: 0, roi: null, open: 0 };
  for (const b of bets) {
    if (b.status === 'open') {
      t.open++;
      continue;
    }
    t.bets++;
    t[b.status]++;
    t.staked += b.units;
    t.profit += b.profit;
  }
  t.roi = t.staked ? t.profit / t.staked : null;
  return t;
}

@Component({
  selector: 'model-desk',
  templateUrl: './model-desk.component.html',
  styleUrls: ['../../styles/components/model-desk.scss'],
  standalone: false,
})
export class ModelDeskComponent implements OnInit {
  loading = true;
  states: ModelState[] = [];
  bets: ModelBet[] = [];
  readonly bankroll = 100;

  overall!: Tally;
  bySport: (Tally & { state: ModelState | null })[] = [];
  byMarket: Tally[] = [];
  byStake: Tally[] = [];
  calibration: { label: string; n: number; said: number; was: number }[] = [];
  curve = '';
  curveRange = { min: 0, max: 0 };
  open: ModelBet[] = [];
  recent: ModelBet[] = [];
  changes: (ModelState['changelog'][number] & { sport: string })[] = [];

  async ngOnInit(): Promise<void> {
    const get = (url: string) =>
      fetch(url, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    const files = await Promise.all(
      SPORTS.map(async (sport) => ({ sport, ledger: await get(`/${sport}/data/model/ledger.json`), state: (await get(`/${sport}/data/model/state.json`)) as ModelState | null })),
    );
    this.states = files.map((f) => f.state).filter((s): s is ModelState => !!s);
    this.bets = files.flatMap((f) => (f.ledger?.bets ?? []) as ModelBet[]);
    this.build();
    this.loading = false;
  }

  private build(): void {
    const bets = this.bets;
    this.overall = tally('All', bets);
    this.bySport = SPORTS.map((sport) => ({ ...tally(sport.toUpperCase(), bets.filter((b) => b.sport === sport)), state: this.states.find((s) => s.sport === sport) ?? null })).filter(
      (t) => t.state || t.bets || t.open,
    );
    this.byMarket = Object.keys(MARKET_NAMES).map((m) => tally(MARKET_NAMES[m], bets.filter((b) => b.market === m)));
    this.byStake = [0.5, 1, 1.5, 2, 2.5, 3].map((u) => tally(`${u}u`, bets.filter((b) => b.units === u))).filter((t) => t.bets || t.open);

    // (how often the sides it gave each chance actually won: by its chance, five points wide)
    const decided = bets.filter((b) => b.status === 'won' || b.status === 'lost');
    const buckets = new Map<number, ModelBet[]>();
    for (const b of decided) {
      const at = Math.min(0.85, Math.max(0.3, Math.floor(b.p * 20) / 20));
      buckets.set(at, [...(buckets.get(at) ?? []), b]);
    }
    this.calibration = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([at, list]) => ({
        label: `${Math.round(at * 100)}-${Math.round(at * 100) + 5}%`,
        n: list.length,
        said: list.reduce((s, b) => s + b.p, 0) / list.length,
        was: list.filter((b) => b.status === 'won').length / list.length,
      }));

    // (the bankroll after each graded bet, in grading order)
    const graded = bets.filter((b) => b.status !== 'open').sort((a, b) => (a.gradedAt ?? a.start).localeCompare(b.gradedAt ?? b.start) || a.start.localeCompare(b.start));
    let bank = this.bankroll;
    const points = [bank, ...graded.map((b) => (bank += b.profit))];
    const min = Math.min(...points);
    const max = Math.max(...points);
    this.curveRange = { min, max };
    const span = max - min || 1;
    this.curve = points.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, points.length - 1)) * 600).toFixed(1)},${(110 - ((v - min) / span) * 100).toFixed(1)}`).join(' ');

    this.open = bets.filter((b) => b.status === 'open').sort((a, b) => a.start.localeCompare(b.start));
    this.recent = graded.slice(-40).reverse();
    this.changes = this.states
      .flatMap((s) => s.changelog.map((c) => ({ ...c, sport: s.label })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30);
  }

  get balance(): number {
    return this.bankroll + this.overall.profit;
  }

  marketName(m: string): string {
    return MARKET_NAMES[m] ?? m;
  }

  odds(american: number): string {
    return american > 0 ? `+${american}` : String(american);
  }

  pct(v: number | null, digits = 1): string {
    return v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`;
  }

  units(v: number): string {
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}u`;
  }

  trustText(state: ModelState | null): string {
    if (!state) return '-';
    return Object.entries(state.trust)
      .map(([m, t]) => `${MARKET_NAMES[m] ?? m} ${t.trust}${t.fitted ? '' : '*'}`)
      .join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Sorting: a click on a column's header sorts its table by it (again: the other way); each table keeps
  // its own
  // ---------------------------------------------------------------------------
  private sorts: Record<string, { key: string; dir: 1 | -1 }> = {
    open: { key: 'start', dir: 1 },
    recent: { key: 'graded', dir: -1 },
  };

  sortBy(table: string, key: string): void {
    const now = this.sorts[table];
    // (a number column starts with its biggest; text from A)
    this.sorts[table] = now?.key === key ? { key, dir: now.dir === 1 ? -1 : 1 } : { key, dir: TEXT_KEYS.has(key) ? 1 : -1 };
  }

  ariaSort(table: string, key: string): 'ascending' | 'descending' | null {
    const s = this.sorts[table];
    return s?.key === key ? (s.dir === 1 ? 'ascending' : 'descending') : null;
  }

  sorted<T>(table: string, rows: T[], value: (row: T, key: string) => unknown): T[] {
    const s = this.sorts[table];
    if (!s) return rows;
    return [...rows].sort((a, b) => {
      const x = value(a, s.key);
      const y = value(b, s.key);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * s.dir;
    });
  }

  // (a tally's value by column)
  readonly tallyValue = (t: Tally, key: string): unknown =>
    key === 'label' ? t.label : key === 'record' ? (t.won + t.lost ? t.won / (t.won + t.lost) : null) : key === 'profit' ? t.profit : key === 'roi' ? t.roi : key === 'open' ? t.open : null;

  readonly sportValue = (t: Tally & { state: ModelState | null }, key: string): unknown => (key === 'test' ? (t.state?.test?.winHit ?? null) : this.tallyValue(t, key));

  // (a bet's value by column)
  readonly betValue = (b: ModelBet, key: string): unknown =>
    key === 'sport' ? b.sport
    : key === 'game' ? b.matchup
    : key === 'start' ? b.start
    : key === 'graded' ? (b.gradedAt ?? b.start)
    : key === 'market' ? b.market
    : key === 'pick' ? b.pick
    : key === 'result' ? b.profit
    : (b as unknown as Record<string, unknown>)[key];

  readonly calibrationValue = (c: { label: string; n: number; said: number; was: number }, key: string): unknown => (key === 'label' ? c.said : (c as unknown as Record<string, unknown>)[key]);

  readonly stateValue = (s: ModelState, key: string): unknown =>
    key === 'label' ? s.label : key === 'history' ? s.history.finals : key === 'trust' ? (s.trust['spread']?.trust ?? null) : s.params[key];

  // Each column's hover: what it is
  readonly help: Record<string, string> = {
    record: 'Won-lost-pushed (sorts by the share won)',
    profit: 'Units won or lost, stakes included',
    roi: 'Return on the units staked: profit ÷ staked',
    open: 'Bets placed on games not played yet',
    test: "How the ratings did on games they hadn't seen yet: winners picked right, and how far off the margins and totals were on average",
    sport: 'The league',
    game: 'Away @ home',
    start: 'When the game starts',
    market: 'Spread, total (over/under) or moneyline',
    pick: 'The side it took',
    odds: "The sportsbook's price when it bet (American odds)",
    units: 'Stake: 0.5 units at no edge, up to 3 at an 8% expected return',
    p: "The chance it gave this side: the model's own, pulled toward the book's by how much that market trusts the model",
    fair: "The sportsbook's chance for this side, its cut (the vig) taken out",
    ev: "Expected return per unit at its chance and the book's odds",
    final: 'The final score',
    result: 'Won, lost or pushed, and what it paid',
    calibLabel: 'The chance it gave its picks, in 5-point bands',
    n: 'Bets graded in the band',
    said: 'The average chance it gave them',
    was: 'How often they actually won (close to "Said" is honest)',
    k: "Learning rate: how far one game's surprise moves a team's rating (0.08 moves it 8% of the miss)",
    hfa: "Home edge: how much playing at home is worth, in the sport's scoring unit (points, goals, runs)",
    revert: "Season carryover: how much of a team's rating carries into the next season (the rest drifts back to average)",
    kO: "Scoring rate: how fast a team's points-for and points-against rates move with each game",
    sigma: 'Margin spread: how far real margins land from what it expects (one standard deviation; bigger means less sure)',
    sigmaT: 'Total spread: the same for game totals',
    trust: "How much each market counts the model against the sportsbook: 0 the book's alone, 1 the model's alone (starts at 0.5; refit on the market's graded bets once 40 are; * not yet)",
    history: 'Finished games the ratings are built on',
  };
}

// (the columns that sort as text, A first)
const TEXT_KEYS = new Set(['label', 'sport', 'game', 'market', 'pick', 'start']);
