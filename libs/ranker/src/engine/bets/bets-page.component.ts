import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject, isDevMode } from '@angular/core';
import { BetsView, betsView, chooseBetsView } from './bets-view';
// ---- wallet (phase 2) ----
import { LinesService } from '../account/wallet/lines.service';
import { WalletService } from '../account/wallet/wallet.service';
// ---- end wallet ----
import { SPORT_LINKS } from '@ranker/core/sports';
import { canUse } from '../account/features';
import { SPORTS } from './desk-math';
import { insteadText } from '../player-card/analysis';
import { americanOdds, headshot } from './bet-format';
import { BetWhy, Confidence, PickWhy, betScoreText, betWhy, confidenceOf, kellyOf, signedPoints, withAnalyst } from './bet-why';
import { TeamColors, loadTeamColors, pickTeamColor, splitPick } from './pick-style';

// The Bets page (the sport bar's Bets link, #bets): the algorithm's top picks for every sport (each one's
// data/model/picks.json, written by every run of the model desk: libs/ranker/scripts/model/picks.mjs), ranked
// together by their Kelly score (value and likelihood: the edge on the price, scaled by what it pays; a bet
// without an edge on its price scores 0 or under, sorts last and reads "Pass", its band low). The
// NFL's AI bet desk's sheet for the week (data/analysis/bet-sheet.json) only marks the picks it agrees with
// (the same game, market and side: "Algorithm + Analyst", ranked a little higher); its other picks aren't
// shown. A row opens to its reasoning.

// A game as the picks and the AI desk's sheet name it
type BetGame = { week: number; date: string; kickoff?: string | null; matchup: string; teams?: { abbr: string; logo: string | null }[]; line: { line: string; overUnder: number | null } | null };

// (an AI desk report's bet: data/analysis/bets.json, read only for the week its latest reports are on)
interface BetEntry {
  game: BetGame | null;
  at: string;
}

// One of the algorithm's picks as the page shows it
export interface BetRow {
  id: number;
  sport: string;
  // whose pick: the algorithm's, or the algorithm's and the analyst's both
  source: 'Algorithm' | 'Algorithm + Analyst';
  game: BetGame | null;
  // (its market's words: "Spread", "Passing Yards")
  market: string;
  // (always a like: a fade is the analyst's alone, and the analyst's own picks aren't shown)
  strength: 'like' | 'fade';
  reason: string;
  // (the analyst's, where it agrees: the most likely way it loses)
  risk?: string;
  // (its band: its chance to win 60% or more, 53% or more, or under; picks.mjs)
  confidence: Confidence | null;
  // (its side, and a prop's player, his ESPN id and his team's: its circle and its color)
  side?: string | null;
  player?: string | null;
  athleteId?: string | number | null;
  playerTeam?: string | null;
  // (its chance to win, a whole percent)
  chance?: number;
  pick: string;
  // (its price at DraftKings, under the pick)
  odds?: string;
  // (the call it makes: pickKey)
  key: string;
  // (the order: its Kelly score, a quarter higher where the analyst agrees and it has an edge)
  sureness: number;
  // its type, for the filter chips
  betType: BetKind;
  // (its score's makings, for the rank tile's breakdown (bet-why.ts): whether it has an edge, the model's and
  // the book's chances, the trusted one, its expected return and stake, its price, and the parts picks.mjs
  // split the score into; older picks files carry only some)
  edge?: boolean;
  model?: number;
  fair?: number;
  p?: number;
  ev?: number;
  units?: number;
  price?: number;
  book?: string;
  why?: PickWhy | null;
  // ---- wallet (phase 2) ----
  // (its line, and its id in the bettor's ledger: "<ESPN event>:<market>", a prop "<event>:prop:<type>:<athlete>")
  line?: number | null;
  pickId?: string;
  // ---- end wallet ----
}

// (an analyst's pick, as far as the page uses it: the call, its side, its case and its risk)
type SheetCall = { key: string; strength: 'like' | 'fade'; reason: string; risk: string };

// The bet desk's sheet (data/analysis/bet-sheet.json, scripts/analysis/bet-desk.mjs): the week's picks
// from every report's bets, each with its case and its risk, and each game's venue and kickoff weather
interface Forecast {
  roof: 'outdoors' | 'retractable' | 'indoors';
  tempF?: number | null;
  windMph?: number | null;
  gustMph?: number | null;
  precipChance?: number | null;
  sky?: string;
}
interface GameInfo {
  city: string | null;
  stadium: string | null;
  weather: Forecast | null;
}
interface SheetPick {
  sport: string;
  bet: string;
  label: string;
  side: 'like' | 'fade';
  fades: string | null;
  strength: number;
  case: string;
  grade?: { kind: BetKind } | null;
  risk: string;
  sources: string[];
  game: BetGame | null;
}
// The types of bet, for the filter chips under the game dropdown: each a chip of its own color, like
// casino chips' denominations
export type BetKind = 'spread' | 'total' | 'team_total' | 'moneyline' | 'player' | 'team_stat';
// (each chip's short label, and what it means: the chips' key)
export const BET_KINDS: { kind: BetKind; label: string; name: string }[] = [
  { kind: 'spread', label: 'ATS', name: 'Against the spread' },
  { kind: 'total', label: 'O/U', name: 'Over/under (the game total)' },
  { kind: 'team_total', label: 'TT', name: 'Team total' },
  { kind: 'moneyline', label: 'ML', name: 'Moneyline (to win)' },
  { kind: 'player', label: 'PROP', name: 'Player prop' },
  { kind: 'team_stat', label: 'TEAM', name: "Team stat (a team's own numbers)" },
];

// A bet's type: the desk's own grading kind when it has one; otherwise read from its market (a bet
// on one of the game's teams' own numbers, "BAL under its rushing average", is a team stat)
function kindOf(graded: BetKind | null | undefined, label: string, bet: string, game: BetGame | null): BetKind {
  if (graded) return graded;
  if (/^spread$/i.test(label)) return 'spread';
  if (/moneyline/i.test(label)) return 'moneyline';
  if (/^game total$/i.test(label)) return 'total';
  if (/team total/i.test(label)) return 'team_total';
  const team = bet.match(/^([A-Z]{2,3})\b/)?.[1];
  return team && game?.teams?.some((t) => t.abbr === team) ? 'team_stat' : 'player';
}

// The desk's record, its picks graded after their games (scripts/analysis/grade.mjs)
interface Tally {
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
}
interface BetRecord {
  graded: number;
  overall: Tally;
  // (a lock's only once a file has any)
  byLevel: { lock?: Tally; high: Tally; medium: Tally; low: Tally };
}
interface Sheet {
  at: string;
  week: number;
  summary: string;
  games: Record<string, GameInfo>;
  picks: SheetPick[];
}

// The algorithm's picks file (picks.mjs): its top picks on the games not started, each with its confidence
// score and level, and its record on the picks it has shown
interface Pick {
  id: string;
  sport: string;
  // (its side, and a prop's player, his ESPN id and his team's: picks written before carry none)
  side?: string | null;
  player?: string | null;
  athlete?: string | number | null;
  team?: string | null;
  score: number;
  // its chance to win, a whole percent (the band its level)
  chance: number;
  level: Confidence;
  kind: BetKind;
  market: string;
  pick: string;
  line: number | null;
  odds: number;
  book: string;
  start: string;
  matchup: string;
  teams: { abbr: string; logo: string | null }[];
  where: GameInfo | null;
  reason: string;
  // (its score's makings: older files carry the chances without the parts)
  edge?: boolean;
  model?: number;
  fair?: number;
  p?: number;
  ev?: number;
  units?: number;
  why?: PickWhy;
}
interface Picks {
  at: string;
  record: BetRecord | null;
  picks: Pick[];
}

// A team as the schedule names it (the sportsbook's WSH and LAR are its WAS and LA)
const team = (abbr: string) => ({ WSH: 'WAS', LAR: 'LA' })[abbr] ?? abbr;

// The call a pick makes, the same whoever makes it: a game total's side, a team's side of the spread or
// the moneyline, or a player bet as written ("nfl|TB @ DAL|total|under")
function pickKey(sport: string, matchup: string, kind: BetKind, pick: string): string {
  const [away, home] = matchup.split(' @ ').map(team);
  const game = `${sport}|${away} @ ${home}`;
  if (kind === 'total') return `${game}|total|${/^over/i.test(pick) ? 'over' : 'under'}`;
  const side = pick.match(/^([A-Z]{2,4})\b/)?.[1];
  if ((kind === 'spread' || kind === 'moneyline') && side) return `${game}|${kind}|${team(side)}`;
  return `${game}|${kind}|${pick.toLowerCase()}`;
}

// (the sports the bettor covers, as the site names them: MMA has no picks or team colors to ask for)
const BET_SPORTS = SPORT_LINKS.filter((sport) => SPORTS.includes(sport.id));

@Component({
  selector: 'bets-page',
  // (the page's main content: the Bets page has no <main> of its own around it)
  host: { role: 'main' },
  templateUrl: './bets-page.component.html',
  styleUrls: ['../../styles/components/bets-page.scss'],
  standalone: false,
})
export class BetsPageComponent implements OnInit, OnDestroy {
  // Each sport's teams' colors, once a visit (pick-style.ts)
  private teamColors: TeamColors = new Map();
  private pickColors = new Map<number, string | null>();

  // (a pick's own color: a prop its player's team's, a side the team it took's; a total, none: the board's)
  pickColor(r: BetRow): string | null {
    const kept = this.pickColors.get(r.id);
    if (kept !== undefined) return kept;
    const teams = r.game?.teams ?? [];
    const abbr = r.betType === 'player' ? null : (r.side === 'home' ? teams[1] : teams[0])?.abbr ?? null;
    const color = pickTeamColor(this.teamColors, r.sport ?? '', { total: r.betType === 'total', teamId: r.betType === 'player' ? r.playerTeam : null, abbr });
    if (this.teamColors.size) this.pickColors.set(r.id, color);
    return color;
  }

  // (a pick split round its one word: a prop's after the player's name, a total's over or under, a side's line)
  pickParts(r: BetRow): [string, string, string] {
    const text = r.betType === 'player' && r.player && r.pick.startsWith(r.player) ? r.pick.slice(r.player.length).trimStart() : r.pick;
    return splitPick(text, r.betType === 'player' || r.betType === 'total');
  }

  // (a side's team's logo, for its circle)
  pickLogo(r: BetRow): string | null {
    const teams = r.game?.teams ?? [];
    const logo = (r.side === 'home' ? teams[1] : teams[0])?.logo;
    return logo ? this.logoSrc(r, logo) : null;
  }

  // (a prop's player's ESPN headshot, for its circle)
  headshot(r: BetRow): string {
    return headshot(r.sport, r.athleteId);
  }

  hide(event: Event): void {
    (event.target as HTMLElement).style.visibility = 'hidden';
  }

  // (the model desk's admin panel: on the dev server only)
  readonly dev = isDevMode();
  readonly canUse = canUse;
  private readonly wallet = inject(WalletService);
  // (Open Bets: only with bets of the user's not yet settled; the last one settled, back to Place Bets)
  readonly hasOpen = (): boolean => canUse('bets') && this.wallet.bets().some((b) => b.status === 'open');
  // (Closed Bets: only with bets of the user's settled)
  // (already bet and still open: the stake, so the same bet isn't placed twice by mistake)
  readonly placedOn = (r: BetRow): number => (r.pickId ? (this.wallet.openOnPick().get(r.pickId) ?? 0) : 0);
  readonly hasClosed = (): boolean => canUse('bets') && this.wallet.bets().some((b) => b.status !== 'open');
  // (Place Bets first; Open Bets (with the wallet) or the Algorithm (development only) once chosen in this
  // visit: bets-view.ts)
  get view(): BetsView {
    const view = betsView();
    if (view === 'desk') return this.dev ? view : 'bets';
    if (view === 'open') return this.hasOpen() ? view : 'bets';
    if (view === 'closed') return this.hasClosed() ? view : 'bets';
    return view;
  }
  set view(view: BetsView) {
    chooseBetsView(view);
  }

  rows: BetRow[] | null = null;
  updated: string | null = null;
  // the filter: all games (the top 40 bets), or one game (its top 15, from all of its bets), by its matchup
  game = '';
  readonly limit = 40;
  readonly gameLimit = 15;
  open = new Set<number>();
  readonly insteadText = insteadText;
  // each game's venue and kickoff weather, from the bet desk's sheet ("nfl|CHI @ GB")
  places = new Map<string, GameInfo>();
  // how the algorithm's published picks did (each sport's picks.json, added up), overall and by chance band
  record: BetRecord | null = null;

  // A record as "14-9" ("14-9-1" with a push)
  wl(t: Tally): string {
    return `${t.wins}–${t.losses}${t.pushes ? `–${t.pushes}` : ''}`;
  }

  // Under a matchup: the kickoff weather and where it's played ("57° · 8 mph · Lambeau Field"); windy (15+ mph,
  // or gusts of 25+) when the wind could matter
  where(r: BetRow): { icon: string; text: string; windy: boolean } | null {
    const info = r.game ? this.places.get(`${r.sport}|${r.game.matchup}`) : undefined;
    if (!info) return null;
    const w = info.weather;
    // (where: the stadium's name, or its city when the schedule has none)
    const place = info.stadium ?? info.city ?? '';
    if (!w) return place ? { icon: 'place', text: place, windy: false } : null;
    if (w.roof === 'indoors') return { icon: 'stadium', text: ['Indoors', place].filter(Boolean).join(' · '), windy: false };
    const sky = w.sky ?? '';
    const icon = /thunder/.test(sky) ? 'thunderstorm' : /snow/.test(sky) ? 'ac_unit' : /rain|drizzle|shower/.test(sky) ? 'umbrella' : /cloud|overcast|fog/.test(sky) ? 'cloud' : 'wb_sunny';
    const windy = (w.windMph ?? 0) >= 15 || (w.gustMph ?? 0) >= 25;
    const parts = [
      w.tempF !== null && w.tempF !== undefined ? `${w.tempF}°` : null,
      w.windMph !== null && w.windMph !== undefined ? `${w.windMph} mph${windy && w.gustMph ? ` (gusts ${w.gustMph})` : ''}` : null,
      w.roof === 'retractable' ? 'Roof' : null,
      place || null,
    ];
    return { icon: windy ? 'air' : icon, text: parts.filter(Boolean).join(' · '), windy };
  }

  async ngOnInit(): Promise<void> {
    // (the teams' colors for the picks' words, alongside the picks)
    loadTeamColors(BET_SPORTS.map((s) => s.id)).then((colors) => {
      this.teamColors = colors;
      this.pickColors.clear();
    });
    const get = (url: string) =>
      fetch(url, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    // every sport's algorithm picks, and the AI desk's sheet where the sport has AI analyses (sports.json)
    const files = await Promise.all(
      BET_SPORTS.map(async (s) => ({
        sport: s.id,
        picks: (await get(`/${s.id}/data/model/picks.json`)) as Picks | null,
        bets: s.analysis ? await get(`/${s.id}/data/analysis/bets.json`) : null,
        sheet: s.analysis ? ((await get(`/${s.id}/data/analysis/bet-sheet.json`)) as Sheet | null) : null,
      })),
    );
    const algoRows: BetRow[] = [];
    const sheetRows: SheetCall[] = [];
    const records: BetRecord[] = [];
    for (const { sport, picks, bets: file, sheet } of files) {
      // The algorithm's picks
      if (picks?.picks?.length || picks?.record) {
        if (picks.record) records.push(picks.record);
        if (!this.updated || picks.at > this.updated) this.updated = picks.at;
        for (const p of picks.picks ?? []) {
          if (p.where) this.places.set(`${sport}|${p.matchup}`, p.where);
          algoRows.push({
            sport,
            source: 'Algorithm',
            game: { week: 0, date: p.start.slice(0, 10), kickoff: p.start, matchup: p.matchup, teams: p.teams, line: null },
            market: p.market,
            strength: 'like',
            reason: p.reason,
            confidence: p.level,
            id: algoRows.length,
            key: pickKey(sport, p.matchup, p.kind, p.pick),
            pick: p.pick,
            odds: americanOdds(p.odds),
            // (the order: its Kelly score, the file's, or worked out from its chance and price for a file from
            // before it ranked by one; its chance shows, its band colors it)
            sureness: Number.isFinite(p.why?.price) ? p.score : (kellyOf(p.p, p.odds) ?? p.score),
            chance: p.chance,
            betType: p.kind,
            side: p.side ?? null,
            player: p.player ?? null,
            athleteId: p.athlete ?? null,
            playerTeam: p.team ?? null,
            edge: p.edge,
            model: p.model,
            fair: p.fair,
            p: p.p,
            ev: p.ev,
            units: p.units,
            price: p.odds,
            book: p.book,
            why: p.why ?? null,
            // ---- wallet (phase 2) ----
            line: p.line,
            pickId: p.id,
            // ---- end wallet ----
          });
        }
      }
      if (!file?.bets?.length) continue;
      // (the AI desk's sheet: only the coming week's, from its latest reports)
      const newest = Math.max(...file.bets.map((b: BetEntry) => Date.parse(b.at)));
      const latest = file.bets.filter((b: BetEntry) => newest - Date.parse(b.at) < 6 * 3600e3);
      const week = Math.min(...latest.map((b: BetEntry) => b.game?.week ?? Infinity));
      if (sheet?.week === week && sheet.picks?.length) {
        for (const [matchup, info] of Object.entries(sheet.games ?? {})) if (!this.places.has(`${sport}|${matchup}`)) this.places.set(`${sport}|${matchup}`, info);
        for (const p of sheet.picks) {
          const betType = kindOf(p.grade?.kind, p.label, p.bet, p.game);
          sheetRows.push({
            key: p.game ? pickKey(sport, p.game.matchup, betType, p.bet) : `${sport}|sheet|${sheetRows.length}`,
            strength: p.side,
            reason: p.case,
            risk: p.risk,
          });
        }
      }
    }
    // The algorithm's record on its published picks, all its sports together
    if (records.length) this.record = sumRecords(records);
    // Where the analyst's sheet makes the same call as an algorithm pick: marked as both's, its reasons added,
    // and its score counted a quarter higher in the order where it has an edge (two independent reads agreeing;
    // never a negative one made worse); the sheet's other picks aren't shown
    const byKey = new Map(algoRows.map((r) => [r.key, r]));
    for (const s of sheetRows) {
      const a = byKey.get(s.key);
      if (!a || s.strength === 'fade') continue;
      a.source = 'Algorithm + Analyst';
      a.sureness = withAnalyst(a.sureness);
      a.reason = `${a.reason} Analyst: ${s.reason}`;
      a.risk = s.risk;
    }
    // (each one's band from its score as it now stands, the analyst's quarter in it; all sports' picks together,
    // the locks above the rest, then the best Kelly score first)
    for (const a of algoRows) a.confidence = confidenceOf(a.sureness, a.p ?? (a.chance != null ? a.chance / 100 : null), a.edge);
    const locked = (r: BetRow) => (r.confidence === 'lock' ? 0 : 1);
    this.rows = algoRows.sort((a, b) => locked(a) - locked(b) || b.sureness - a.sureness || (a.game?.kickoff ?? '').localeCompare(b.game?.kickoff ?? ''));
    this.dropStarted();
    this.ticker = setInterval(() => this.dropStarted(), 60_000);
    // ---- wallet (phase 2) ----
    this.buildBoards();
    // ---- end wallet ----
  }

  // ---- wallet (phase 2) ----
  // Play betting: each game's every line (<game-lines>, ESPN's DraftKings board, the bot's picks lit), its
  // ESPN id, start and the bot's picks on it, by the game filter's key; and the games on the boards the bot
  // has no pick on, for the dropdown (their lines only). The slip (<bet-slip>) and #wallet do the rest.
  readonly lines = inject(LinesService);
  boards = new Map<string, { sport: string; event: string; start: string; matchup: string; picks: BetRow[] }>();
  private buildBoards(): void {
    for (const r of this.rows ?? []) {
      const event = r.pickId?.split(':')[0];
      if (!r.game || !event) continue;
      const key = this.gameKey(r);
      const b = this.boards.get(key) ?? { sport: r.sport, event, start: r.game.kickoff ?? r.game.date, matchup: r.game.matchup, picks: [] };
      b.picks.push(r);
      this.boards.set(key, b);
    }
    // (each sport's board on the days the picks are on: the lines, and the games without a pick)
    void this.lines.games([...this.boards.values()]);
  }

  // (a game on ESPN's boards, not begun, with DraftKings' lines, that the bot has no pick on)
  get moreGames(): { key: string; label: string }[] {
    const out: { key: string; label: string; at: string }[] = [];
    for (const g of this.lines.boards().values()) {
      const key = `${g.sport}|${g.matchup}`;
      if (g.state !== 'pre' || this.boards.has(key) || !(g.spread || g.total || g.ml)) continue;
      const time = new Date(g.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      out.push({ key, label: `${g.sport.toUpperCase()} · ${g.matchup} · ${time}`, at: g.start });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at) || a.label.localeCompare(b.label));
  }

  // (the chosen game's board: one with picks, or one from the boards alone)
  boardFor(key: string): { sport: string; event: string; start: string; matchup: string; picks: BetRow[] } | null {
    const known = this.boards.get(key);
    if (known) return known;
    for (const g of this.lines.boards().values()) {
      if (`${g.sport}|${g.matchup}` === key) {
        const board = { sport: g.sport, event: g.event, start: g.start, matchup: g.matchup, picks: [] };
        this.boards.set(key, board);
        return board;
      }
    }
    return null;
  }
  // ---- end wallet ----

  // (a pick whose game has started can't be bet: off the list, and its game off the dropdown, when the
  // page loads and each minute after; the picks file is only rewritten hourly)
  private ticker: ReturnType<typeof setInterval> | null = null;
  private dropStarted(): void {
    const now = Date.now();
    const open = (this.rows ?? []).filter((r) => !r.game?.kickoff || Date.parse(r.game.kickoff) > now);
    if (this.rows && open.length === this.rows.length && this.gameDays.length) return;
    this.rows = open;
    this.gameDays = this.buildGameDays();
    if (this.game && !open.some((r) => this.gameKey(r) === this.game)) this.game = '';
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  // A team logo's address: a path under the sport's own site, or a full address as it is
  logoSrc(r: BetRow, logo: string): string {
    return /^https?:/.test(logo) ? logo : `/${r.sport}/${logo}`;
  }

  // All games: the top 40 bets; a game: its top 15 (from all of its bets, not just those in the top 40)
  get shown(): BetRow[] {
    // (the chips on that this game has: a game without any of them shows all its bets, not an empty list
    // whose chips have gone)
    const inGame = this.inGame;
    const kinds = [...this.kinds].filter((k) => inGame.some((r) => r.betType === k));
    const rows = kinds.length ? inGame.filter((r) => kinds.includes(r.betType)) : inGame;
    return rows.slice(0, this.game ? this.gameLimit : this.limit);
  }

  // The bets in the chosen game (all of them for All Games)
  private get inGame(): BetRow[] {
    const rows = this.rows ?? [];
    return this.game ? rows.filter((r) => this.gameKey(r) === this.game) : rows;
  }

  // The filter chips: the types of bet in the chosen game, each with how many; none on shows them all
  kinds = new Set<BetKind>();
  get kindChips(): { kind: BetKind; label: string; name: string; count: number }[] {
    const rows = this.inGame;
    return BET_KINDS.map((k) => ({ ...k, count: rows.filter((r) => r.betType === k.kind).length })).filter((k) => k.count);
  }

  toggleKind(kind: BetKind): void {
    this.closeWhy();
    if (!this.kinds.delete(kind)) this.kinds.add(kind);
  }

  // The week's games with bets: the dropdown's choices under a header for each day, by kickoff (in the
  // viewer's time zone; London's morning game first on Sunday), each with how many bets it has. Built once the
  // picks are in (they don't change after), not on every check of the page
  gameDays: { day: string; games: { key: string; label: string; count: number }[] }[] = [];
  private buildGameDays(): { day: string; games: { key: string; label: string; count: number }[] }[] {
    const byGame = new Map<string, { key: string; label: string; day: string; at: number; count: number }>();
    for (const r of this.rows ?? []) {
      if (!r.game) continue;
      const key = this.gameKey(r);
      let game = byGame.get(key);
      if (!game) {
        const kickoff = r.game.kickoff ? new Date(r.game.kickoff) : null;
        const day = kickoff ?? new Date(`${r.game.date}T12:00:00`);
        game = {
          key,
          label: kickoff
            ? `${r.game.matchup} · ${kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
            : r.game.matchup,
          day: day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
          at: day.getTime(),
          count: 0,
        };
      }
      game.count = Math.min(game.count + 1, this.gameLimit);
      byGame.set(key, game);
    }
    const days: { day: string; games: { key: string; label: string; count: number }[] }[] = [];
    for (const game of [...byGame.values()].sort((a, b) => a.at - b.at || a.label.localeCompare(b.label))) {
      if (days.at(-1)?.day !== game.day) days.push({ day: game.day, games: [] });
      days.at(-1)!.games.push(game);
    }
    return days;
  }

  gameKey(r: BetRow): string {
    return `${r.sport}|${r.game?.matchup ?? ''}`;
  }

  // A bet's side: fade (going against what it names) or like (backing it); an older report's lean is a
  // like (how sure is the confidence's job)
  side(r: BetRow): 'like' | 'fade' {
    return r.strength === 'fade' ? 'fade' : 'like';
  }

  // Its chip, by its band (bet-why.ts confidenceOf): "Lock", "Love", "Bet", or "Pass" (a small edge, or none on
  // its price: a bet the bot made for the data, never one to make); a fade "Fade"
  grade(r: BetRow): 'lock' | 'love' | 'like' | 'fade' | 'pass' {
    if (r.strength === 'fade') return 'fade';
    return ({ lock: 'lock', high: 'love', medium: 'like', low: 'pass' } as const)[this.level(r)];
  }

  // A bet's band, its row's color: a lock, then its Kelly score 5 or more, 2 or more, or under (picks.mjs)
  level(r: BetRow): Confidence {
    return r.confidence ?? 'low';
  }

  // (the locks shown: above the ranks, the first bet under them #1)
  lockCount(rows: BetRow[]): number {
    return rows.filter((r) => r.confidence === 'lock').length;
  }

  toggle(id: number): void {
    if (!this.open.delete(id)) this.open.add(id);
  }

  // ---------------------------------------------------------------------------
  // Why a bet ranks where it does: its rank tile clicked (or Enter / Space on it) opens how its score is
  // built (bet-why.ts), as the grid's rank tile does
  // ---------------------------------------------------------------------------
  why: (BetWhy & { at: { top: number | null; bottom: number | null; left: number; room: number }; sheet: boolean }) | null = null;
  @ViewChild('whyPop') whyPop?: ElementRef<HTMLElement>;
  private whyTile: HTMLElement | null = null;
  readonly signedPoints = signedPoints;
  readonly betScoreText = betScoreText;

  // The rank tile's hover: its place (a lock's, above the ranks), its Kelly score and its chance ("#2 of 40 ·
  // Kelly +3.12 · 64% to win")
  rankTitle(r: BetRow, i: number, n: number, locks: number): string {
    const place = r.confidence === 'lock' ? 'Lock' : `#${i + 1 - locks} of ${n - locks}`;
    return `${place} · Kelly ${betScoreText(r.sureness * 100)}${r.chance != null ? ` · ${r.chance}% to win` : ''}`;
  }

  toggleWhy(index: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const rows = this.shown;
    const row = rows[index];
    if (!row) return;
    if (this.why?.id === row.id) {
      this.closeWhy(true);
      return;
    }
    const tile = event.currentTarget as HTMLElement;
    // (hung under the tile, or over it when there's more room above; inside the screen's edges, no taller
    // than the room it has; phones: a sheet along the bottom)
    const rect = tile.getBoundingClientRect();
    const below = innerHeight - rect.bottom;
    const left = Math.max(8, Math.min(rect.left, innerWidth - 348));
    const at =
      below >= 420 || below >= rect.top
        ? { top: rect.bottom + 6, bottom: null, left, room: below - 14 }
        : { top: null, bottom: innerHeight - rect.top + 6, left, room: rect.top - 14 };
    this.why = { ...betWhy(rows, index), at, sheet: matchMedia('(max-width: 575px)').matches };
    this.whyTile = tile;
    setTimeout(() => this.whyPop?.nativeElement.focus({ preventScroll: true }));
  }

  closeWhy(refocus = false): void {
    if (!this.why) return;
    this.why = null;
    if (refocus) this.whyTile?.focus({ preventScroll: true });
    this.whyTile = null;
  }

  // (a click anywhere off it and its tile shuts it; so does the list scrolling out from under it, or the
  // screen changing size)
  @HostListener('document:click', ['$event'])
  clickOff(event: MouseEvent): void {
    if (this.why && !(event.target as Element | null)?.closest('.bet-why, .bet-rank')) this.closeWhy();
  }

  @HostListener('window:resize')
  listMoved(): void {
    this.closeWhy();
  }

  // (Escape shuts it, focus back on its tile)
  @HostListener('document:keydown.escape')
  escape(): void {
    this.closeWhy(true);
  }

  // The slot handle: pulled, it swings down and springs back, and as it lands the rows spin in like reels
  pulling = false;
  spinning = false;
  pull(): void {
    if (this.pulling) return;
    this.closeWhy();
    this.pulling = true;
    setTimeout(() => (this.spinning = true), 280);
    setTimeout(() => (this.pulling = false), 700);
    setTimeout(() => (this.spinning = false), 2400);
  }
}

// Records added up: the algorithm's sports' published picks together (wins, losses, pushes; the share won)
function sumRecords(list: BetRecord[]): BetRecord {
  const add = (pick: (r: BetRecord) => Tally | undefined): Tally => {
    const t = { wins: 0, losses: 0, pushes: 0, winPct: null as number | null };
    for (const r of list) {
      const x = pick(r);
      if (!x) continue;
      t.wins += x.wins;
      t.losses += x.losses;
      t.pushes += x.pushes;
    }
    t.winPct = t.wins + t.losses ? t.wins / (t.wins + t.losses) : null;
    return t;
  };
  const locks = add((r) => r.byLevel.lock);
  return {
    graded: list.reduce((n, r) => n + r.graded, 0),
    overall: add((r) => r.overall),
    byLevel: { ...(locks.wins + locks.losses + locks.pushes ? { lock: locks } : {}), high: add((r) => r.byLevel.high), medium: add((r) => r.byLevel.medium), low: add((r) => r.byLevel.low) },
  };
}
