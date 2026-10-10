import { Component, OnDestroy, OnInit } from '@angular/core';
import { americanOdds, headshot, hideImage, leagueLogo, num, pct, signed, teamLogo, units } from './bet-format';
import { BetGroup, SportGroup, TableSorts, backtestValue, betValue, byGame, gamesBySport, calibrationValue, contextValue, modelVsMarket, pinnacleEdge, propValue, sportValue, stateValue, tallyValue } from './desk-columns';
import { DESK_HELP } from './desk-help';
import {
  BANKROLL,
  CURVE_W,
  EDGE_FULL,
  ESPN_LEAGUES,
  MARKET_NAMES,
  SPORTS,
  STAKES,
  UNIT_WORDS,
  calibrationOf,
  gameDaysOf,
  gradedOrder,
  intentOf,
  meterOf,
  profitCurves,
  propState,
  provisional,
  rebuysFor,
  sideEdge,
  streakOf,
  tally,
  toWin,
} from './desk-math';
import { Board, CalibrationRow, Change, ContextRow, CurveLine, CurveSpot, GameDay, Meter, ModelBet, ModelState, OddsUsage, PropRow, PropType, Settled, SportTally, Tally, BacktestRow, TestNumbers } from './desk-model';
import { SummaryBox, athleteColors, liveStat, meterColor } from './live-props';
import { Confidence, confidenceOf, kellyOf } from './bet-why';
import { TeamColors, loadTeamColors, pickTeamColor, splitPick } from './pick-style';

// The algorithm's admin panel (the Bets page, dev only): the code-only desk's play-money betting
// (libs/ranker/scripts/model/run.mjs: every market of every game, 0.5 to 3 units), read from each sport's
// data/model/ledger.json and state.json. Its bankroll and record, broken down by sport, market and stake,
// how well its chances match what happened, its bankroll over time, the bets still open, the latest graded,
// every change it's made to itself and why, and the context it weighs beyond the ratings (rest, travel,
// starters, weather, parks, officials, the ranker's own numbers) with each term's fitted size. The arithmetic
// is desk-math.ts's, the sorting desk-columns.ts's, the hovers desk-help.ts's.

// (the Bets page's bands as the desk names them, best first)
const TIERS: [Confidence, string][] = [
  ['lock', 'LOCK'],
  ['high', 'LOVE'],
  ['medium', 'BET'],
  ['low', 'PASS'],
];

const SPORT_KEY = 'deskSport';
const readSport = (): string | null => {
  try {
    const saved = localStorage.getItem(SPORT_KEY);
    return saved && SPORTS.includes(saved) ? saved : null;
  } catch {
    return null;
  }
};
// (the desk's own win and loss colors, model-desk.scss --win and --loss)
const GOOD = 'var(--win)';
const BAD = 'var(--loss)';
// (the tiles' numbers count up this long when the desk opens or the sport changes)
const TICK_MS = 650;

const getJson = <T>(url: string, init?: RequestInit): Promise<T | null> =>
  fetch(url, init)
    .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
    .catch(() => null);

const reducedMotion = (): boolean => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
};

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
  readonly bankroll = BANKROLL;
  readonly help = DESK_HELP;
  readonly curveWidth = CURVE_W;

  // The sport on show (the chips up top; null: every sport): the panels, the tiles and the lists are all built
  // from its bets and state alone. Remembered on this browser.
  readonly sports = SPORTS;
  sport: string | null = readSport();
  private allBets: ModelBet[] = [];
  private allStates: ModelState[] = [];

  // (one game on show, the dropdown left of the chips: its ESPN id; '' every game. A new sport clears it)
  game = '';
  gameDays: GameDay[] = [];

  overall!: Tally;
  bySport: SportTally[] = [];
  byMarket: Tally[] = [];
  byStake: Tally[] = [];
  // (the record by the Bets page's bands, LOCK to PASS, and all of them)
  byConfidence: Tally[] = [];
  confidenceTotal: Tally | null = null;
  // (the bets it saw value in, apart from the ones placed for the data: the real record is the edge's)
  byIntent: Tally[] = [];
  byProp: Tally[] = [];
  calibration: CalibrationRow[] = [];
  // (the profit after each graded bet: the total's line, its low and high, the profit now)
  curve = '';
  curveRange = { min: 0, max: 0 };
  curveProfit = 0;
  // (the dashed line at 0, and the last point: the profit now, its dot)
  curveZeroY = 0;
  curveEnd: CurveSpot | null = null;
  // (each point's hover target: a strip across the chart, its dot, and what it was: "After bet 34 of 120:
  // +4.30u, bankroll 1004.30u (+1.82u, NFL Bills -3, won) · NFL +6.10u, NBA -1.80u")
  curveSpots: CurveSpot[] = [];
  // (each sport's own line, with more than one sport in it; or the one sport it all is, the total in its color)
  curveLines: CurveLine[] = [];
  curveSolo: string | null = null;
  // (the latest results' run: "W3")
  streak: string | null = null;
  // (the bets on games not started yet, and in play: started, not graded yet; the latest results)
  open: ModelBet[] = [];
  live: ModelBet[] = [];
  recent: ModelBet[] = [];
  private graded: ModelBet[] = [];
  changes: (Change & { sport: string })[] = [];
  contextRows: ContextRow[] = [];
  contextTests: { label: string; games: number; before: TestNumbers; after: TestNumbers }[] = [];
  propRows: PropRow[] = [];
  backtestRows: BacktestRow[] = [];
  credits: OddsUsage | null = null;

  // (each in-play game's score and clock, by its ESPN id, from ESPN's scoreboard every minute)
  scores = new Map<string, { text: string; score: string; detail: string; final: boolean }>();
  // (each in-play prop's stat so far, by the bet's id, from its game's box score every minute)
  propNow = new Map<string, number | null>();
  // (an in-play prop's player's team colors, from the box score: an older prop's color, without its team)
  private livePropColors = new Map<string, { color?: string; alternateColor?: string }>();
  // (each in-play game's score as numbers and whether it's over: the bets settled here as soon as they're
  // decided, pending the next run's official grading)
  private boards = new Map<string, Board>();
  private scoreTimer?: ReturnType<typeof setInterval>;

  // (the tiles' count-up: 0 to 1 as they tick, 1 once they've landed)
  tick = 1;
  private tickFrame = 0;

  async ngOnInit(): Promise<void> {
    const files = await Promise.all(
      SPORTS.map(async (sport) => ({
        ledger: await getJson<{ bets?: ModelBet[] }>(`/${sport}/data/model/ledger.json`, { cache: 'no-cache' }),
        state: await getJson<ModelState>(`/${sport}/data/model/state.json`, { cache: 'no-cache' }),
      })),
    );
    this.allStates = files.map((f) => f.state).filter((s): s is ModelState => !!s);
    this.allBets = files.flatMap((f) => f.ledger?.bets ?? []);
    // (a remembered sport with no bets (NBA before its season): every sport instead, not an untouched
    // 1,000u desk that reads like an empty wallet)
    if (this.sport && !this.allBets.some((b) => b.sport === this.sport)) this.sport = null;
    this.show();
    this.loading = false;
    this.loadTeams();
    this.scoreTimer = setInterval(() => this.loadScores(), 60_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.scoreTimer);
    cancelAnimationFrame(this.tickFrame);
  }

  setGame(game: string): void {
    this.game = game;
    this.show();
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
    this.show();
  }

  // (what's on show changed: its bets and states picked, everything built from them, the scores asked, the
  // tiles counting up to their new numbers)
  private show(): void {
    const sport = this.sport ? this.allBets.filter((b) => b.sport === this.sport) : this.allBets;
    this.bets = this.game ? sport.filter((b) => b.event === this.game) : sport;
    this.states = this.sport ? this.allStates.filter((s) => s.sport === this.sport) : this.allStates;
    this.build();
    this.loadScores();
    this.startTick();
  }

  // (a sport's open bets, or every sport's: the chips' counts)
  openCount(sport: string | null): number {
    return this.allBets.filter((b) => b.status === 'open' && (!sport || b.sport === sport)).length;
  }

  private build(): void {
    const bets = this.bets;
    const now = Date.now();
    const where = (f: (b: ModelBet) => boolean) => bets.filter(f);
    this.overall = tally('All', bets);
    this.bySport = SPORTS.map((sport) => ({ ...tally(sport.toUpperCase(), where((b) => b.sport === sport)), state: this.states.find((s) => s.sport === sport) ?? null })).filter(
      (t) => t.state || t.bets || t.open,
    );
    this.byMarket = Object.keys(MARKET_NAMES).map((m) => tally(MARKET_NAMES[m], where((b) => b.market === m)));
    this.byIntent = [tally('Edge', where((b) => intentOf(b) === 'edge')), tally('Action', where((b) => intentOf(b) === 'action'))];
    this.byStake = STAKES.map((u) => tally(`${u}u`, where((b) => b.units === u))).filter((t) => t.bets || t.open);
    // (by the Bets page's bands: each bet's Kelly score and chance when placed, bet-why.ts confidenceOf)
    const band = (b: ModelBet) => confidenceOf(kellyOf(b.p, b.odds) ?? 0, b.p, intentOf(b) === 'edge');
    this.byConfidence = TIERS.map(([key, label]) => tally(label, where((b) => band(b) === key))).filter((t) => t.bets || t.open);
    this.confidenceTotal = this.byConfidence.length ? tally('Total', bets) : null;
    this.calibration = calibrationOf(bets);

    // (the profit after each graded bet, in grading order, the total's and each sport's)
    const graded = gradedOrder(bets);
    const curve = profitCurves(graded, this.bankroll, units);
    this.curve = curve.path;
    this.curveRange = curve.range;
    this.curveProfit = curve.profit;
    this.curveSpots = curve.spots;
    this.curveZeroY = curve.zeroY;
    this.curveEnd = curve.end;
    this.curveLines = curve.lines;
    this.curveSolo = curve.solo;
    this.streak = streakOf(graded);

    this.graded = graded.slice(-40).reverse();
    this.splitOpen(now);
    this.gameDays = gameDaysOf(this.allBets, this.sport, now);
    this.changes = this.states
      .flatMap((s) => s.changelog.map((c) => ({ ...c, sport: s.label })))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30);

    // (each sport's context terms, and its held-out numbers with and without them)
    this.contextRows = this.states.flatMap((s) => (s.context?.terms ?? []).map((t) => ({ ...t, sport: s.label, unitWord: UNIT_WORDS[s.sport] ?? '' })));
    this.contextTests = this.states.filter((s) => s.context?.test).map((s) => ({ label: s.label, ...s.context!.test }));

    // (the backtest: each sport's markets; The Odds API's credits, the latest state's)
    this.backtestRows = this.states.flatMap((s) => Object.entries(s.backtest?.markets ?? {}).map(([market, m]) => ({ ...m, sport: s.label, market })));
    this.credits = [...this.states].sort((a, b) => b.updated.localeCompare(a.updated)).find((s) => s.odds)?.odds ?? null;

    // (the props: each sport's prop types and their projections' fit and check; the bets by type)
    this.propRows = this.states.flatMap((s) => (s.props?.types ?? []).map((t) => ({ ...t, sport: s.label })));
    const typeOf = (b: ModelBet) => `${b.sport.toUpperCase()} ${b.statLabel}`;
    const props = where((b) => b.market === 'prop');
    this.byProp = [...new Set(props.map(typeOf))].map((label) => tally(label, props.filter((b) => typeOf(b) === label)));
  }

  // The open bets as of now: the ones not started yet (soonest first; with them a game past its start that
  // ESPN hasn't begun or has put off: a delayed start, a rainout), and the ones under way: In Play only while
  // their game runs; once it's over they're Latest Results', first, with the result the scores give them until
  // the run grades them
  private splitOpen(now: number): void {
    const open = this.bets.filter((b) => b.status === 'open');
    const waiting = (b: ModelBet) => Date.parse(b.start) > now || this.notUnderWay(b);
    this.open = open.filter(waiting).sort((a, b) => a.start.localeCompare(b.start));
    const started = open.filter((b) => !waiting(b)).sort((a, b) => a.start.localeCompare(b.start));
    this.live = started.filter((b) => !this.isOver(b));
    this.recent = [...started.filter((b) => this.isOver(b)).reverse(), ...this.graded];
  }

  // The in-play games' scores: each sport's scoreboard (today's slate, the NFL's week), matched by ESPN id;
  // a sport whose scoreboard won't load just shows no score. Then the props in play: each game's summary once,
  // its box score read for every prop on it
  private async loadScores(): Promise<void> {
    const live = this.bets.filter((b) => b.status === 'open' && Date.parse(b.start) <= Date.now());
    // (by each game's own day, ESPN's Eastern one: last night's late game is gone from today's default slate,
    // and would sit In Play until graded)
    const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const slates = new Set(live.map((b) => `${b.sport}|${dayOf(b.start)}`));
    for (const slate of slates) {
      const [sport, day] = slate.split('|');
      const board = await getJson<{ events?: ScoreboardEvent[] }>(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_LEAGUES[sport]}/scoreboard?dates=${day}`);
      for (const event of board?.events ?? []) this.readEvent(event);
    }
    const props = live.filter((b) => b.market === 'prop' && b.event && b.athlete !== undefined && b.propType);
    for (const event of new Set(props.map((b) => b.event!))) {
      const mine = props.filter((b) => b.event === event);
      const body = await getJson<SummaryBox>(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_LEAGUES[mine[0].sport]}/summary?event=${event}`);
      for (const b of mine) {
        this.propNow.set(b.id, liveStat(b.sport, b.propType!, String(b.athlete), body));
        const colors = athleteColors(String(b.athlete), body);
        if (colors) this.livePropColors.set(b.id, colors);
        if (!b.team) this.pickColors.delete(b.id);
      }
    }
    // (from the bets on show now: the sport or game may have changed while the scores loaded)
    this.splitOpen(Date.now());
  }

  private readEvent(event: ScoreboardEvent): void {
    const teams = event.competitions?.[0]?.competitors ?? [];
    const away = teams.find((t) => t.homeAway === 'away');
    const home = teams.find((t) => t.homeAway === 'home');
    if (!away || !home) return;
    // (a game called off is never final: its 0-0 isn't a result, as the bettor's espn.mjs gameOf)
    const final = !!event.status?.type?.completed && !/postponed|cancel|suspended|forfeit/i.test(event.status?.type?.name ?? '');
    this.boards.set(String(event.id), { hs: Number(home.score) || 0, as: Number(away.score) || 0, final, state: event.status?.type?.state });
    const score = `${away.team?.abbreviation} ${away.score ?? 0} - ${home.team?.abbreviation} ${home.score ?? 0}`;
    const detail = event.status?.type?.shortDetail ?? '';
    this.scores.set(String(event.id), { text: final ? `Final · ${score}` : `${score} · ${detail}`, score, detail, final });
  }

  // The tiles count up from 0 to their numbers, quick, eased out (not with reduced motion)
  private startTick(): void {
    cancelAnimationFrame(this.tickFrame);
    if (reducedMotion() || typeof requestAnimationFrame === 'undefined') {
      this.tick = 1;
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const x = Math.min(1, (t - t0) / TICK_MS);
      this.tick = 1 - (1 - x) ** 3;
      if (x < 1) this.tickFrame = requestAnimationFrame(step);
    };
    this.tick = 0;
    this.tickFrame = requestAnimationFrame(step);
  }

  // (a tile's number as it ticks: a count whole, anything else as it goes)
  ticked(v: number, whole = false): number {
    const x = v * this.tick;
    return whole ? Math.round(x) : x;
  }

  // ---------------------------------------------------------------------------
  // The account, as at a sportsbook: a bet's stake leaves the balance when it's placed and comes back with its
  // winnings (or doesn't) when it's graded
  // ---------------------------------------------------------------------------

  // (the bankroll: the starting 1,000 plus what's been won or lost, plus 1,000 for each rebuy)
  get balance(): number {
    return this.bankroll + this.overall.profit + this.rebuys * this.bankroll;
  }

  get rebuys(): number {
    return rebuysFor(this.bankroll, this.overall.profit, this.atRisk);
  }

  // (the stakes on open bets, started or not)
  get atRisk(): number {
    return this.bets.filter((b) => b.status === 'open').reduce((sum, b) => sum + b.units, 0);
  }

  // (what's left to bet with)
  get available(): number {
    return this.balance - this.atRisk;
  }

  // (the stakes in play right now)
  get liveRisk(): number {
    return this.live.reduce((sum, b) => sum + b.units, 0);
  }

  // (the in-play bets decided so far, and what they come to)
  get pending(): { count: number; profit: number } {
    let count = 0;
    let profit = 0;
    for (const b of this.bets) {
      const p = this.provisional(b);
      if (!p) continue;
      count++;
      profit += p.profit;
    }
    return { count, profit };
  }

  // ---------------------------------------------------------------------------
  // A bet in play: its count, its standing and its result as the scores give them (desk-math.ts)
  // ---------------------------------------------------------------------------

  private boardOf(b: ModelBet): Board | undefined {
    return b.event ? this.boards.get(b.event) : undefined;
  }

  provisional(b: ModelBet): Settled | null {
    return provisional(b, this.boardOf(b), this.propNow.get(b.id));
  }

  // (a bet's result in Latest Results: the run's grade (a void one, no action, said so), or for one not graded
  // yet, the scores')
  result(b: ModelBet): { status: string; profit: number } | null {
    return b.status !== 'open' ? { status: b.void ? 'void' : b.status, profit: b.profit } : this.provisional(b);
  }

  // (a bet's final score: the run's, or the scoreboard's before it's graded)
  finalScore(b: ModelBet): string {
    return b.final ?? (b.event ? (this.scores.get(b.event)?.score ?? '') : '');
  }

  // (an in-play bet whose game is over, waiting for the run to grade it)
  isOver(b: ModelBet): boolean {
    return !!this.boardOf(b)?.final;
  }

  // (a game past its start that isn't running: not begun at ESPN, or over without a final, put off)
  private notUnderWay(b: ModelBet): boolean {
    const board = this.boardOf(b);
    return board?.state === 'pre' || (board?.state === 'post' && !board.final);
  }

  // (what an in-play bet's meter counts: a prop's stat so far, a total's points so far; null for the rest,
  // whose result is the score)
  countNow(b: ModelBet): number | null {
    if (b.market === 'prop') return this.propNow.get(b.id) ?? null;
    if (b.market !== 'total') return null;
    const game = this.boardOf(b);
    return game ? game.hs + game.as : null;
  }

  propState(b: ModelBet): 'won' | 'alive' | 'lost' | null {
    return propState(b, this.countNow(b));
  }

  meter(b: ModelBet): Meter | null {
    return meterOf(b, this.countNow(b));
  }

  sideEdge(b: ModelBet): number | null {
    return sideEdge(b, this.boardOf(b));
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

  // (its hover: the same, the spread's shortfall said in full)
  sideTitle(b: ModelBet): string {
    const edge = this.sideEdge(b);
    if (edge === null) return '';
    if (edge === 0) return 'Level';
    const spread = b.market === 'spread';
    return edge > 0 ? `${spread ? 'Covering' : 'Leading'} by ${edge}` : `${spread ? 'Short of covering' : 'Trailing'} by ${-edge}`;
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

  // ---------------------------------------------------------------------------
  // A bet's look: its teams, its pick's one word in its team's color, the pictures
  // ---------------------------------------------------------------------------

  // (a game's two teams, away and home, from its matchup: "PHI @ OTT")
  teamsOf(b: ModelBet): [string, string] {
    const [away, home] = b.matchup.split(' @ ');
    return [away ?? '', home ?? ''];
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

  // (a prop's pick after the player's name: " Under 7.5 Carries")
  pickRest(b: ModelBet): string {
    return b.player && b.pick.startsWith(b.player) ? b.pick.slice(b.player.length) : ' ' + b.pick;
  }

  // A pick split round its one word in its color: what the bet is (the over or under, a moneyline's ML, a
  // spread's line); [before, the word, after]
  pickParts(b: ModelBet): [string, string, string] {
    return splitPick(b.market === 'prop' ? this.pickRest(b).trimStart() : b.pick, b.market === 'prop' || b.market === 'total');
  }

  teamLogo = teamLogo;
  leagueLogo = leagueLogo;
  hide = hideImage;

  // (a prop's player: his ESPN headshot, and his card in the site's own app for his sport: ?card= opens his
  // tab and his card there)
  headshot(b: ModelBet): string {
    return headshot(b.sport, b.athlete);
  }

  playerLink(b: ModelBet): string {
    return `/${b.sport}/?card=${b.athlete}&name=${encodeURIComponent(b.player ?? '')}`;
  }

  // ---------------------------------------------------------------------------
  // Words and numbers (bet-format.ts)
  // ---------------------------------------------------------------------------

  readonly signed = signed;
  readonly pct = pct;
  readonly units = units;
  readonly num = num;
  readonly odds = americanOdds;
  readonly toWin = toWin;
  readonly modelVsMarket = modelVsMarket;
  readonly pinnacleEdge = pinnacleEdge;

  marketName(m: string): string {
    return MARKET_NAMES[m] ?? m;
  }

  // (a tally's CLV: the share of its bets that beat the close; under it, their mean expected return at it)
  clvBeatText(t: Tally): string {
    return t.clvN ? pct(t.clvBeat, 0) : '-';
  }

  clvEvText(t: Tally): string | null {
    return t.clvN && t.clvEv !== null ? `${t.clvEv >= 0 ? '+' : ''}${(t.clvEv * 100).toFixed(1)}%` : null;
  }

  // (a bet's CLV: the points it beat the close by, else the chance it gained on it)
  betClv(b: ModelBet): string {
    const c = b.clv;
    if (!c) return '-';
    if (c.pts !== null && c.pts !== 0) return `${c.pts > 0 ? '+' : ''}${c.pts} pts`;
    if (c.prob !== null) return `${c.prob >= 0 ? '+' : ''}${(c.prob * 100).toFixed(1)}%`;
    return '0';
  }

  trustText(state: ModelState | null): string {
    if (!state) return '-';
    return Object.entries(state.trust)
      .filter(([m]) => !m.startsWith('prop:'))
      .map(([m, t]) => `${MARKET_NAMES[m] ?? m} ${t.trust}${t.fitted ? '' : '*'}`)
      .join(' · ');
  }

  // (credits spent this cycle)
  creditsUsed(c: OddsUsage): number {
    return c.monthly - c.remaining;
  }

  // (a graded bet's premise broke in the game: a starter hurt, a goalie pulled)
  broke(b: ModelBet): boolean {
    return (b.weight ?? 1) < 1;
  }

  // (its post-mortem's hover: the story's headline and opening, and everything noted in the game)
  recapText(b: ModelBet): string {
    return [b.recap?.headline, b.recap?.lede, ...(b.disrupted ?? []).map((d) => `${d.severe ? '! ' : ''}${d.text}`)].filter(Boolean).join('\n');
  }

  // (a prop type's matchup terms: each one's fitted size, or "left out", and its held-out gain)
  matchupText(t: PropType): string {
    const names: Record<string, string> = { roleK: 'role split', fun: 'funnel (over expected)', pc: 'pace', tg: 'target share' };
    return Object.entries(t.gains ?? {})
      .map(([k, g]) => {
        const v = (t.params as unknown as Record<string, number | null>)[k];
        const on = k === 'roleK' ? v !== null && v !== undefined : !!v;
        const gain = g === null ? 'never fit in' : `held-out ${g >= 0 ? '+' : ''}${(g * 100).toFixed(2)}%`;
        return `${names[k] ?? k} ${on ? (k === 'roleK' ? `k ${v}` : v) : 'left out'} (${gain})`;
      })
      .join(' · ');
  }

  // ---------------------------------------------------------------------------
  // The bet lists by game (desk-columns.ts byGame): a game with more than one bet a row of its own, its bets
  // under it, folded until it's opened (the games in play open: their meters are the point)
  // ---------------------------------------------------------------------------

  readonly byGame = byGame;
  readonly gamesBySport = gamesBySport;
  // (with every sport listed, each sport a row of its own over its games, folded but for the games in play)
  private sportsOpen = new Map<string, boolean>();

  sportOpen(table: string, s: SportGroup): boolean {
    return !s.header || (this.sportsOpen.get(`${table}|${s.sport}`) ?? table === 'live');
  }

  toggleSport(table: string, s: SportGroup): void {
    this.sportsOpen.set(`${table}|${s.sport}`, !this.sportOpen(table, s));
  }
  private groupsOpen = new Map<string, boolean>();

  groupOpen(table: string, g: BetGroup): boolean {
    return g.bets.length === 1 || (this.groupsOpen.get(`${table}|${g.key}`) ?? table === 'live');
  }

  toggleGroup(table: string, g: BetGroup): void {
    this.groupsOpen.set(`${table}|${g.key}`, !this.groupOpen(table, g));
  }

  // (a game's stakes, and what its bets came to so far: null with none decided)
  groupUnits(g: BetGroup): number {
    return Math.round(g.bets.reduce((sum, b) => sum + b.units, 0) * 100) / 100;
  }

  // (its game's final: a side's or a total's (a prop's says the player's count), else the scoreboard's)
  groupFinal(g: BetGroup): string {
    const game = g.bets.find((b) => b.market !== 'prop');
    return (game && this.finalScore(game)) || (g.bets[0].event ? (this.scores.get(g.bets[0].event)?.score ?? '') : '');
  }

  groupProfit(g: BetGroup): number | null {
    const decided = g.bets.map((b) => this.result(b)).filter((r) => r !== null);
    return decided.length ? decided.reduce((sum, r) => sum + r.profit, 0) : null;
  }

  // ---------------------------------------------------------------------------
  // Sorting (desk-columns.ts): each table its own; Open Bets by EV, best first, Latest Results latest graded first
  // ---------------------------------------------------------------------------

  private sorts = new TableSorts({ open: { key: 'ev', dir: -1 }, recent: { key: 'graded', dir: -1 }, context: { key: 'gain', dir: -1 } });
  sortBy = (table: string, key: string) => this.sorts.sortBy(table, key);
  ariaSort = (table: string, key: string) => this.sorts.ariaSort(table, key);
  sorted = <T>(table: string, rows: T[], value: (row: T, key: string) => unknown): T[] => this.sorts.sorted(table, rows, value);

  readonly tallyValue = tallyValue;
  readonly sportValue = sportValue;
  readonly calibrationValue = calibrationValue;
  readonly stateValue = stateValue;
  readonly backtestValue = backtestValue;
  readonly propValue = propValue;
  readonly contextValue = contextValue;
  readonly betValue = betValue(
    (b) => this.result(b),
    (b) => this.finalScore(b),
  );
}

// (an event on ESPN's scoreboard, as much as the desk reads)
interface ScoreboardEvent {
  id: string | number;
  status?: { type?: { completed?: boolean; name?: string; state?: 'pre' | 'in' | 'post'; shortDetail?: string } };
  competitions?: { competitors?: { homeAway: string; score?: string; team?: { abbreviation?: string } }[] }[];
}
