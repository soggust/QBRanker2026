// The Algorithm desk's data, as the bettor writes it (libs/ranker/scripts/model/run.mjs): each sport's
// data/model/ledger.json (its bets) and state.json (its settings, its trust, its context, its props, its
// backtest), and the shapes the desk builds from them

export type Market = 'spread' | 'total' | 'ml' | 'prop';
export type Status = 'open' | 'won' | 'lost' | 'push';
export type Intent = 'edge' | 'action';

export interface ModelBet {
  id: string;
  // (its game's ESPN id: the live score)
  event?: string;
  sport: string;
  start: string;
  placedAt: string;
  gradedAt?: string;
  matchup: string;
  market: Market;
  // (a prop's: its type, the player, his projection; its price the desk's estimate)
  propType?: string;
  statLabel?: string;
  player?: string;
  // (a prop's: the player's ESPN id, its line and side, for the count in play)
  athlete?: string | number;
  // (a prop's: his team, ESPN's id; older props lack it)
  team?: string | null;
  // (a moneyline's is null)
  line?: number | null;
  side?: string;
  projection?: { mean: number; pOver: number; fairOver: number };
  pick: string;
  odds: number;
  model: number;
  fair: number;
  p: number;
  ev: number;
  units: number;
  // (edge: it saw value; action: no edge, bet for the data. Older bets go by their EV)
  intent?: Intent;
  status: Status;
  profit: number;
  final?: string;
  // (its post-mortem, once graded: the story, what broke its premise, the line saying why; weight under 1
  // when the premise broke in the game)
  why?: string;
  recap?: { headline: string | null; lede: string | null; link: string | null };
  disrupted?: { severe: boolean; kind: string; text: string }[];
  weight?: number;
  // (the book it's priced and placed at, and where its fair chance came from: Pinnacle's or the book's own)
  book?: string;
  fairFrom?: string;
  // (its closing-line value once its game has started: clv.mjs)
  clv?: { pts: number | null; prob: number | null; ev: number | null; beat: boolean | null } | null;
}

export type TestNumbers = { maeMargin: number; maeTotal: number; winHit: number; winLogLoss: number };

export interface ContextTerm {
  key: string;
  label: string;
  group: string;
  on: 'margin' | 'total';
  unit: string;
  size: number;
  kept: boolean;
  games: number;
  gain: number | null;
}

export type Trust = { trust: number; n: number; fitted: boolean };

export interface ModelState {
  sport: string;
  label: string;
  updated: string;
  params: Record<string, number>;
  test: ({ games: number } & TestNumbers) | null;
  trust: Record<string, Trust>;
  history: { games: number; finals: number };
  changelog: Change[];
  teams: { abbr: string; rating: number }[];
  context?: { lambda: number; terms: ContextTerm[]; test: { games: number; before: TestNumbers; after: TestNumbers } } | null;
  postmortem?: { graded: number; disrupted: number; weight: number; fitted: boolean };
  props?: { types: PropType[]; lastRun?: { games: number; priced: number; bet: number } } | null;
  // (the book it bets, set in leagues.mjs; where this run's lines came from; The Odds API's credits)
  book?: string;
  lines?: string;
  odds?: OddsUsage | null;
  backtest?: { at: string; snapshots: number; planned: number; markets: Record<string, BacktestMarket> } | null;
}

export type Change = { at: string; what: string; from: number; to: number; why: string; sport?: string };

export interface OddsUsage {
  monthly: number;
  reserve: number;
  historyBudget: number;
  cycleStart: string | null;
  cycleEnd: string | null;
  daysLeft: number;
  remaining: number;
  used: number | null;
  spent: Partial<Record<string, number>>;
  today: Partial<Record<string, number>>;
  allowance: Record<string, number>;
  historyLeft: number;
}

export type Returns = { n: number; staked: number; profit: number; roi: number | null };

export interface BacktestMarket {
  trust: Trust;
  bets: number;
  close: { every: Returns; edge: Returns; logLoss: { model: number | null; market: number | null; trusted: number | null } };
  early: { every: Returns; clv: { n: number; beat: number | null; ev: number | null } };
  sharpShare: number;
  anchors: { pinnacle: number | null; own: number | null };
}

export interface PropType {
  key: string;
  label: string;
  rows: number;
  params: { K: number; w: number; a: number; b: number; c: number; r: number; cal?: number[]; roleK?: number | null; fun?: number; pc?: number; tg?: number };
  // (the matchup terms' held-out gains: the line log loss without each less with it; null where the fit
  // never took it up)
  gains?: Record<string, number | null>;
  check: { n: number; mae: number; maeBase: number | null; logLoss: number | null; logLossBase: number | null; brier: number | null; brierBase: number | null; sideHit: number | null } | null;
  trust: Trust | null;
}

export type BacktestRow = BacktestMarket & { sport: string; market: string };
export type PropRow = PropType & { sport: string };
export type ContextRow = ContextTerm & { sport: string; unitWord: string };

// A breakdown's row: a record, its units, its return and its closing-line value
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
  // (closing-line value: bets with a close, the share that beat it (of those that didn't tie), the mean
  // expected return at the close)
  clvN: number;
  clvBeat: number | null;
  clvEv: number | null;
}

export type SportTally = Tally & { state: ModelState | null };

// (a game in play as the scoreboard has it: home and away scores, and whether it's over)
export type Board = { hs: number; as: number; final: boolean };

// (a bet decided: by the run's grading, or in play by the score)
export type Settled = { status: 'won' | 'lost' | 'push'; profit: number };

export type CalibrationRow = { label: string; n: number; said: number; was: number };

// (a point on the profit curve's hover: a strip across the chart, its dot, and what it was)
export type CurveSpot = { x: number; w: number; px: number; y: number; title: string };

// (a sport's own line on the profit curve: its running profit at each point, its path, its profit now)
export type CurveLine = { sport: string; values: number[]; path: string; profit: number };

// (a prop or total in play as a meter: pips for a short count, a bar with the line notched for a big one)
export type Meter = { pips: { on: boolean; past: boolean }[] | null; fill: number; mark: number; extra: number };

export type GameDay = { day: string; games: { event: string; label: string; count: number }[] };
