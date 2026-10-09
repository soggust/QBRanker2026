// The Algorithm desk's arithmetic, pure (no Angular, no fetching: tests/model-desk.test.mjs runs it under
// Node): its records, a bet's payout, a bet in play settled by the score as the run will grade it, the
// meters, the calibration, the profit curves and the games' dropdown
import { Board, CalibrationRow, CurveLine, CurveSpot, GameDay, Intent, Meter, ModelBet, Settled, Tally } from './desk-model';

export const SPORTS = ['nfl', 'nba', 'nhl', 'mlb'];
export const ESPN_LEAGUES: Record<string, string> = { nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
export const MARKET_NAMES: Record<string, string> = { spread: 'Spread', total: 'Total', ml: 'Moneyline', prop: 'Props' };
// (the stakes it bets: 0.5 at no edge up to 3, by half units: desk.mjs stakeFor)
export const STAKES = [0.5, 1, 1.5, 2, 2.5, 3];
// (play money: 1,000 to start, and 1,000 more whenever the balance would go under 0: desk.mjs BANKROLL)
export const BANKROLL = 1000;
// (each sport's scoring unit, for a context term's size and a total's count)
export const UNIT_WORDS: Record<string, string> = { nfl: 'pts', nba: 'pts', nhl: 'goals', mlb: 'runs' };
// (how far ahead or behind a side has to be for its score's color to run all the way, by sport)
export const EDGE_FULL: Record<string, number> = { nfl: 14, nba: 12, nhl: 2, mlb: 3 };
// (the props a bar measures whatever their line: yards, a goalie's saves, a pitcher's outs; a short count is pips)
export const BAR_STATS = new Set(['passYds', 'rushYds', 'recYds', 'rushRecYds', 'saves', 'outs']);

const DAY = 864e5;
const mean = (list: number[]): number | null => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);

// (an older bet without its intent: an edge if its EV was over 0; postmortem.mjs intentOf)
export const intentOf = (b: ModelBet): Intent => b.intent ?? (b.ev > 0 ? 'edge' : 'action');

// (what a bet pays on top of its stake if it wins, at its American odds)
export const toWin = (b: Pick<ModelBet, 'odds' | 'units'>): number => (b.odds > 0 ? (b.units * b.odds) / 100 : (b.units * 100) / -b.odds);

// A record of some bets: the graded ones won, lost and pushed, their units and return; the open ones counted;
// and their closing-line value (the bets with a close, the share of those not tied that beat it, the mean
// expected return at it)
export function tally(label: string, bets: ModelBet[]): Tally {
  const t: Tally = { label, bets: 0, won: 0, lost: 0, push: 0, staked: 0, profit: 0, roi: null, open: 0, clvN: 0, clvBeat: null, clvEv: null };
  const closes = bets.map((b) => b.clv).filter((c): c is NonNullable<ModelBet['clv']> => !!c);
  const decided = closes.filter((c) => c.beat !== null);
  t.clvN = closes.length;
  t.clvBeat = decided.length ? decided.filter((c) => c.beat).length / decided.length : null;
  t.clvEv = mean(closes.map((c) => c.ev).filter((v): v is number => v !== null && v !== undefined));
  for (const b of bets) {
    if (b.status === 'open') {
      t.open++;
      continue;
    }
    // (a void prop, no action: not in the record, as the bettor's desk.mjs record)
    if (b.void) continue;
    t.bets++;
    t[b.status]++;
    t.staked += b.units;
    t.profit += b.profit;
  }
  t.roi = t.staked ? t.profit / t.staked : null;
  return t;
}

// (by how much a game bet is ahead at a score: a spread its side's margin plus its line, a total its side of
// the line, a moneyline its side's margin; desk.mjs settle's edge)
export function gameEdge(b: ModelBet, game: Board): number {
  const margin = (b.side === 'home' ? 1 : -1) * (game.hs - game.as);
  if (b.market === 'spread') return margin + (b.line ?? 0);
  if (b.market === 'total') return (b.side === 'over' ? 1 : -1) * (game.hs + game.as - (b.line ?? 0));
  return margin;
}

// (an edge as a result: won over 0, lost under, a push at 0; what it pays)
export function outcome(b: ModelBet, edge: number): Settled {
  const status = edge > 0 ? 'won' : edge < 0 ? 'lost' : 'push';
  return { status, profit: status === 'won' ? toWin(b) : status === 'lost' ? -b.units : 0 };
}

// An in-play bet's result as soon as it's decided, by the same rules the run grades with (desk.mjs settle,
// props.mjs settleProp): a game bet once its game is final, a total sooner (once the scoring's past its line:
// the over won, the under lost, whatever comes after); a prop once it's past its line (an over won, an under
// lost) or its game's over. Null until then (and for a prop whose player's count isn't in the box score)
export function provisional(b: ModelBet, game: Board | undefined, propNow: number | null | undefined): Settled | null {
  if (b.status !== 'open' || b.line === undefined) return null;
  if (b.market === 'prop') {
    if (propNow === null || propNow === undefined || b.line === null) return null;
    if (!game?.final && propNow <= b.line) return null;
    return outcome(b, (b.side === 'over' ? 1 : -1) * (propNow - b.line));
  }
  if (!game) return null;
  if (!game.final && (b.market !== 'total' || game.hs + game.as <= (b.line ?? 0))) return null;
  return outcome(b, gameEdge(b, game));
}

// (a side in play, at the score: by how much it's covering (a spread) or leading (a moneyline); null for a
// total or a prop, or before there's a score)
export function sideEdge(b: ModelBet, game: Board | undefined): number | null {
  if ((b.market !== 'spread' && b.market !== 'ml') || !game) return null;
  return gameEdge(b, game);
}

// (a prop in play, by its count against the line: an over is home once it's past the line; an under is alive
// while it's under, lost once it's past)
export function propState(b: ModelBet, count: number | null): 'won' | 'alive' | 'lost' | null {
  if (count === null || b.line === undefined || b.line === null) return null;
  if (count <= b.line) return 'alive';
  return b.side === 'over' ? 'won' : 'lost';
}

// A prop in play as a meter to cheer along with: a short count (carries, catches, TDs, shots, strikeouts) as a
// row of pips, one a unit up to the one past the line, lit as they come (the last one: the line crossed); a big
// one (yards, saves, a game's total) as a bar with a notch at the line, running to a bit past it
export function meterOf(b: ModelBet, count: number | null): Meter | null {
  if (count === null || b.line === undefined || b.line === null) return null;
  if (b.market === 'prop' && !BAR_STATS.has(b.propType ?? '') && b.line <= 12.5) {
    const pips = Math.ceil(b.line);
    return {
      pips: Array.from({ length: pips + 1 }, (_, i) => ({ on: i < count, past: i === pips })),
      fill: 0,
      mark: 0,
      extra: Math.max(0, count - pips - 1),
    };
  }
  const span = Math.max(b.line * 1.35, count);
  return { pips: null, fill: Math.min(100, (count / span) * 100), mark: (b.line / span) * 100, extra: 0 };
}

// How often the sides it gave each chance actually won: by its chance, five points wide (30% and under in the
// first band, 85% and over in the last); a bet whose premise broke in the game counts for its weight
export function calibrationOf(bets: ModelBet[]): CalibrationRow[] {
  const buckets = new Map<number, ModelBet[]>();
  for (const b of bets) {
    if (b.status !== 'won' && b.status !== 'lost') continue;
    const at = Math.min(0.85, Math.max(0.3, Math.floor(b.p * 20) / 20));
    buckets.set(at, [...(buckets.get(at) ?? []), b]);
  }
  const weight = (b: ModelBet) => b.weight ?? 1;
  const sum = (list: ModelBet[], f: (b: ModelBet) => number) => list.reduce((s, b) => s + f(b), 0);
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, list]) => ({
      label: `${Math.round(at * 100)}-${Math.round(at * 100) + 5}%`,
      n: list.length,
      said: sum(list, (b) => weight(b) * b.p) / sum(list, weight),
      was: sum(list, (b) => (b.status === 'won' ? weight(b) : 0)) / sum(list, weight),
    }));
}

// (the bets graded, in grading order)
export const gradedOrder = (bets: ModelBet[]): ModelBet[] =>
  bets.filter((b) => b.status !== 'open').sort((a, b) => (a.gradedAt ?? a.start).localeCompare(b.gradedAt ?? b.start) || a.start.localeCompare(b.start));

// The profit after each graded bet, drawn into a 600 by 120 box (10 of headroom under it): every line in units
// won from 0 on the one scale (the zero line across it), the total's and, when there's more than one sport, each
// sport's own running profit (flat while another's bets are graded: at any bet they add up to the total's). The
// total's values and path, the low and high (0 always in them), each point's hover strip and dot, the last
// point (the profit now), and each sport's line
export const CURVE_W = 600;
export function profitCurves(graded: ModelBet[], start: number, units: (v: number) => string) {
  const sports = SPORTS.filter((s) => graded.some((b) => b.sport === s));
  const running: Record<string, number> = Object.fromEntries(sports.map((s) => [s, 0]));
  let sum = 0;
  const points = [{ total: 0, by: { ...running } }];
  for (const b of graded) {
    sum += b.profit;
    running[b.sport] += b.profit;
    points.push({ total: sum, by: { ...running } });
  }
  const lines = sports.length > 1 ? sports : [];
  const values = points.flatMap((p) => [p.total, ...lines.map((s) => p.by[s])]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const last = points.length - 1;
  const step = CURVE_W / Math.max(1, last);
  const yOf = (v: number) => 110 - ((v - min) / span) * 100;
  const pathOf = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const spots: CurveSpot[] = points.map((p, i) => {
    const b = graded[i - 1];
    const split = lines.length ? ` · ${lines.map((s) => `${s.toUpperCase()} ${units(p.by[s])}`).join(', ')}` : '';
    const title = b
      ? `After bet ${i} of ${last}: ${units(p.total)}, bankroll ${(start + p.total).toFixed(2)}u (${units(b.profit)}, ${b.sport.toUpperCase()} ${b.pick}, ${b.status})${split}`
      : `Start: ${start.toFixed(2)}u`;
    return { x: Math.max(0, i * step - step / 2), w: i === 0 || i === last ? step / 2 : step, px: i * step, y: yOf(p.total), title };
  });
  const totals = points.map((p) => p.total);
  return {
    totals,
    path: pathOf(totals),
    range: { min, max },
    spots,
    zeroY: yOf(0),
    end: spots[last],
    profit: sum,
    lines: lines.map((sport): CurveLine => {
      const values = points.map((p) => p.by[sport]);
      return { sport, values, path: pathOf(values), profit: running[sport] };
    }),
    // (the one sport whose bets these all are, if so: the total is its line)
    solo: sports.length === 1 ? sports[0] : null,
  };
}

// (how many times it's rebought: 1,000 each time the balance would go under 0 with the open stakes out)
export function rebuysFor(bankroll: number, profit: number, atRisk: number): number {
  const short = atRisk - (bankroll + profit);
  return short > 0 ? Math.ceil(short / bankroll) : 0;
}

// The current run of results, the latest graded back (pushes skipped): "W3", "L2"; null before any
export function streakOf(graded: ModelBet[]): string | null {
  let kind: 'won' | 'lost' | null = null;
  let n = 0;
  for (let i = graded.length - 1; i >= 0; i--) {
    const s = graded[i].status;
    if (s !== 'won' && s !== 'lost') continue;
    if (kind && s !== kind) break;
    kind = s;
    n++;
  }
  return kind ? `${kind === 'won' ? 'W' : 'L'}${n}` : null;
}

// The games' dropdown: a sport's games (every sport's, the sport named) with bets open, in play or graded in the
// last 3 days, by day (soonest first), each with its bet count
export function gameDaysOf(bets: ModelBet[], sport: string | null, now: number): GameDay[] {
  const recent = now - 3 * DAY;
  const games = new Map<string, { event: string; label: string; count: number; start: string; sport: string }>();
  for (const b of bets) {
    if (!b.event || (sport && b.sport !== sport) || !(b.status === 'open' || Date.parse(b.gradedAt ?? b.start) >= recent)) continue;
    const g = games.get(b.event) ?? { event: b.event, label: b.matchup, count: 0, start: b.start, sport: b.sport };
    g.count++;
    games.set(b.event, g);
  }
  const days = new Map<string, GameDay>();
  for (const g of [...games.values()].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = new Date(g.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = new Date(g.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const entry = days.get(day) ?? { day, games: [] };
    entry.games.push({ event: g.event, label: `${sport ? '' : g.sport.toUpperCase() + ' · '}${g.label} · ${time}`, count: g.count });
    days.set(day, entry);
  }
  return [...days.values()];
}
