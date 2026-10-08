import { Component, OnInit, isDevMode } from '@angular/core';
import { SPORT_LINKS } from '@ranker/core/sports';
import { insteadText } from '../player-card/analysis';

// The Bets page (the sport bar's Bets link, #bets): every betting angle in the latest AI
// analyses (each sport's data/analysis/bets.json, written with them), one row per bet, ranked by how sure
// the analysis is that it wins (its 1-10 score; a fade can top the list), then by how many other reports
// make the same call. A row opens to its reasoning.

interface BetEntry {
  sport: string;
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

// (an older report's bet, without a score: like 7, fade 6, lean 5, one more for a sure report, one less
// for an unsure one)
const ESTIMATE = { like: 7, fade: 6, lean: 5 };
const SURE = { high: 3, medium: 2, low: 1 };

// A team as the schedule names it (the sportsbook's WSH and LAR are its WAS and LA)
const team = (abbr: string) => ({ WSH: 'WAS', LAR: 'LA' })[abbr] ?? abbr;

// The call a bet makes, the same however a report words it: a game total ("under 45.5"), a side
// ("ATL +2.5", "BAL ml"), or anything else by its market and direction ("jackson rushing yards|under")
function callKey(b: BetEntry): string {
  const game = b.game?.matchup ?? '';
  const lean = b.lean.trim();
  // a game total: "Under 45.5", or a bare "Under" on the market "Over/Under 45.5"
  const leanTotal = lean.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
  const bare = lean.match(/^(over|under)$/i);
  const marketTotal = b.market.match(/^(?:over\/under|over|under|o\/u|total)\s+(\d+(?:\.\d+)?)$/i);
  if (leanTotal) return `${game}|total ${leanTotal[1].toLowerCase()} ${leanTotal[2]}`;
  if (bare && marketTotal) return `${game}|total ${bare[1].toLowerCase()} ${marketTotal[1]}`;
  // a moneyline ("LV ML", "LV +160" on the market "LV moneyline +160"), or a side: "ATL +2.5"
  const ml = /\b(ML|moneyline)\b/i.test(`${lean} ${b.market}`) ? `${lean} ${b.market}`.match(/\b([A-Z]{2,3})\b/) : null;
  if (ml) return `${game}|${team(ml[1])} ml`;
  const spread = lean.match(/\b([A-Z]{2,3})\s*([+-]\d+(?:\.\d+)?)/);
  if (spread) return `${game}|${team(spread[1])} ${spread[2]}`;
  // anything else (a player's or a team's own numbers): its market and direction
  const direction = lean.match(/\b(over|under|yes|no)\b/i)?.[1]?.toLowerCase() ?? lean.toLowerCase();
  return `${game}|${b.market.toLowerCase().replace(/\s*\(.*\)/, '')}|${direction}`;
}

// The question a call answers, and its answer: a total ("...|total 43.5", over or under), or who wins the
// game (its spread and moneyline together: the team backed); null for anything else (a player's or a
// team's own numbers)
function lineOf(key: string): { line: string; side: string } | null {
  const [sport, game, call] = key.split('|');
  const total = call?.match(/^total (over|under) (.+)$/);
  if (total) return { line: `${sport}|${game}|total ${total[2]}`, side: total[1] };
  const side = call?.match(/^([A-Z]{2,3}) (?:[+-][\d.]+|ml)$/);
  if (side) return { line: `${sport}|${game}|winner`, side: side[1] };
  return null;
}

@Component({
  selector: 'bets-page',
  templateUrl: './bets-page.component.html',
  styleUrls: ['../../styles/components/bets-page.scss'],
  standalone: false,
})
export class BetsPageComponent implements OnInit {
  // (the model desk's admin panel: on the dev server only)
  readonly dev = isDevMode();
  view: 'bets' | 'desk' = 'bets';

  rows: BetRow[] | null = null;
  updated: string | null = null;
  // the filter: all games (the top 50 bets), or one game (its top 15, from all of its bets), by its matchup
  game = '';
  readonly limit = 50;
  readonly gameLimit = 15;
  open = new Set<number>();
  readonly insteadText = insteadText;
  // each game's venue and kickoff weather, from the bet desk's sheet ("nfl|CHI @ GB")
  places = new Map<string, GameInfo>();
  // how the desk's earlier picks did (data/analysis/ledger.json)
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
    // the bets of every sport with AI analyses (sports.json's analysis)
    const get = (url: string) =>
      fetch(url, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    const files = await Promise.all(
      SPORT_LINKS.filter((s) => s.analysis).map(async (s) => ({
        sport: s.id,
        bets: await get(`/${s.id}/data/analysis/bets.json`),
        sheet: (await get(`/${s.id}/data/analysis/bet-sheet.json`)) as Sheet | null,
        ledger: (await get(`/${s.id}/data/analysis/ledger.json`)) as { record: BetRecord | null } | null,
      })),
    );
    const entries: BetEntry[] = [];
    const sheetRows: BetRow[] = [];
    for (const { sport, bets: file, sheet, ledger } of files) {
      // (the desk's graded record, once any of its picks are graded)
      if (ledger?.record?.graded) this.record = ledger.record;
      if (!file?.bets?.length) continue;
      // (the latest run only: reports written within 6 hours of its newest, not an older pilot's)
      const newest = Math.max(...file.bets.map((b: BetEntry) => Date.parse(b.at)));
      const latest = file.bets.filter((b: BetEntry) => newest - Date.parse(b.at) < 6 * 3600e3);
      // (the coming week's games only: a team on a bye previews the week after, which would list its
      // opponent twice)
      const week = Math.min(...latest.map((b: BetEntry) => b.game?.week ?? Infinity));
      // The bet desk's sheet for this week, when there is one: its picks instead of the reports' own
      if (sheet?.week === week && sheet.picks?.length) {
        for (const [matchup, info] of Object.entries(sheet.games ?? {})) this.places.set(`${sport}|${matchup}`, info);
        for (const p of sheet.picks) {
          sheetRows.push({
            sport,
            source: p.sources.join(' · '),
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
            key: `${sport}|sheet|${sheetRows.length}`,
            pick: p.bet,
            marketLabel: p.label,
            agree: 0,
            sureness: p.strength,
            estimated: false,
            betType: kindOf(p.grade?.kind, p.label, p.bet, p.game),
          });
        }
        if (!this.updated || sheet.at > this.updated) this.updated = sheet.at;
        continue;
      }
      entries.push(...latest.filter((b: BetEntry) => b.game?.week === week));
      if (!this.updated || file.at > this.updated) this.updated = file.at;
    }
    // how many reports make each call
    const keys = entries.map((b) => `${b.sport}|${callKey(b)}`);
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    const rows = entries.map((b, i): BetRow => {
      const call = keys[i].split('|').slice(2).join('|');
      const total = call.match(/^total (over|under) (.+)$/);
      const side = call.match(/^([A-Z]{2,3}) ([+-][\d.]+)$/);
      const ml = call.match(/^([A-Z]{2,3}) ml$/);
      const [pick, marketLabel] = total
        ? [`${total[1][0].toUpperCase()}${total[1].slice(1)} ${total[2]}`, 'Game total']
        : side
          ? [`${side[1]} ${side[2]}`, 'Spread']
          : ml
            ? [`${ml[1]} ML`, 'Moneyline']
            : [b.lean, b.market];
      const estimated = !b.score;
      const sureness = b.score ?? Math.max(1, Math.min(10, ESTIMATE[b.strength] + SURE[b.confidence ?? 'medium'] - 2));
      return { ...b, id: i, key: keys[i], pick, marketLabel, agree: (counts.get(keys[i]) ?? 1) - 1, sureness, estimated, betType: kindOf(null, marketLabel, pick, b.game) };
    });
    rows.sort((a, b) => b.sureness - a.sureness || b.agree - a.agree || (a.game?.date ?? '').localeCompare(b.game?.date ?? ''));
    // the same call from several reports: listed once, as its highest-ranked report has it
    const kept = new Map<string, BetRow>();
    for (const r of rows) if (!kept.has(r.key)) kept.set(r.key, r);
    // opposite answers to the same question (the over and the under; one team and the other, by spread
    // or moneyline): the side more analyses back wins, its bets kept and the other's
    // dropped; an even split shows neither
    const questions = new Map<string, Map<string, BetRow[]>>();
    for (const r of kept.values()) {
      const q = lineOf(r.key);
      if (!q) continue;
      const answers = questions.get(q.line) ?? questions.set(q.line, new Map()).get(q.line)!;
      answers.set(q.side, [...(answers.get(q.side) ?? []), r]);
    }
    for (const answers of questions.values()) {
      if (answers.size < 2) continue;
      const support = (rs: BetRow[]) => ({ count: rs.reduce((n, r) => n + r.agree + 1, 0), sure: Math.max(...rs.map((r) => r.sureness)) });
      const ranked = [...answers.values()].map((rs) => ({ rs, ...support(rs) })).sort((a, b) => b.count - a.count || b.sure - a.sure);
      const tied = ranked[0].count === ranked[1].count;
      for (const [i, side] of ranked.entries()) if (tied || i > 0) for (const r of side.rs) kept.delete(r.key);
    }
    // (the desk's picks and any sport without a sheet, most sure first)
    this.rows = [...sheetRows, ...kept.values()].sort((a, b) => b.sureness - a.sureness);
  }

  // All games: the top 50 bets; a game: its top 15 (from all of its bets, not just those in the top 50)
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

  // A bet's confidence as words: high (7 and up), medium (5-6), low
  level(r: BetRow): 'high' | 'medium' | 'low' {
    return r.sureness >= 7 ? 'high' : r.sureness >= 5 ? 'medium' : 'low';
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
