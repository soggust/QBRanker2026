// The player card's hover words, one place for every tab (and the card's hero): a percentile, a rank in
// its list, a name's possessive, a skill's, a stat tile's and a zone's titles, the lean bar's shares.
// Plain functions (no Angular), so the tests read them as the card does.
import { ordinal } from '@ranker/core/format';
import type { CardSkill } from '@ranker/engine/skills';
import type { CardStat } from './card.model';
import type { ZoneStat } from './zones';

// A 0-1 standing as an ordinal: "92nd" (1st to 99th: nobody's 0th or 100th)
export function percentile(pct: number): string {
  return ordinal(Math.max(1, Math.min(99, Math.round(pct * 100))));
}

// "88th percentile"
export function percentileText(pct: number): string {
  return `${percentile(pct)} percentile`;
}

// "#3 of 32", "T-3 of 32" (tied)
export function rankText(rank: number, of: number, tied = false): string {
  return `${tied ? 'T-' : '#'}${rank} of ${of}`;
}

// "Lamar Jackson's", "San Francisco 49ers'", "Chris Jones'"
export function possessive(name: string): string {
  return name + (/s$/i.test(name) ? "'" : "'s");
}

// A skill's hover (its radar point, name and bar): "Accuracy: Top 8% · 92nd percentile"
export function skillTitle(skill: CardSkill | undefined): string {
  return skill ? `${skill.name}: ${skill.standing} · ${percentileText(skill.pct)}` : '';
}

// A stat tile's bar: "Passing Yds: 4,183 (#3 of 32) · Avg 3,610"
export function statTitle(s: Pick<CardStat, 'name' | 'display' | 'rank' | 'tied' | 'of' | 'avg'>): string {
  const rank = s.rank !== null ? ` (${rankText(s.rank, s.of, s.tied)})` : '';
  return `${s.name}${s.display ? ': ' + s.display : ''}${rank}${s.avg !== null ? ' · Avg ' + s.avg : ''}`;
}

// Where a zone sits, from the catcher's view ("01"-"09" the boxes left to right and down, "11"-"14" the
// corners outside): "low left", "middle of the zone", "outside the zone, high right"
export function zoneWhere(zone: string): string {
  const n = Number(zone);
  if (n > 10) return `outside the zone, ${['high left', 'high right', 'low left', 'low right'][n - 11]}`;
  if (n === 5) return 'middle of the zone';
  return `${['high', 'middle', 'low'][Math.floor((n - 1) / 3)]} ${['left', 'middle', 'right'][(n - 1) % 3]}`;
}

// A zone box's hover: "Slugging, low left: .512 (catcher's view)"
export function zoneTitle(stat: ZoneStat, zone: string): string {
  const value = stat.zones[zone]?.value;
  return `${stat.label}, ${zoneWhere(zone)}: ${value || 'none'} (catcher's view)`;
}

// The lean bar's shares as whole percents that add up to 100 (the run's what the pass leaves), and its
// hover: "Pass 59% · Run 41% (offenses usually pass 56%)"
export function leanShares(pass: number): { pass: number; run: number } {
  const p = Math.round(pass * 100);
  return { pass: p, run: 100 - p };
}

export function leanTitle(pass: number, usual: number | null): string {
  const s = leanShares(pass);
  return `Pass ${s.pass}% · Run ${s.run}%${usual !== null ? ` (offenses usually pass ${Math.round(usual * 100)}%)` : ''}`;
}
