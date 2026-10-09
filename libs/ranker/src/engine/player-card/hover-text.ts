// The player card's hover words, one place for every tab (and the card's hero): a percentile, a rank in
// its list, a name's possessive, a skill's, a stat tile's and a zone's titles, the lean bar's shares.
// Plain functions (no Angular), so the tests read them as the card does.
import { ordinal } from '@ranker/core/format';
import type { CardSkill, SkillDef, SkillMinimums } from '@ranker/engine/skills';
import { PER_GAME_LABELS } from '@sport/positions';

// A stat as a skill names it: a column (SkillStat) or a stat only skills read (SkillDerived)
type PartStat = { key: string; label: string; kind: string };
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

// A skill's hover (its radar point, name and bar): "Accuracy: Top 8% · 92nd percentile", and on the next
// line what it's made of (skillDefinition)
export function skillTitle(skill: Pick<CardSkill, 'name' | 'standing' | 'pct' | 'about'> | undefined): string {
  if (!skill) return '';
  return `${skill.name}: ${skill.standing} · ${percentileText(skill.pct)}${skill.about ? '\n' + skill.about : ''}`;
}

// A stat as a skill reads it: a counting stat per game ("3PM / G"), anything else its label ("3P %")
export function skillPartLabel(stat: PartStat): string {
  return stat.kind === 'volume' ? (PER_GAME_LABELS[stat.key as keyof typeof PER_GAME_LABELS] ?? `${stat.label} / Game`) : stat.label;
}

// "A", "A and B", "A, B and C"
const andList = (items: string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const plain = (n: number): string => String(Number(n.toFixed(2)));
const weightWord = (w: number): string => (w === 0.5 ? 'half weight' : w === 2 ? 'double weight' : `${plain(w)}x weight`);

// What a skill is made of, from its definition and the stats' labels (the stats the tab has): its parts
// (one counting less, or where less is better, says so), then the volume a rate needs to count (the
// sport's SKILL_MINIMUMS): "3PM / G, 3P % and FT % (half weight); 3P % and FT % need 1.5 and 1 attempts a
// game", "TD / 15 (double weight) and TD Acc; each needs 4 fights with stats"
export function skillDefinition(def: Pick<SkillDef, 'parts'>, stats: PartStat[], minimums: SkillMinimums = {}): string {
  const parts: string[] = [];
  const needs = new Map<string, { noun: string; perGame: boolean; labels: string[]; counts: number[] }>();
  for (const [key, dir, weight = 1] of def.parts) {
    const stat = stats.find((s) => s.key === key);
    if (!stat) continue;
    const label = skillPartLabel(stat);
    if (parts.some((p) => p === label || p.startsWith(label + ' ('))) continue;
    const notes = [dir < 0 ? 'lower is better' : '', weight !== 1 ? weightWord(weight) : ''].filter(Boolean);
    parts.push(notes.length ? `${label} (${notes.join(', ')})` : label);
    const min = minimums[key];
    if (min) {
      // (a count a game, or all told)
      const perGame = min.perGame !== undefined;
      const id = `${min.noun}|${perGame}`;
      const need = needs.get(id) ?? needs.set(id, { noun: min.noun, perGame, labels: [], counts: [] }).get(id)!;
      need.labels.push(label);
      need.counts.push(min.perGame ?? min.atLeast ?? 0);
    }
  }
  const rules = [...needs.values()].map(({ noun, perGame, labels, counts }) => {
    const same = counts.every((c) => c === counts[0]);
    const one = same && counts[0] === 1;
    const amount = `${same ? plain(counts[0]) : andList(counts.map(plain))} ${one ? noun.replace(/s(?= with| of|$)/, '') : noun}${perGame ? ' a game' : ''}`;
    // (every part of the skill asks the same: said once, not each named again)
    if (same && labels.length === parts.length) return `${labels.length > 1 ? 'each needs' : 'needs'} ${amount}`;
    return `${andList(labels)} need${labels.length > 1 ? '' : 's'} ${amount}`;
  });
  return [andList(parts), ...rules].filter(Boolean).join('; ');
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
