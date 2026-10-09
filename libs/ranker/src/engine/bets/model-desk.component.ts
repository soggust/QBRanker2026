import { Component, OnDestroy, OnInit } from '@angular/core';
import { SummaryBox, athleteColors, liveStat, meterColor } from './live-props';
import { TeamColors, loadTeamColors, pickTeamColor, splitPick } from './pick-style';

// The algorithm's admin panel (the Bets page, dev only): the code-only desk's play-money betting
// (libs/ranker/scripts/model/run.mjs: every market of every game, 0.5 to 3 units), read from each sport's
// data/model/ledger.json and state.json. Its bankroll and record, broken down by sport, market and stake,
// how well its chances match what happened, its bankroll over time, the bets still open, the latest graded,
// every change it's made to itself and why, and the context it weighs beyond the ratings (rest, travel,
// starters, weather, parks, officials, the ranker's own numbers) with each term's fitted size.

interface ModelBet {
  id: string;
  // (its game's ESPN id: the live score)
  event?: string;
  sport: string;
  start: string;
  placedAt: string;
  gradedAt?: string;
  matchup: string;
  market: 'spread' | 'total' | 'ml' | 'prop';
  // (a prop's: its type, the player, his projection; its price the desk's estimate)
  propType?: string;
  statLabel?: string;
  player?: string;
  // (a prop's: the player's ESPN id, its line and side, for the count in play)
  athlete?: string | number;
  // (a prop's: his team, ESPN's id; older props lack it)
  team?: string | null;
  line?: number;
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
  intent?: 'edge' | 'action';
  status: 'open' | 'won' | 'lost' | 'push';
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

type TestNumbers = { maeMargin: number; maeTotal: number; winHit: number; winLogLoss: number };

interface ContextTerm {
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
  context?: { lambda: number; terms: ContextTerm[]; test: { games: number; before: TestNumbers; after: TestNumbers } } | null;
  postmortem?: { graded: number; disrupted: number; weight: number; fitted: boolean };
  props?: { types: PropType[]; lastRun?: { games: number; priced: number; bet: number } } | null;
  // (the book it bets, set in leagues.mjs; where this run's lines came from; The Odds API's credits)
  book?: string;
  lines?: string;
  odds?: OddsUsage | null;
  backtest?: { at: string; snapshots: number; planned: number; markets: Record<string, BacktestMarket> } | null;
}

interface OddsUsage {
  monthly: number;
  reserve: number;
  historyBudget: number;
  cycleStart: string | null;
  cycleEnd: string | null;
  daysLeft: number;
  remaining: number;
  used: number | null;
  spent: Record<string, number>;
  today: Record<string, number>;
  allowance: Record<string, number>;
  historyLeft: number;
}

type Returns = { n: number; staked: number; profit: number; roi: number | null };
interface BacktestMarket {
  trust: { trust: number; n: number; fitted: boolean };
  bets: number;
  close: { every: Returns; edge: Returns; logLoss: { model: number | null; market: number | null; trusted: number | null } };
  early: { every: Returns; clv: { n: number; beat: number | null; ev: number | null } };
  sharpShare: number;
  anchors: { pinnacle: number | null; own: number | null };
}
type BacktestRow = BacktestMarket & { sport: string; market: string };

interface PropType {
  key: string;
  label: string;
  rows: number;
  params: { K: number; w: number; a: number; b: number; c: number; r: number; cal?: number[] };
  check: { n: number; mae: number; maeBase: number | null; logLoss: number | null; logLossBase: number | null; brier: number | null; brierBase: number | null; sideHit: number | null } | null;
  trust: { trust: number; n: number; fitted: boolean } | null;
}

type PropRow = PropType & { sport: string };

type ContextRow = ContextTerm & { sport: string; unitWord: string };

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

const ESPN_LEAGUES: Record<string, string> = { nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
const SPORTS = ['nfl', 'nba', 'nhl', 'mlb'];
const SPORT_KEY = 'deskSport';
const readSport = (): string | null => {
  try {
    const saved = localStorage.getItem(SPORT_KEY);
    return saved && SPORTS.includes(saved) ? saved : null;
  } catch {
    return null;
  }
};
const MARKET_NAMES: Record<string, string> = { spread: 'Spread', total: 'Total', ml: 'Moneyline', prop: 'Props' };
// (each sport's scoring unit, for a context term's size)
const UNIT_WORDS: Record<string, string> = { nfl: 'pts', nba: 'pts', nhl: 'goals', mlb: 'runs' };
// (how far ahead or behind a side has to be for its score's color to run all the way, by sport; the good and
// bad of the site's results)
const EDGE_FULL: Record<string, number> = { nfl: 14, nba: 12, nhl: 2, mlb: 3 };
// (the desk's own win and loss colors, model-desk.scss --win and --loss)
const GOOD = 'var(--win)';
const BAD = 'var(--loss)';
// (the props a bar measures whatever their line: yards, a goalie's saves, a pitcher's outs; a short count is pips)
const BAR_STATS = new Set(['passYds', 'rushYds', 'recYds', 'rushRecYds', 'saves', 'outs']);

function tally(label: string, bets: ModelBet[]): Tally {
  const t: Tally = { label, bets: 0, won: 0, lost: 0, push: 0, staked: 0, profit: 0, roi: null, open: 0, clvN: 0, clvBeat: null, clvEv: null };
  const withClv = bets.filter((b) => b.clv);
  const decided = withClv.filter((b) => b.clv!.beat !== null);
  const evs = withClv.map((b) => b.clv!.ev).filter((v): v is number => v !== null && v !== undefined);
  t.clvN = withClv.length;
  t.clvBeat = decided.length ? decided.filter((b) => b.clv!.beat).length / decided.length : null;
  t.clvEv = evs.length ? evs.reduce((s, v) => s + v, 0) / evs.length : null;
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
export class ModelDeskComponent implements OnInit, OnDestroy {
  loading = true;
  states: ModelState[] = [];
  bets: ModelBet[] = [];
  // (play money: 1,000 to start, and 1,000 more whenever the balance would go under 0)
  readonly bankroll = 1000;

  // The sport on show (the chips up top; null: every sport): the panels, the tiles and the lists are all built
  // from its bets and state alone. Remembered on this browser.
  readonly sports = SPORTS;
  sport: string | null = readSport();
  private allBets: ModelBet[] = [];
  private allStates: ModelState[] = [];

  // (one game on show, the dropdown left of the chips: its ESPN id; null every game. A new sport clears it)
  game = '';

  setGame(game: string): void {
    this.game = game;
    this.pick();
    this.build();
    this.loadScores();
  }

  // The dropdown's games: the sport's games with bets open, in play or graded in the last 3 days, by day
  // (soonest first), each with its bet count
  get gameDays(): { day: string; games: { event: string; label: string; count: number }[] }[] {
    const recent = Date.now() - 3 * 864e5;
    const bets = (this.sport ? this.allBets.filter((b) => b.sport === this.sport) : this.allBets).filter(
      (b) => b.event && (b.status === 'open' || Date.parse(b.gradedAt ?? b.start) >= recent),
    );
    const games = new Map<string, { event: string; label: string; count: number; start: string; sport: string }>();
    for (const b of bets) {
      const g = games.get(b.event!) ?? { event: b.event!, label: b.matchup, count: 0, start: b.start, sport: b.sport };
      g.count++;
      games.set(b.event!, g);
    }
    const days = new Map<string, { day: string; games: { event: string; label: string; count: number }[] }>();
    for (const g of [...games.values()].sort((a, b) => a.start.localeCompare(b.start))) {
      const day = new Date(g.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = new Date(g.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const entry = days.get(day) ?? { day, games: [] };
      entry.games.push({ event: g.event, label: `${this.sport ? '' : g.sport.toUpperCase() + ' · '}${g.label} · ${time}`, count: g.count });
      days.set(day, entry);
    }
    return [...days.values()];
  }

  setSport(sport: string | null): void {
    this.sport = sport;
    this.game = '';
    try {
      if (sport) localStorage.setItem(SPORT_KEY, sport);
      else localStorage.removeItem(SPORT_KEY);
    } catch {
      // (storage off: the choice lasts the visit)
    }
    this.pick();
    this.build();
    this.loadScores();
  }

  private pick(): void {
    const sport = this.sport ? this.allBets.filter((b) => b.sport === this.sport) : this.allBets;
    this.bets = this.game ? sport.filter((b) => b.event === this.game) : sport;
    this.states = this.sport ? this.allStates.filter((s) => s.sport === this.sport) : this.allStates;
  }

  // (a sport's open bets, or every sport's: the chips' counts)
  openCount(sport: string | null): number {
    return this.allBets.filter((b) => b.status === 'open' && (!sport || b.sport === sport)).length;
  }

  // (a game's two teams, away and home, from its matchup: "PHI @ OTT")
  teamsOf(b: ModelBet): [string, string] {
    const [away, home] = b.matchup.split(' @ ');
    return [away ?? '', home ?? ''];
  }

  // (a team's logo, ESPN's at a small size, by its abbreviation: its version for a dark background, where
  // a navy wordmark like the Capitals' would vanish on the board; the plain one if a team has none)
  teamLogo(sport: string, abbr: string): string {
    return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${sport}/500-dark/${abbr.toLowerCase()}.png&w=40&h=40`;
  }

  // (a prop's player: his ESPN headshot, and his ESPN page)
  headshot(b: ModelBet): string {
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/${b.sport}/players/full/${b.athlete}.png&w=96&h=70`;
  }

  // (his card in the site's own app for his sport: ?card= opens his tab and his card there)
  playerLink(b: ModelBet): string {
    return `/${b.sport}/?card=${b.athlete}&name=${encodeURIComponent(b.player ?? '')}`;
  }

  // (a prop's pick after the player's name: " Under 7.5 Carries")
  pickRest(b: ModelBet): string {
    return b.player && b.pick.startsWith(b.player) ? b.pick.slice(b.player.length) : ' ' + b.pick;
  }

  // (an image ESPN doesn't have: a dark-background logo falls back to the plain one, anything else steps
  // out of the way)
  hide(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.src.includes('/500-dark/')) img.src = img.src.replace('/500-dark/', '/500/');
    else img.style.visibility = 'hidden';
  }

  // (a league's logo, ESPN's: in the chips and each bet's row)
  leagueLogo(sport: string): string {
    return `https://a.espncdn.com/i/teamlogos/leagues/500/${sport}.png`;
  }

  overall!: Tally;
  bySport: (Tally & { state: ModelState | null })[] = [];
  byMarket: Tally[] = [];
  byStake: Tally[] = [];
  // (the bets it saw value in, apart from the ones placed for the data: the real record is the edge's)
  byIntent: Tally[] = [];
  calibration: { label: string; n: number; said: number; was: number }[] = [];
  curve = '';
  curveRange = { min: 0, max: 0 };
  // (the bets on games not started yet, and in play: started, not graded yet)
  open: ModelBet[] = [];
  live: ModelBet[] = [];
  recent: ModelBet[] = [];
  // (each in-play game's score and clock, by its ESPN id, from ESPN's scoreboard every minute)
  scores = new Map<string, { text: string; score: string; detail: string; final: boolean }>();
  // (each in-play prop's stat so far, by the bet's id, from its game's box score every minute)
  propNow = new Map<string, number | null>();
  // (an in-play prop's player's team colors, from the box score: an older prop's color, without its team)
  private livePropColors = new Map<string, { color?: string; alternateColor?: string }>();
  // (each in-play game's score as numbers and whether it's over: the bets settled here as soon as they're
  // decided, pending the next run's official grading)
  private boards = new Map<string, { hs: number; as: number; final: boolean }>();
  private scoreTimer?: ReturnType<typeof setInterval>;
  changes: (ModelState['changelog'][number] & { sport: string })[] = [];
  contextRows: ContextRow[] = [];
  contextTests: { label: string; games: number; before: TestNumbers; after: TestNumbers }[] = [];
  propRows: PropRow[] = [];
  backtestRows: BacktestRow[] = [];
  credits: OddsUsage | null = null;
  byProp: Tally[] = [];

  async ngOnInit(): Promise<void> {
    const get = (url: string) =>
      fetch(url, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    const files = await Promise.all(
      SPORTS.map(async (sport) => ({ sport, ledger: await get(`/${sport}/data/model/ledger.json`), state: (await get(`/${sport}/data/model/state.json`)) as ModelState | null })),
    );
    this.allStates = files.map((f) => f.state).filter((s): s is ModelState => !!s);
    this.allBets = files.flatMap((f) => (f.ledger?.bets ?? []) as ModelBet[]);
    this.pick();
    this.build();
    this.loading = false;
    this.loadTeams();
    this.loadScores();
    this.scoreTimer = setInterval(() => this.loadScores(), 60_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.scoreTimer);
  }

  // The in-play games' scores: each sport's scoreboard (today's slate, the NFL's week), matched by ESPN id.
  // A sport whose scoreboard won't load just shows no score.
  private async loadScores(): Promise<void> {
    const now = Date.now();
    const live = this.bets.filter((b) => b.status === 'open' && Date.parse(b.start) <= now);
    for (const sport of new Set(live.map((b) => b.sport))) {
      const board = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_LEAGUES[sport]}/scoreboard`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      for (const event of board?.events ?? []) {
        const teams = event.competitions?.[0]?.competitors ?? [];
        const side = (where: string) => teams.find((t: { homeAway: string }) => t.homeAway === where);
        const away = side('away');
        const home = side('home');
        if (!away || !home) continue;
        this.boards.set(String(event.id), { hs: Number(home.score) || 0, as: Number(away.score) || 0, final: !!event.status?.type?.completed });
        const score = `${away.team?.abbreviation} ${away.score ?? 0} - ${home.team?.abbreviation} ${home.score ?? 0}`;
        const detail = event.status?.type?.shortDetail ?? '';
        const final = !!event.status?.type?.completed;
        this.scores.set(String(event.id), { text: final ? `Final · ${score}` : `${score} · ${detail}`, score, detail, final });
      }
    }
    // (the props in play: each game's summary once, its box score read for every prop on it)
    const props = live.filter((b) => b.market === 'prop' && b.event && b.athlete !== undefined && b.propType);
    for (const event of new Set(props.map((b) => b.event!))) {
      const sport = props.find((b) => b.event === event)!.sport;
      const body = (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_LEAGUES[sport]}/summary?event=${event}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)) as SummaryBox | null;
      for (const b of props.filter((x) => x.event === event)) {
        this.propNow.set(b.id, liveStat(sport, b.propType!, String(b.athlete), body));
        const colors = athleteColors(String(b.athlete), body);
        if (colors) this.livePropColors.set(b.id, colors);
        if (!b.team) this.pickColors.delete(b.id);
      }
    }
    this.live = live.sort((a, b) => a.start.localeCompare(b.start));
    this.open = this.bets.filter((b) => b.status === 'open' && Date.parse(b.start) > now).sort((a, b) => a.start.localeCompare(b.start));
  }

  private build(): void {
    const bets = this.bets;
    this.overall = tally('All', bets);
    this.bySport = SPORTS.map((sport) => ({ ...tally(sport.toUpperCase(), bets.filter((b) => b.sport === sport)), state: this.states.find((s) => s.sport === sport) ?? null })).filter(
      (t) => t.state || t.bets || t.open,
    );
    this.byMarket = Object.keys(MARKET_NAMES).map((m) => tally(MARKET_NAMES[m], bets.filter((b) => b.market === m)));
    this.byIntent = [tally('Edge', bets.filter((b) => this.intentOf(b) === 'edge')), tally('Action', bets.filter((b) => this.intentOf(b) === 'action'))];
    this.byStake = [0.5, 1, 1.5, 2, 2.5, 3].map((u) => tally(`${u}u`, bets.filter((b) => b.units === u))).filter((t) => t.bets || t.open);

    // (how often the sides it gave each chance actually won: by its chance, five points wide; a bet whose
    // premise broke in the game counts for its weight)
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
        said: list.reduce((s, b) => s + (b.weight ?? 1) * b.p, 0) / list.reduce((s, b) => s + (b.weight ?? 1), 0),
        was: list.reduce((s, b) => s + (b.status === 'won' ? (b.weight ?? 1) : 0), 0) / list.reduce((s, b) => s + (b.weight ?? 1), 0),
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

    const now = Date.now();
    this.open = bets.filter((b) => b.status === 'open' && Date.parse(b.start) > now).sort((a, b) => a.start.localeCompare(b.start));
    this.live = bets.filter((b) => b.status === 'open' && Date.parse(b.start) <= now).sort((a, b) => a.start.localeCompare(b.start));
    this.recent = graded.slice(-40).reverse();
    this.changes = this.states
      .flatMap((s) => s.changelog.map((c) => ({ ...c, sport: s.label })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30);

    // (each sport's context terms, the kept ones first, and its held-out numbers with and without them)
    this.contextRows = this.states.flatMap((s) => (s.context?.terms ?? []).map((t) => ({ ...t, sport: s.label, unitWord: UNIT_WORDS[s.sport] ?? '' })));
    this.contextTests = this.states.filter((s) => s.context?.test).map((s) => ({ label: s.label, ...s.context!.test }));

    // (the backtest: each sport's markets; The Odds API's credits, the latest state's)
    this.backtestRows = this.states.flatMap((s) => Object.entries(s.backtest?.markets ?? {}).map(([market, m]) => ({ ...m, sport: s.label, market })));
    this.credits = [...this.states].sort((a, b) => b.updated.localeCompare(a.updated)).find((s) => s.odds)?.odds ?? null;

    // (the props: each sport's prop types and their projections' fit and check; the bets by type)
    this.propRows = this.states.flatMap((s) => (s.props?.types ?? []).map((t) => ({ ...t, sport: s.label })));
    const typeOf = (b: ModelBet) => `${b.sport.toUpperCase()} ${b.statLabel}`;
    const types = [...new Set(bets.filter((b) => b.market === 'prop').map(typeOf))];
    this.byProp = types.map((label) => tally(label, bets.filter((b) => b.market === 'prop' && typeOf(b) === label)));
  }

  signed(v: number): string {
    return `${v > 0 ? '+' : ''}${v}`;
  }

  // (a tally's CLV: the share of its bets that beat the close, and their mean expected return at it)
  clvText(t: Tally): string {
    if (!t.clvN) return '-';
    return `${this.pct(t.clvBeat, 0)}${t.clvEv !== null ? ` · ${t.clvEv >= 0 ? '+' : ''}${(t.clvEv * 100).toFixed(1)}%` : ''}`;
  }

  // (a bet's CLV: the points it beat the close by, else the chance it gained on it)
  betClv(b: ModelBet): string {
    const c = b.clv;
    if (!c) return '-';
    if (c.pts !== null && c.pts !== 0) return `${c.pts > 0 ? '+' : ''}${c.pts} pts`;
    if (c.prob !== null) return `${c.prob >= 0 ? '+' : ''}${(c.prob * 100).toFixed(1)}%`;
    return '0';
  }

  // The account, as at a sportsbook: a bet's stake leaves the balance when it's placed and comes back with
  // its winnings (or doesn't) when it's graded. Bankroll: the starting 100 plus what's been won or lost.
  get balance(): number {
    return this.bankroll + this.overall.profit + this.rebuys * this.bankroll;
  }

  // (how many times it's rebought: 1,000 each time the balance would go under 0)
  get rebuys(): number {
    const short = this.atRisk - (this.bankroll + this.overall.profit);
    return short > 0 ? Math.ceil(short / this.bankroll) : 0;
  }

  intentOf(b: ModelBet): 'edge' | 'action' {
    return b.intent ?? (b.ev > 0 ? 'edge' : 'action');
  }

  // (the stakes on open bets, started or not)
  get atRisk(): number {
    return this.bets.filter((b) => b.status === 'open').reduce((sum, b) => sum + b.units, 0);
  }

  // (what's left to bet with)
  get available(): number {
    return this.balance - this.atRisk;
  }

  // (a prop in play: how it stands, the count so far against the line: an over is home once it's past the
  // line; an under is alive while it's under, lost once it's past)
  propState(b: ModelBet): 'won' | 'alive' | 'lost' | null {
    const now = this.countNow(b);
    if (now === null || b.line === undefined) return null;
    if (b.side === 'over') return now > b.line ? 'won' : 'alive';
    return now > b.line ? 'lost' : 'alive';
  }

  // An in-play bet's result as soon as it's decided, by the same rules the run grades with (desk.mjs settle,
  // props.mjs settleProp): a game bet once its game is final; a prop once it's past its line (an over won, an
  // under lost) or its game's over. Null until then (and for a prop whose player's count isn't in the box
  // score). The run's grading is the official one: this is what it will say.
  provisional(b: ModelBet): { status: 'won' | 'lost' | 'push'; profit: number } | null {
    if (b.status !== 'open' || b.line === undefined) return null;
    const game = b.event ? this.boards.get(b.event) : undefined;
    let edge: number;
    if (b.market === 'prop') {
      const now = this.propNow.get(b.id);
      if (now === null || now === undefined) return null;
      if (!game?.final && now <= b.line) return null;
      edge = (b.side === 'over' ? 1 : -1) * (now - b.line);
    } else {
      // (a game bet once it's final; a total sooner, once the scoring's past its line: the over won, the under
      // lost, whatever comes after)
      if (!game) return null;
      if (!game.final && (b.market !== 'total' || game.hs + game.as <= b.line)) return null;
      const margin = game.hs - game.as;
      if (b.market === 'spread') edge = (b.side === 'home' ? margin : -margin) + b.line;
      else if (b.market === 'total') edge = (b.side === 'over' ? 1 : -1) * (game.hs + game.as - b.line);
      else edge = b.side === 'home' ? margin : -margin;
    }
    const status = edge > 0 ? 'won' : edge < 0 ? 'lost' : 'push';
    return { status, profit: status === 'won' ? this.toWin(b) : status === 'lost' ? -b.units : 0 };
  }

  // (the in-play bets decided so far, and what they come to)
  get pending(): { count: number; profit: number } {
    let count = 0;
    let profit = 0;
    for (const b of this.live) {
      const p = this.provisional(b);
      if (!p) continue;
      count++;
      profit += p.profit;
    }
    return { count, profit };
  }

  // Each sport's teams' colors, once a visit (pick-style.ts)
  private teamColors: TeamColors = new Map();

  private async loadTeams(): Promise<void> {
    this.teamColors = await loadTeamColors(this.allBets.map((b) => b.sport));
    this.pickColors.clear();
  }

  // A bet's own color, its team's (never one that reads as a result: live-props.ts meterColor): a prop its
  // player's team (the one it was placed with, or the box score's once he's playing), a side the team it took;
  // a total, no one's: null, the board's light (as with no team known). Kept, so the template asks once.
  private pickColors = new Map<string, string | null>();

  pickColor(b: ModelBet): string | null {
    if (b.market === 'total') return null;
    const kept = this.pickColors.get(b.id);
    if (kept !== undefined) return kept;
    const [away, home] = this.teamsOf(b);
    // (an older prop, placed without its player's team: the box score's, once he's playing)
    const live = b.market === 'prop' && !b.team ? this.livePropColors.get(b.id) : undefined;
    if (b.market === 'prop' && !b.team && !live) return null;
    const color = live ? meterColor(live) : pickTeamColor(this.teamColors, b.sport, { total: false, teamId: b.team, abbr: b.market === 'prop' ? null : b.side === 'home' ? home : away });
    this.pickColors.set(b.id, color);
    return color;
  }

  // A pick split round its one word in its color: what the bet is (the over or under, a moneyline's ML, a
  // spread's line); [before, the word, after]
  pickParts(b: ModelBet): [string, string, string] {
    return splitPick(b.market === 'prop' ? this.pickRest(b).trimStart() : b.pick, b.market === 'prop' || b.market === 'total');
  }

  // (what an in-play bet's meter counts: a prop's stat so far, a total's points so far; null for the rest,
  // whose result is the score)
  countNow(b: ModelBet): number | null {
    if (b.market === 'prop') return this.propNow.get(b.id) ?? null;
    if (b.market !== 'total' || !b.event) return null;
    const game = this.boards.get(b.event);
    return game ? game.hs + game.as : null;
  }

  // (a side in play, at the score: by how much it's covering (a spread: its margin plus its line) or leading (a
  // moneyline); null for a total or a prop, or before there's a score)
  sideEdge(b: ModelBet): number | null {
    if ((b.market !== 'spread' && b.market !== 'ml') || !b.event) return null;
    const game = this.boards.get(b.event);
    if (!game) return null;
    const margin = (b.side === 'home' ? 1 : -1) * (game.hs - game.as);
    return b.market === 'spread' ? margin + (b.line ?? 0) : margin;
  }

  // (a side in play, in words: where it stands at the score, or once the game's over, how it came out)
  sideText(b: ModelBet): string {
    const decided = this.provisional(b);
    if (decided) return decided.status === 'won' ? 'Won' : decided.status === 'lost' ? 'Lost' : 'Push';
    const edge = this.sideEdge(b);
    if (edge === null) return 'Under way';
    if (edge === 0) return 'Level';
    const by = Math.abs(edge);
    if (b.market === 'spread') return edge > 0 ? `Covering by ${by}` : `Short by ${by}`;
    return edge > 0 ? `Leading by ${by}` : `Trailing by ${by}`;
  }

  // (its score's color: green covering or leading, red not, deeper the further (about two touchdowns, 12
  // points, 2 goals or 3 runs is all the way); white level)
  edgeColor(b: ModelBet): string | null {
    const edge = this.sideEdge(b);
    if (edge === null || edge === 0) return null;
    const share = Math.round(35 + 65 * Math.min(1, Math.abs(edge) / (EDGE_FULL[b.sport] ?? 10)));
    return `color-mix(in srgb, ${edge > 0 ? GOOD : BAD} ${share}%, #fff)`;
  }

  // (a total's unit: the game's points, goals or runs)
  totalWord(b: ModelBet): string {
    return UNIT_WORDS[b.sport] ?? 'pts';
  }

  // A prop in play as a meter to cheer along with: a short count (carries, catches, TDs, shots, strikeouts)
  // as a row of pips, one a unit up to the one past the line, lit as they come (the last one: the line
  // crossed); a big one (yards, saves) as a bar with a notch at the line, filling as it goes
  meter(b: ModelBet): { pips: { on: boolean; past: boolean }[] | null; fill: number; mark: number; extra: number } | null {
    const now = this.countNow(b);
    if (now === null || b.line === undefined) return null;
    if (b.market === 'prop' && !BAR_STATS.has(b.propType ?? '') && b.line <= 12.5) {
      const count = Math.ceil(b.line);
      return {
        pips: Array.from({ length: count + 1 }, (_, i) => ({ on: i < now, past: i === count })),
        fill: 0,
        mark: 0,
        extra: Math.max(0, now - count - 1),
      };
    }
    // (the bar runs to a bit past the line, or to the count once it's past that)
    const span = Math.max(b.line * 1.35, now);
    return { pips: null, fill: Math.min(100, (now / span) * 100), mark: (b.line / span) * 100, extra: 0 };
  }

  // (what a bet pays on top of its stake if it wins, at its American odds)
  toWin(b: ModelBet): number {
    return b.odds > 0 ? (b.units * b.odds) / 100 : (b.units * 100) / -b.odds;
  }

  // (the stakes in play right now)
  get liveRisk(): number {
    return this.live.reduce((sum, b) => sum + b.units, 0);
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
      .filter(([m]) => !m.startsWith('prop:'))
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
    context: { key: 'gain', dir: -1 },
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
    key === 'label' ? t.label : key === 'record' ? (t.won + t.lost ? t.won / (t.won + t.lost) : null) : key === 'profit' ? t.profit : key === 'roi' ? t.roi : key === 'open' ? t.open : key === 'clv' ? t.clvBeat : null;

  readonly sportValue = (t: Tally & { state: ModelState | null }, key: string): unknown =>
    key === 'test' ? (t.state?.test?.winHit ?? null) : key === 'disrupted' ? (t.state?.postmortem?.disrupted ?? null) : this.tallyValue(t, key);

  // (a graded bet's premise broke in the game: a starter hurt, a goalie pulled)
  broke(b: ModelBet): boolean {
    return (b.weight ?? 1) < 1;
  }

  // (its post-mortem's hover: the story's headline and opening, and everything noted in the game)
  recapText(b: ModelBet): string {
    return [b.recap?.headline, b.recap?.lede, ...(b.disrupted ?? []).map((d) => `${d.severe ? '! ' : ''}${d.text}`)].filter(Boolean).join('\n');
  }

  // (a bet's value by column)
  readonly betValue = (b: ModelBet, key: string): unknown =>
    key === 'sport' ? b.sport
    : key === 'game' ? b.matchup
    : key === 'start' ? b.start
    : key === 'graded' ? (b.gradedAt ?? b.start)
    : key === 'market' ? b.market
    : key === 'pick' ? b.pick
    : key === 'result' ? b.profit
    : key === 'why' ? (b.why ?? null)
    : key === 'clv' ? (b.clv ? (b.clv.ev ?? b.clv.pts ?? null) : null)
    : (b as unknown as Record<string, unknown>)[key];

  readonly calibrationValue = (c: { label: string; n: number; said: number; was: number }, key: string): unknown => (key === 'label' ? c.said : (c as unknown as Record<string, unknown>)[key]);

  readonly stateValue = (s: ModelState, key: string): unknown =>
    key === 'label' ? s.label : key === 'history' ? s.history.finals : key === 'trust' ? (s.trust['spread']?.trust ?? null) : key === 'book' ? (s.book ?? null) : s.params[key];

  // (a backtest row's value by column)
  readonly backtestValue = (t: BacktestRow, key: string): unknown =>
    key === 'sport' ? t.sport
    : key === 'market' ? t.market
    : key === 'btBets' ? t.bets
    : key === 'btTrust' ? t.trust.trust
    : key === 'btClose' ? t.close.every.roi
    : key === 'btEarly' ? t.early.every.roi
    : key === 'btBeat' ? t.early.clv.beat
    : key === 'btLoss' ? (t.close.logLoss.model !== null && t.close.logLoss.market !== null ? t.close.logLoss.model - t.close.logLoss.market : null)
    : key === 'btAnchor' ? (t.anchors.pinnacle !== null && t.anchors.own !== null ? t.anchors.own - t.anchors.pinnacle : null)
    : null;

  // (credits as a share of the month's)
  creditsUsed(c: OddsUsage): number {
    return c.monthly - c.remaining;
  }

  num(v: number | null | undefined, digits = 3): string {
    return v === null || v === undefined ? '-' : v.toFixed(digits);
  }

  // (a prop type's value by column)
  readonly propValue = (t: PropRow, key: string): unknown =>
    key === 'sport' ? t.sport
    : key === 'prop' ? t.label
    : key === 'rows' ? t.rows
    : key === 'mae' ? (t.check && t.check.maeBase ? t.check.mae / t.check.maeBase : null)
    : key === 'overLine' ? (t.check?.logLoss ?? null)
    : key === 'sideHit' ? (t.check?.sideHit ?? null)
    : key === 'propTrust' ? (t.trust?.trust ?? null)
    : null;

  // (a context term's value by column)
  readonly contextValue = (t: ContextRow, key: string): unknown =>
    key === 'sport' ? t.sport : key === 'term' ? t.label : key === 'on' ? t.on : key === 'size' ? Math.abs(t.size) : key === 'kept' ? (t.kept ? 1 : 0) : key === 'games' ? t.games : key === 'gain' ? t.gain : null;

  // Each column's hover: what it is
  readonly help: Record<string, string> = {
    record: 'Won-lost-pushed (sorts by the share won)',
    profit: 'Units won or lost, stakes included',
    roi: 'Return on the units staked: profit ÷ staked',
    open: 'Bets placed on games not played yet',
    available: "What's left to bet with: the bankroll (1,000 to start, plus what's been won or lost, plus 1,000 for each rebuy) less the stakes on open bets, as at a sportsbook",
    intent: 'Edge: bets where it saw value. Action: no edge, placed only for the data (every market gets a bet). The model is judged on the edge record',
    atRisk: "The stakes on every open bet, started or not: out of the balance until they're graded",
    live: 'Bets on games under way right now, with the score (ESPN, every minute); graded on the next run after the game ends',
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
    said: 'The average chance it gave them (a bet whose premise broke in the game counts less: see Why)',
    was: 'How often they actually won (close to "Said" is honest)',
    k: "Learning rate: how far one game's surprise moves a team's rating (0.08 moves it 8% of the miss)",
    hfa: "Home edge: how much playing at home is worth, in the sport's scoring unit (points, goals, runs)",
    revert: "Season carryover: how much of a team's rating carries into the next season (the rest drifts back to average)",
    kO: "Scoring rate: how fast a team's points-for and points-against rates move with each game",
    sigma: 'Margin spread: how far real margins land from what it expects (one standard deviation; bigger means less sure)',
    sigmaT: 'Total spread: the same for game totals',
    trust: "How much each market counts the model against the sportsbook: 0 the book's alone, 1 the model's alone (starts at 0.5; refit on the market's graded bets once 40 are; * not yet)",
    history: 'Finished games the ratings are built on',
    why: "Why it won or lost, from the game's box score and story: what broke the bet's premise in the game (a quarterback replaced, a top player's minutes or snaps cut short, a goalie pulled, a starter gone early: ! marks one, and such a bet counts less in what the desk learns), overtime or a blowout, and how far off its call was. Hover for the story; the link opens ESPN's recap",
    disrupted: "Graded bets whose premise broke in the game (a starter hurt, a goalie pulled...): they count less in the trust fit and the calibration, in full in the record",
    prop: "The player stat (DraftKings' main line; its price isn't in the free feed, so each side's is estimated from the player's own record at the line with -110's cut)",
    rows: 'Player games its projection was fit and checked on',
    mae: "On the last 30% of the history (never fit on): how far its projection missed on average, against a plain season average's miss",
    overLine: "On the same held-out games, at a line at each player's median so far: its chance of going over against what happened (log loss, lower is better), against the player's own over-rate",
    sideHit: 'On those lines, how often the side it leaned (by 5 points or more) was right',
    propSettings: 'Its fitted settings: K (games of pull toward his position), recent weight, opponent power, game-script power, context size, spread (r: lower is wider)',
    propTrust: "How much the prop type counts its projection against the player's own record (starts 0.5; refit on its graded props once 40 are; * not yet)",
    clv: "Closing-line value: how its bets' lines and prices compare with where the market closed, the market's last word before the game. The share that beat the close (a better line, or the same line at a better chance), and the mean expected return at the closing chance. The early skill signal: a few dozen results are mostly luck, but beating the close shows an edge from the first bets on; the trust in the model leans on it until results pile up",
    betClv: "Its closing-line value: the points its line beat the close by (a spread, a total or a prop), else the chance its side gained on it; green when it beat the close",
    book: "The sportsbook every bet is priced and placed at, its lines and prices (BOOK in libs/ranker/scripts/model/leagues.mjs). The fair chance each side is weighed against is Pinnacle's, its vig taken out, where Pinnacle has the line; else the book's own",
    betBook: "The book it's priced and placed at, and where its fair chance came from (Pinnacle's line, or the book's own prices)",
    credits: "The Odds API's credits this cycle (20,000 a month; the cycle assumed to run a month from the first call): spent by feature, what's left, and what each live feature may spend today. 2,000 are held back; history (the backtest) has its own 6,000. As credits run low the backtest stops first, then props, then lines; without them the desk prices from ESPN's free board, the same book's",
    btBets: 'Games in the backtest: real lines from The Odds API, each game bet at its last snapshot before it started (the close)',
    btTrust: "The trust fitted on those closing bets: how much the model adds to the market's own number (0: nothing; the live runs start from it)",
    btClose: "Return on the closing bets at the desk's stakes, every market bet, at that trust",
    btEarly: 'Return on the same games bet at an early line (a mid-week or morning snapshot), at that trust. Flattered: the model knows things the early line didn\'t yet (who actually started)',
    btBeat: "Of the early bets, the share that beat the close (the line moved toward the side it took)",
    btLoss: "The model's log loss on the results less the market's, at the close: below 0, the model's chances were sharper than the market's",
    btAnchor: "The market's log loss with the book's own prices less with Pinnacle's: above 0, Pinnacle's is the better fair chance",
    term: "What it weighs beyond the ratings (hover a name for its unit): rest and the schedule's grind, travel, starters and bullpens, weather and air, ballparks, the officials, expected goals and neutral-script EPA, and last season's numbers from the ranker",
    on: 'What it moves: the margin (toward the side it names) or the game total',
    size: "Its fitted size, in the sport's scoring unit per unit of the term (hover the name for the unit); refit every run on every game before, pulled toward 0 unless the games bear it out",
    kept: 'Kept if the held-out games were predicted better with it; left out (size 0) if not',
    games: 'Games in the history where it applied',
    gain: "How much tighter its predictions of games it hadn't seen were with this term than without, in percent (negative: it hurt, so it's left out)",
  };
}

// (the columns that sort as text, A first)
const TEXT_KEYS = new Set(['prop', 'book', 'label', 'sport', 'game', 'market', 'pick', 'start', 'term', 'on']);
