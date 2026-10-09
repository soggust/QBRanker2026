import { Component, OnInit, isDevMode } from '@angular/core';
import { SPORT_LINKS } from '@ranker/core/sports';
import { insteadText } from '../player-card/analysis';

// The Bets page (the sport bar's Bets link, #bets): the algorithm's top picks for every sport (each one's
// data/model/picks.json, written by every run of the model desk: libs/ranker/scripts/model/picks.mjs), ranked
// together by their chance to win (the likeliest first; a bet without an edge on its price shows as low). The
// NFL's AI bet desk's sheet for the week (data/analysis/bet-sheet.json) only marks the picks it agrees with
// (the same game, market and side: "Algorithm + Analyst", ranked a little higher); its other picks aren't
// shown. A row opens to its reasoning.

interface BetEntry {
  sport: string;
  // whose pick: the algorithm's, the analyst's, or both
  source: string;
  kind: 'team' | 'player';
  position: string | null;
  rowId: string;
  team: string | null;
  game: { week: number; date: string; kickoff?: string | null; matchup: string; teams?: { abbr: string; logo: string | null }[]; line: { line: string; overUnder: number | null } | null } | null;
  market: string;
  lean: string;
  strength: 'like' | 'lean' | 'fade';
  // how likely it wins, 1-10 (reports written before the score have none)
  score?: number | null;
  reason: string;
  // (a bet desk pick: the most likely way it loses)
  risk?: string;
  confidence: 'low' | 'medium' | 'high' | null;
  at: string;
}

// One bet as the page shows it: the pick (a game total or a side read as the call itself), and how many
// other reports make the same call
export interface BetRow extends BetEntry {
  id: number;
  // (an algorithm pick's chance to win, a whole percent)
  chance?: number;
  pick: string;
  marketLabel: string;
  agree: number;
  key: string;
  // its score, or for an older report an estimate from its grade and the report's confidence
  sureness: number;
  estimated: boolean;
  // its type, for the filter chips
  betType: BetKind;
}

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
  game: BetEntry['game'];
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
function kindOf(graded: BetKind | null | undefined, label: string, bet: string, game: BetEntry['game']): BetKind {
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
  byLevel: { high: Tally; medium: Tally; low: Tally };
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
  score: number;
  // its chance to win, a whole percent (the band its level)
  chance: number;
  level: 'high' | 'medium' | 'low';
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

@Component({
  selector: 'bets-page',
  // (the page's main content: the Bets page has no <main> of its own around it)
  host: { role: 'main' },
  templateUrl: './bets-page.component.html',
  styleUrls: ['../../styles/components/bets-page.scss'],
  standalone: false,
})
export class BetsPageComponent implements OnInit {
  // (the model desk's admin panel: on the dev server only)
  readonly dev = isDevMode();
  // (development opens on the Algorithm, the live site has only the bets)
  view: 'bets' | 'desk' = isDevMode() ? 'desk' : 'bets';

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
    const get = (url: string) =>
      fetch(url, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    // every sport's algorithm picks, and the AI desk's sheet where the sport has AI analyses (sports.json)
    const files = await Promise.all(
      SPORT_LINKS.map(async (s) => ({
        sport: s.id,
        picks: (await get(`/${s.id}/data/model/picks.json`)) as Picks | null,
        bets: s.analysis ? await get(`/${s.id}/data/analysis/bets.json`) : null,
        sheet: s.analysis ? ((await get(`/${s.id}/data/analysis/bet-sheet.json`)) as Sheet | null) : null,

      })),
    );
    const algoRows: BetRow[] = [];
    const sheetRows: BetRow[] = [];
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
            kind: p.kind === 'player' ? 'player' : 'team',
            position: null,
            rowId: '',
            team: null,
            game: { week: 0, date: p.start.slice(0, 10), kickoff: p.start, matchup: p.matchup, teams: p.teams, line: null },
            market: p.market,
            lean: p.pick,
            strength: 'like',
            score: p.score,
            reason: p.reason,
            confidence: p.level,
            at: picks.at,
            id: algoRows.length,
            key: pickKey(sport, p.matchup, p.kind, p.pick),
            pick: p.pick,
            marketLabel: `${p.market} · ${p.book} ${p.odds > 0 ? '+' : ''}${p.odds}`,
            agree: 0,
            // (the order: its edge score; its chance shows, its band colors it)
            sureness: p.score,
            chance: p.chance,
            estimated: false,
            betType: p.kind,
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
            sport,
            source: 'Analyst',
            kind: 'team',
            position: null,
            rowId: '',
            team: null,
            game: p.game,
            // (a fade names what it goes against; its pick is the bet to make instead)
            market: p.side === 'fade' && p.fades ? p.fades : p.label,
            lean: p.bet,
            strength: p.side,
            score: p.strength,
            reason: p.case,
            risk: p.risk,
            confidence: null,
            at: sheet.at,
            id: 10000 + sheetRows.length,
            key: p.game ? pickKey(sport, p.game.matchup, betType, p.bet) : `${sport}|sheet|${sheetRows.length}`,
            pick: p.bet,
            marketLabel: p.label,
            agree: 0,
            sureness: p.strength,
            estimated: false,
            betType,
          });
        }
      }
    }
    // The algorithm's record on its published picks, all its sports together
    if (records.length) this.record = sumRecords(records);
    // Where the analyst's sheet makes the same call as an algorithm pick: marked as both's, its reasons added,
    // and its edge counted a quarter higher in the order (two independent reads agreeing); the sheet's other
    // picks aren't shown
    const byKey = new Map(algoRows.map((r) => [r.key, r]));
    for (const s of sheetRows) {
      const a = byKey.get(s.key);
      if (!a || s.strength === 'fade') continue;
      a.source = 'Algorithm + Analyst';
      a.sureness *= 1.25;
      a.reason = `${a.reason} Analyst: ${s.reason}`;
      a.risk = s.risk;
    }
    // (all sports' picks together, the likeliest first)
    this.rows = algoRows.sort((a, b) => b.sureness - a.sureness || (a.game?.kickoff ?? '').localeCompare(b.game?.kickoff ?? ''));
  }

  // A sport's label for a row
  sportLabel(r: BetRow): string {
    return r.sport.toUpperCase();
  }

  // A team logo's address: a path under the sport's own site, or a full address as it is
  logoSrc(r: BetRow, logo: string): string {
    return /^https?:/.test(logo) ? logo : `/${r.sport}/${logo}`;
  }

  // All games: the top 40 bets; a game: its top 15 (from all of its bets, not just those in the top 40)
  get shown(): BetRow[] {
    const rows = this.inGame.filter((r) => !this.kinds.size || this.kinds.has(r.betType));
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
    if (!this.kinds.delete(kind)) this.kinds.add(kind);
  }

  // The week's games with bets: the dropdown's choices under a header for each day, by kickoff (in the
  // viewer's time zone; London's morning game first on Sunday), each with how many bets it has
  get gameDays(): { day: string; games: { key: string; label: string; count: number }[] }[] {
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

  // A bet's band, its row's color: its chance to win 60% or more, 53% or more, or under (picks.mjs)
  level(r: BetRow): 'high' | 'medium' | 'low' {
    return r.confidence ?? 'low';
  }

  toggle(id: number): void {
    if (!this.open.delete(id)) this.open.add(id);
  }

  // The slot handle: pulled, it swings down and springs back, and as it lands the rows spin in like reels
  pulling = false;
  spinning = false;
  pull(): void {
    if (this.pulling) return;
    this.pulling = true;
    setTimeout(() => (this.spinning = true), 280);
    setTimeout(() => (this.pulling = false), 700);
    setTimeout(() => (this.spinning = false), 2400);
  }
}

// Records added up: the algorithm's sports' published picks together (wins, losses, pushes; the share won)
function sumRecords(list: BetRecord[]): BetRecord {
  const add = (pick: (r: BetRecord) => Tally): Tally => {
    const t = { wins: 0, losses: 0, pushes: 0, winPct: null as number | null };
    for (const r of list) {
      const x = pick(r);
      t.wins += x.wins;
      t.losses += x.losses;
      t.pushes += x.pushes;
    }
    t.winPct = t.wins + t.losses ? t.wins / (t.wins + t.losses) : null;
    return t;
  };
  return {
    graded: list.reduce((n, r) => n + r.graded, 0),
    overall: add((r) => r.overall),
    byLevel: { high: add((r) => r.byLevel.high), medium: add((r) => r.byLevel.medium), low: add((r) => r.byLevel.low) },
  };
}
