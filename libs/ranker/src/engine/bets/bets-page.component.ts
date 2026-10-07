import { Component, OnInit } from '@angular/core';
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
  rows: BetRow[] | null = null;
  updated: string | null = null;
  // the filter: all games (the top 50 bets), or one game (its top 15, from all of its bets), by its matchup
  game = '';
  readonly limit = 50;
  readonly gameLimit = 15;
  open = new Set<number>();
  readonly insteadText = insteadText;

  async ngOnInit(): Promise<void> {
    // the bets of every sport with AI analyses (sports.json's analysis)
    const files = await Promise.all(
      SPORT_LINKS.filter((s) => s.analysis).map((s) =>
        fetch(`/${s.id}/data/analysis/bets.json`, { cache: 'no-cache' })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ),
    );
    const entries: BetEntry[] = [];
    for (const file of files) {
      if (!file?.bets?.length) continue;
      // (the latest run only: reports written within 6 hours of its newest, not an older pilot's)
      const newest = Math.max(...file.bets.map((b: BetEntry) => Date.parse(b.at)));
      const latest = file.bets.filter((b: BetEntry) => newest - Date.parse(b.at) < 6 * 3600e3);
      // (the coming week's games only: a team on a bye previews the week after, which would list its
      // opponent twice)
      const week = Math.min(...latest.map((b: BetEntry) => b.game?.week ?? Infinity));
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
      return { ...b, id: i, key: keys[i], pick, marketLabel, agree: (counts.get(keys[i]) ?? 1) - 1, sureness, estimated };
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
    this.rows = [...kept.values()];
  }

  // All games: the top 50 bets; a game: its top 15 (from all of its bets, not just those in the top 50)
  get shown(): BetRow[] {
    const rows = this.rows ?? [];
    return this.game ? rows.filter((r) => this.gameKey(r) === this.game).slice(0, this.gameLimit) : rows.slice(0, this.limit);
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
}
