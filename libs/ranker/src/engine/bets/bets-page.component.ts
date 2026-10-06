import { Component, OnInit } from '@angular/core';
import { SPORT_LINKS } from '@ranker/core/sports';

// The Bets page (dev only: the sport bar's Bets link, #bets): every betting angle in the latest AI
// analyses (each sport's data/analysis/bets.json, written with them), the same call from several reports
// merged into one, ranked most confident first: like, then lean, then fade; within a grade, the more
// reports making the call and the surer they are, the higher.

interface BetEntry {
  sport: string;
  source: string;
  kind: 'team' | 'player';
  position: string | null;
  rowId: string;
  team: string | null;
  game: { week: number; date: string; matchup: string; line: { line: string; overUnder: number | null } | null } | null;
  market: string;
  lean: string;
  strength: 'like' | 'lean' | 'fade';
  reason: string;
  confidence: 'low' | 'medium' | 'high' | null;
  at: string;
}

// One call: the pick as its best-graded report words it, its game, and every report making it
export interface BetCall {
  key: string;
  sport: string;
  pick: string;
  market: string;
  game: BetEntry['game'];
  strength: 'like' | 'lean' | 'fade';
  sources: BetEntry[];
  score: number;
}

const GRADE = { like: 3, lean: 2, fade: 1 };
const SURE = { high: 3, medium: 2, low: 1 };

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
  // a side: "ATL +2.5", or a moneyline
  const spread = lean.match(/\b([A-Z]{2,3})\s*([+-]\d+(?:\.\d+)?)/);
  if (spread) return `${game}|${spread[1]} ${spread[2]}`;
  const ml = `${lean} ${b.market}`.match(/\b([A-Z]{2,3})\s+(?:ML|moneyline)\b/i);
  if (ml) return `${game}|${ml[1]} ml`;
  // anything else (a player's or a team's own numbers): its market and direction
  const direction = lean.match(/\b(over|under|yes|no)\b/i)?.[1]?.toLowerCase() ?? lean.toLowerCase();
  return `${game}|${b.market.toLowerCase().replace(/\s*\(.*\)/, '')}|${direction}`;
}

@Component({
  selector: 'bets-page',
  templateUrl: './bets-page.component.html',
  styleUrls: ['../../styles/components/bets-page.scss'],
  standalone: false,
})
export class BetsPageComponent implements OnInit {
  calls: BetCall[] | null = null;
  updated: string | null = null;
  // the filters: a grade (or all), and how much of the list
  grade: 'all' | 'like' | 'lean' | 'fade' = 'all';
  share = 1;
  readonly shares = [
    { value: 1, label: 'All' },
    { value: 0.5, label: 'Top 50%' },
    { value: 0.25, label: 'Top 25%' },
  ];
  open = new Set<string>();

  async ngOnInit(): Promise<void> {
    // every sport's bets (the ones without any are skipped)
    const files = await Promise.all(
      SPORT_LINKS.map((s) =>
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
      entries.push(...file.bets.filter((b: BetEntry) => newest - Date.parse(b.at) < 6 * 3600e3));
      if (!this.updated || file.at > this.updated) this.updated = file.at;
    }
    const byCall = new Map<string, BetEntry[]>();
    for (const b of entries) {
      const key = `${b.sport}|${callKey(b)}`;
      if (!byCall.has(key)) byCall.set(key, []);
      byCall.get(key)!.push(b);
    }
    const calls = [...byCall].map(([key, sources]): BetCall => {
      // the call's grade: its best report's; its wording: that report's
      const sorted = [...sources].sort((a, b) => GRADE[b.strength] - GRADE[a.strength] || SURE[b.confidence ?? 'low'] - SURE[a.confidence ?? 'low']);
      const lead = sorted[0];
      const sure = Math.max(...sources.map((s) => SURE[s.confidence ?? 'low']));
      // a game total or a side reads as the call itself ("Under 45.5" / Game total, "TEN +7" / Spread)
      const call = key.split('|').slice(2).join('|');
      const total = call.match(/^total (over|under) (.+)$/);
      const side = call.match(/^([A-Z]{2,3}) ([+-][\d.]+)$/);
      const ml = call.match(/^([A-Z]{2,3}) ml$/);
      const [pick, market] = total
        ? [`${total[1][0].toUpperCase()}${total[1].slice(1)} ${total[2]}`, 'Game total']
        : side
          ? [`${side[1]} ${side[2]}`, 'Spread']
          : ml
            ? [`${ml[1]} ML`, 'Moneyline']
            : [lead.lean, lead.market];
      return {
        key,
        sport: lead.sport,
        pick,
        market,
        game: lead.game,
        strength: lead.strength,
        sources: sorted,
        // the grade first, then how many reports make the call, then how sure they are
        score: GRADE[lead.strength] * 100 + Math.min(sources.length, 9) * 10 + sure,
      };
    });
    this.calls = calls.sort((a, b) => b.score - a.score || (a.game?.date ?? '').localeCompare(b.game?.date ?? ''));
  }

  // The list as filtered: a grade, then the top share of what's left
  get shown(): BetCall[] {
    const calls = (this.calls ?? []).filter((c) => this.grade === 'all' || c.strength === this.grade);
    return calls.slice(0, Math.max(1, Math.ceil(calls.length * this.share)));
  }

  count(grade: 'like' | 'lean' | 'fade'): number {
    return (this.calls ?? []).filter((c) => c.strength === grade).length;
  }

  toggle(key: string): void {
    if (!this.open.delete(key)) this.open.add(key);
  }

  // A report's name in a call's sources: a team's nickname, a player with his position
  sourceLabel(b: BetEntry): string {
    return b.kind === 'team' ? b.source.replace(/\s*\(.*\)/, '') : `${b.source}${b.position ? ` (${b.position})` : ''}`;
  }
}
