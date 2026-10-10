// The play-money wallet's arithmetic, pure (no Angular, no Firebase: tests/wallet.test.mjs runs it under
// Node): a game's DraftKings lines off ESPN's scoreboard, a bet slip's stakes and payouts, a bet in play
// settled by the score as the settler will settle it (desk-math's provisional), the wallet's tallies, its
// curve, and the user's record beside the bot's
import { Board, ModelBet, Settled } from '../../bets/desk-model';
import { profitCurves, provisional } from '../../bets/desk-math';

export type PlayMarket = 'spread' | 'total' | 'ml' | 'prop';
export type PlayStatus = 'open' | 'won' | 'lost' | 'push' | 'void';
// (the bot's bands as the Bets page names them: bet-why.ts confidenceOf's lock, high, medium, low)
import type { Tier } from '../../bets/tiers';
export type { Tier };

// (play money: 1,000 units to start, and again on a reload)
export const START = 1000;
// (the slip's chips, in units; a custom stake is any number of half units up to the balance)
export const CHIPS = [0.5, 1, 5, 10, 25];
export const SPORTS = ['nfl', 'nba', 'nhl', 'mlb'];

// A bet as users/{uid}/bets/{id} keeps it (its times as ISO strings here)
export interface PlayBet {
  id: string;
  sport: string;
  // (its game's ESPN id)
  event: string;
  matchup: string;
  start: string;
  market: PlayMarket;
  side: string;
  line: number | null;
  odds: number;
  stake: number;
  pick: string;
  // (the bot's own pick on this market and side: its band and its Kelly score then)
  botPick?: boolean;
  tier?: Tier | null;
  kelly?: number | null;
  // (the bot's pick's id, for a prop: its line and price checked against it)
  ref?: string | null;
  propType?: string | null;
  athlete?: string | null;
  player?: string | null;
  statLabel?: string | null;
  // (the wallet's run it was placed in: its reloads at the time)
  run: number;
  placedAt: string;
  status: PlayStatus;
  // (once settled: what it paid on top of the stake (its stake lost, 0 on a push or a void), the final, a note)
  profit?: number;
  final?: string;
  note?: string;
  settledAt?: string;
}

// One side of one market, a price on the board
export interface Price {
  market: PlayMarket;
  side: string;
  line: number | null;
  odds: number | null;
}

export interface BoardTeam {
  abbr: string;
  name: string;
  logo: string | null;
  score: number | null;
}

// A game on ESPN's scoreboard, its DraftKings lines (each side's price as it stands now: ESPN's close is the
// current line until kickoff, its open when there's no other)
export interface GameBoard {
  sport: string;
  event: string;
  matchup: string;
  start: string;
  // (ESPN's state: not begun, under way, over; the clock's words)
  state: 'pre' | 'in' | 'post';
  detail: string;
  final: boolean;
  away: BoardTeam;
  home: BoardTeam;
  book: string | null;
  spread: { away: Price; home: Price } | null;
  total: { over: Price; under: Price } | null;
  ml: { away: Price; home: Price } | null;
}

// A bet on the slip, before it's placed: what it is, and its stake
export interface Selection {
  key: string;
  sport: string;
  event: string;
  matchup: string;
  start: string;
  market: PlayMarket;
  side: string;
  line: number | null;
  odds: number;
  pick: string;
  botPick: boolean;
  tier: Tier | null;
  kelly: number | null;
  ref: string | null;
  propType: string | null;
  athlete: string | null;
  player: string | null;
  statLabel: string | null;
  stake: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// (ESPN's prices as numbers: "+150", "-110"; "EVEN" is +100; null where there's none)
export function priceOf(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (/^even$/i.test(s)) return 100;
  const n = Number(s.replace('+', ''));
  return s && Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}

// (ESPN's lines as numbers: "-3.5", "o47.5", "u47.5"; a pick'em is 0)
export function lineOf(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (/^(pk|pick|even)$/i.test(s)) return 0;
  const n = Number(s.replace(/^[ou]/i, ''));
  return s && Number.isFinite(n) ? n : null;
}

// (what ESPN's scoreboard event carries, as far as the board reads it)
interface EspnSide {
  close?: { line?: string; odds?: string };
  open?: { line?: string; odds?: string };
}
export interface EspnEvent {
  id: string;
  date: string;
  competitions?: {
    competitors?: { homeAway: string; score?: string | number; team?: { abbreviation?: string; displayName?: string; logo?: string } }[];
    status?: { type?: { state?: string; completed?: boolean; name?: string; shortDetail?: string; detail?: string } };
    odds?: {
      provider?: { name?: string };
      overUnder?: number;
      moneyline?: { home?: EspnSide; away?: EspnSide };
      pointSpread?: { home?: EspnSide; away?: EspnSide };
      total?: { over?: EspnSide; under?: EspnSide };
    }[];
  }[];
}

// A scoreboard event as a board: its teams and score, and DraftKings' lines (the bettor's book: espn.mjs
// linesOf reads the same fields), each side's line and price as they stand now
export function boardOf(sport: string, e: EspnEvent): GameBoard | null {
  const c = e.competitions?.[0];
  const home = c?.competitors?.find((t) => t.homeAway === 'home');
  const away = c?.competitors?.find((t) => t.homeAway === 'away');
  if (!c || !home || !away) return null;
  const st = c.status?.type ?? {};
  // (a game called off is never final: its 0-0 isn't a result, as gameOf)
  const off = /postponed|cancel|suspended|forfeit/i.test(st.name ?? '');
  const state = st.state === 'in' ? 'in' : st.state === 'post' || off ? 'post' : 'pre';
  const team = (t: typeof home): BoardTeam => {
    const score = Number(t.score);
    return {
      abbr: t.team?.abbreviation ?? '',
      name: t.team?.displayName ?? t.team?.abbreviation ?? '',
      logo: t.team?.logo ?? null,
      score: state !== 'pre' && t.score !== undefined && t.score !== '' && Number.isFinite(score) ? score : null,
    };
  };
  const o = c.odds?.find((x) => String(x.provider?.name ?? '').toLowerCase().replace(/\s/g, '') === 'draftkings' && (x.moneyline || x.pointSpread || x.total));
  const now = (s: EspnSide | undefined) => s?.close ?? s?.open ?? null;
  const price = (market: PlayMarket, side: string, s: EspnSide | undefined, withLine: boolean, fallbackLine: number | null = null): Price => ({
    market,
    side,
    line: withLine ? (lineOf(now(s)?.line) ?? fallbackLine) : null,
    odds: priceOf(now(s)?.odds),
  });
  let spread: GameBoard['spread'] = null;
  let total: GameBoard['total'] = null;
  let ml: GameBoard['ml'] = null;
  if (o?.pointSpread) {
    const s = { away: price('spread', 'away', o.pointSpread.away, true), home: price('spread', 'home', o.pointSpread.home, true) };
    if (s.away.line !== null && s.home.line !== null && (s.away.odds || s.home.odds)) spread = s;
  }
  if (o?.total) {
    const fallback = Number.isFinite(o.overUnder) ? (o.overUnder as number) : null;
    const t = { over: price('total', 'over', o.total.over, true, fallback), under: price('total', 'under', o.total.under, true, fallback) };
    if (t.over.line !== null && (t.over.odds || t.under.odds)) total = t;
  }
  if (o?.moneyline) {
    const m = { away: price('ml', 'away', o.moneyline.away, false), home: price('ml', 'home', o.moneyline.home, false) };
    if (m.away.odds || m.home.odds) ml = m;
  }
  const a = team(away);
  const h = team(home);
  return {
    sport,
    event: String(e.id),
    matchup: `${a.abbr} @ ${h.abbr}`,
    start: e.date,
    state,
    detail: st.shortDetail ?? st.detail ?? '',
    final: !!st.completed && !off,
    away: a,
    home: h,
    book: o ? 'DraftKings' : null,
    spread,
    total,
    ml,
  };
}

// (a game's score as the desk's provisional settling reads it: home and away, and whether it's over)
export function scoreOf(b: GameBoard | undefined): Board | undefined {
  if (!b || b.state === 'pre' || b.home.score === null || b.away.score === null) return undefined;
  return { hs: b.home.score, as: b.away.score, final: b.final, state: b.state };
}

// The day ESPN files a game under (its dates= parameter): the day in US Eastern time, "20261011"
export function espnDay(iso: string | number | Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

// (a line with its sign: "+3.5", "-7", a pick'em "PK")
export const lineText = (v: number | null): string => (v === null ? '' : v === 0 ? 'PK' : v > 0 ? `+${v}` : String(v));
export const oddsText = (v: number | null): string => (v === null ? '-' : v > 0 ? `+${v}` : String(v));

// A bet's words, as the bettor writes its own (desk.mjs pickText): "SEA -3.5", "Over 47.5", "SEA ML"; a prop
// "Cale Makar Over 0.5 Points"
export function pickWords(p: { market: PlayMarket; side: string; line: number | null; player?: string | null; statLabel?: string | null }, matchup: string): string {
  const [away, home] = matchup.split(' @ ');
  const team = p.side === 'home' ? home : away;
  if (p.market === 'total') return `${p.side === 'over' ? 'Over' : 'Under'} ${p.line}`;
  if (p.market === 'spread') return `${team} ${lineText(p.line)}`;
  if (p.market === 'ml') return `${team} ML`;
  return `${p.player ?? ''} ${p.side === 'over' ? 'Over' : 'Under'} ${p.line} ${p.statLabel ?? ''}`.trim();
}

// (one bet on the slip a market's side: a prop also its player and its stat)
export const selectionKey = (p: { sport: string; event: string; market: PlayMarket; side: string; propType?: string | null; athlete?: string | null }): string =>
  [p.sport, p.event, p.market, p.side, p.propType ?? '', p.athlete ?? ''].join('|');

// ---------------------------------------------------------------------------
// The slip
// ---------------------------------------------------------------------------

// (what a stake wins on top of itself at American odds, to the cent)
export const toWin = (stake: number, odds: number): number => round2(odds > 0 ? (stake * odds) / 100 : (stake * 100) / -odds);
// (what comes back if it wins: the stake and the winnings)
export const payout = (stake: number, odds: number): number => round2(stake + toWin(stake, odds));

// A stake's problem, if any: in half units, at least a half, no more than what's left of the balance
// after the slip's other stakes
export function stakeProblem(stake: number, balance: number, others = 0): string | null {
  if (!Number.isFinite(stake) || stake <= 0) return 'Set a stake';
  if (!Number.isInteger(stake * 2)) return 'Half units only';
  if (stake > balance - others + 1e-9) return balance - others >= 0.5 ? `Only ${Math.floor((balance - others) * 2) / 2} units left` : 'Not enough in the wallet';
  return null;
}

// The slip added up: how many bets have a stake, the stakes, what they'd win, what they'd pay back
export function slipTotals(list: Pick<Selection, 'stake' | 'odds'>[]): { count: number; stake: number; toWin: number; payout: number } {
  const staked = list.filter((s) => s.stake > 0);
  const stake = staked.reduce((t, s) => t + s.stake, 0);
  const win = round2(staked.reduce((t, s) => t + toWin(s.stake, s.odds), 0));
  return { count: staked.length, stake, toWin: win, payout: round2(stake + win) };
}

// A chip on a stake: added to it (a casino's chips stack), never past the balance
export const addChip = (stake: number, chip: number, room: number): number => Math.max(0, Math.min(Math.floor(room * 2) / 2, (stake > 0 ? stake : 0) + chip));

// (whether a game can still be bet: not begun, and its start not passed)
export const bettable = (start: string, state: GameBoard['state'] | undefined, now: number): boolean => (state === undefined || state === 'pre') && Date.parse(start) > now;

// ---------------------------------------------------------------------------
// In play: settled by the score as the settler will (desk-math's provisional)
// ---------------------------------------------------------------------------

// (a play bet in the desk's shape: its stake its units)
export function asDeskBet(b: PlayBet): ModelBet {
  return {
    id: b.id,
    event: b.event,
    sport: b.sport,
    start: b.start,
    placedAt: b.placedAt,
    matchup: b.matchup,
    market: b.market,
    propType: b.propType ?? undefined,
    statLabel: b.statLabel ?? undefined,
    player: b.player ?? undefined,
    athlete: b.athlete ?? undefined,
    line: b.line,
    side: b.side,
    pick: b.pick,
    odds: b.odds,
    model: 0,
    fair: 0,
    p: 0,
    ev: 0,
    units: b.stake,
    status: b.status === 'open' ? 'open' : b.status === 'void' ? 'push' : b.status,
    profit: b.profit ?? 0,
  };
}

// An open bet's result as soon as the score decides it (pending settlement: the settler pays it); null until
export function provisionalOf(b: PlayBet, board: GameBoard | undefined, propNow: number | null | undefined): Settled | null {
  if (b.status !== 'open') return null;
  const r = provisional(asDeskBet(b), scoreOf(board), propNow);
  return r ? { status: r.status, profit: round2(r.profit) } : null;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface PlayTally {
  won: number;
  lost: number;
  push: number;
  void: number;
  open: number;
  // (the settled ones' stakes and their profit, the return on them; voids out of all three)
  staked: number;
  profit: number;
  roi: number | null;
  // (the open ones' stakes)
  atRisk: number;
}

export function playTally(bets: PlayBet[]): PlayTally {
  const t: PlayTally = { won: 0, lost: 0, push: 0, void: 0, open: 0, staked: 0, profit: 0, roi: null, atRisk: 0 };
  for (const b of bets) {
    if (b.status === 'open') {
      t.open++;
      t.atRisk += b.stake;
      continue;
    }
    t[b.status]++;
    if (b.status === 'void') continue;
    t.staked += b.stake;
    t.profit += b.profit ?? 0;
  }
  t.profit = round2(t.profit);
  t.roi = t.staked ? t.profit / t.staked : null;
  return t;
}

// (a record as "12-9-1": the pushes only when there are any)
export const recordText = (t: { won: number; lost: number; push: number }): string => `${t.won}-${t.lost}${t.push ? `-${t.push}` : ''}`;

// (the settled ones, in the order they were settled)
export const settledOrder = (bets: PlayBet[]): PlayBet[] =>
  bets.filter((b) => b.status !== 'open' && b.status !== 'void').sort((a, b) => (a.settledAt ?? a.start).localeCompare(b.settledAt ?? b.start) || a.start.localeCompare(b.start));

// The profit after each settled bet, drawn as the Algorithm's is (desk-math profitCurves: each sport its own
// line once there's more than one)
export function playCurve(bets: PlayBet[]) {
  const graded = settledOrder(bets).map((b) => ({ ...asDeskBet(b), gradedAt: b.settledAt }));
  return profitCurves(graded, START, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);
}

// Bets by game, the soonest (or the latest settled) first, each game's bets in the order placed
export function byGame(bets: PlayBet[], latestFirst = false): { key: string; sport: string; matchup: string; start: string; event: string; bets: PlayBet[] }[] {
  const groups = new Map<string, { key: string; sport: string; matchup: string; start: string; event: string; bets: PlayBet[] }>();
  for (const b of bets) {
    const key = `${b.sport}|${b.event}`;
    const g = groups.get(key) ?? { key, sport: b.sport, matchup: b.matchup, start: b.start, event: b.event, bets: [] };
    g.bets.push(b);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  for (const g of list) g.bets.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  return list.sort((a, b) => (latestFirst ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)) || a.matchup.localeCompare(b.matchup));
}

// The games by sport, as the Algorithm's lists (desk-columns.ts gamesBySport): with more than one sport, each
// sport once in the order its first game comes, its games under it, their bets and profit counted; else one
// group without a heading
export type PlayGame = ReturnType<typeof byGame>[number];
export interface PlaySport {
  sport: string;
  header: boolean;
  games: PlayGame[];
  bets: number;
  profit: number;
}
export function playBySport(games: PlayGame[]): PlaySport[] {
  const count = (gs: PlayGame[]) => ({
    bets: gs.reduce((n, g) => n + g.bets.length, 0),
    profit: round2(gs.reduce((n, g) => n + g.bets.reduce((p, b) => p + (b.profit ?? 0), 0), 0)),
  });
  const sports = [...new Set(games.map((g) => g.sport))];
  if (sports.length < 2) return [{ sport: sports[0] ?? '', header: false, games, ...count(games) }];
  return sports.map((sport) => {
    const gs = games.filter((g) => g.sport === sport);
    return { sport, header: true, games: gs, ...count(gs) };
  });
}

// ---------------------------------------------------------------------------
// You vs the bot: the user's record beside the bot's published picks (the Bets page's) settled over the same
// stretch, from the user's first bet's game on. Units differ (the bot stakes 0.5 to 3, a user anything), so
// the return on what was staked is the fair comparison
// ---------------------------------------------------------------------------
export interface Versus {
  from: string | null;
  you: { won: number; lost: number; push: number; winPct: number | null; roi: number | null; profit: number };
  bot: { won: number; lost: number; push: number; winPct: number | null; roi: number | null; profit: number };
}

export function versusBot(mine: PlayBet[], ledger: (Pick<ModelBet, 'status' | 'start' | 'units' | 'profit'> & { published?: boolean; void?: boolean })[]): Versus {
  const settled = mine.filter((b) => b.status === 'won' || b.status === 'lost' || b.status === 'push');
  const from = settled.length ? settled.map((b) => b.start).sort()[0] : null;
  const side = (list: { status: string; stake: number; profit: number }[]) => {
    const won = list.filter((b) => b.status === 'won').length;
    const lost = list.filter((b) => b.status === 'lost').length;
    const push = list.filter((b) => b.status === 'push').length;
    const staked = list.reduce((t, b) => t + b.stake, 0);
    const profit = round2(list.reduce((t, b) => t + b.profit, 0));
    return { won, lost, push, winPct: won + lost ? won / (won + lost) : null, roi: staked ? profit / staked : null, profit };
  };
  const bot = from
    ? ledger.filter((b) => b.published && !b.void && b.status !== 'open' && b.start >= from).map((b) => ({ status: b.status, stake: b.units, profit: b.profit }))
    : [];
  return { from, you: side(settled.map((b) => ({ status: b.status, stake: b.stake, profit: b.profit ?? 0 }))), bot: side(bot) };
}

// ---------------------------------------------------------------------------
// The leaderboards (leaderboards/{week|season|all}, written by the settler)
// ---------------------------------------------------------------------------
export interface LeaderRow {
  uid: string;
  username: string;
  displayName?: string;
  photo?: { kind: 'provider' | 'upload' | 'logo'; url: string } | null;
  won: number;
  lost: number;
  push: number;
  staked: number;
  profit: number;
  roi: number | null;
  // (the wallet's reloads (its resets), the settler's: a record over several bankrolls)
  reloads?: number;
}
export interface Leaderboard {
  period: 'week' | 'season' | 'all';
  label: string;
  rows: LeaderRow[];
  updatedAt?: string;
}
