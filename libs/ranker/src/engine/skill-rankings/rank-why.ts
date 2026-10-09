import type { SkillPlayer, SkillStat, SkillWeights } from '@sport/positions';
import type { SportSettings } from '@ranker/engine/sport';
import { SPORT } from '@sport/sport';

// Why a row ranks where it does (its rank tile clicked): its score split by stat, and what separates it
// from the rows beside it. The numbers are the list's own (TabRanker.scores: each stat's standard score
// times its slider), so the parts add up to the score the list went by.

// One stat's share: what it added to the score (+ helps, - hurts), its bar's length against the largest
// (every stat that counted, biggest first: the popover's list scrolls)
export interface WhyPart {
  key: string;
  label: string;
  value: string;
  amount: number;
  width: number;
  // (its hover: the stat written out, the value and its place in the list, the slider, the math)
  title: string;
}

// A row beside it: the gap in score and the stats making most of it (from this row's side)
export interface WhyVs {
  name: string;
  rank: number;
  above: boolean;
  diff: number;
  drivers: { label: string; amount: number; title: string }[];
  title: string;
  // (head to head put them this way round, against their scores)
  headToHead: string | null;
}

export interface RankWhy {
  id: string;
  name: string;
  rank: number;
  of: number;
  score: number;
  // (its place on score alone, when that isn't where it sits: dragged by hand, or moved by head to head)
  scoreRank: number;
  manual: boolean;
  movedByHeadToHead: boolean;
  parts: WhyPart[];
  vs: WhyVs[];
}

// How a stat reads (the grid's own label and cell text)
export interface WhyReader {
  label(stat: SkillStat): string;
  name(stat: SkillStat): string;
  listRank(player: SkillPlayer, stat: SkillStat): { rank: number; tied: boolean } | null;
  format(player: SkillPlayer, stat: SkillStat): string;
  lastFive(player: SkillPlayer): number[];
}

export function rankWhy(
  list: SkillPlayer[],
  index: number,
  scored: {
    totals: Map<SkillPlayer, number>;
    counted: SkillStat[];
    parts: Map<SkillPlayer, Map<string, number>>;
    // (each stat's slider and strength, for the hovers)
    weights?: SkillWeights;
    strengths?: Map<string, number>;
  },
  reader: WhyReader,
  options: { manual: boolean; settings: SportSettings },
): RankWhy {
  const player = list[index];
  const total = (p: SkillPlayer) => scored.totals.get(p) ?? 0;
  const statOf = new Map<string, SkillStat>(scored.counted.map((stat) => [stat.key, stat]));
  const label = (key: string) => {
    const stat = statOf.get(key);
    return stat ? reader.label(stat) : key;
  };
  const own = scored.parts.get(player) ?? new Map<string, number>();

  // A stat's hover: "Off Rank (Pts): offense's rank by points per game, #5 of 32 · slider 50% · +1.24 to the
  // score (its standard score +1.24 x 1.00 for the slider)"
  const partTitle = (row: SkillPlayer, stat: SkillStat, value: string, amount: number) => {
    const name = reader.name(stat);
    const about = stat.description && stat.description !== name ? `${name}: ${stat.description}` : name;
    const place = stat.format === 'rank' || stat.format === 'recent' ? null : reader.listRank(row, stat);
    const shown = [value || null, place ? `#${place.rank}${place.tied ? ' (tied)' : ''} of ${list.length}` : null].filter(Boolean).join(', ');
    const weight = scored.weights?.[stat.key as keyof SkillWeights];
    const strength = scored.strengths?.get(stat.key);
    const slider = weight !== undefined ? `slider ${Math.round(weight)}%` : null;
    // (the share over the stat's strength: its standard score, sample-scaled where the sport does that)
    const math = strength
      ? ` (its standard score in the list, ${signedScore(amount / strength)}, times ${strength.toFixed(2)} for the slider${stat.support ? ', a support grade at a fifth' : ''})`
      : '';
    return [about, [shown, slider].filter(Boolean).join(' · '), `${signedScore(amount)} to the score${math}`].filter(Boolean).join('\n');
  };

  // Its parts, biggest first (a stat that added nothing isn't one)
  const all = [...own].filter(([, amount]) => amount !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const largest = Math.abs(all[0]?.[1] ?? 0);
  const parts = all.map(([key, amount]) => {
    const stat = statOf.get(key)!;
    const value = valueText(player, stat, reader);
    return { key, label: label(key), value, amount, width: largest ? (Math.abs(amount) / largest) * 100 : 0, title: partTitle(player, stat, value, amount) };
  });

  const score = total(player);
  const scoreRank = 1 + list.filter((other) => total(other) > score).length;
  const beat = SPORT.beat;
  const vs: WhyVs[] = [];
  for (const at of [index - 1, index + 1]) {
    const other = list[at];
    if (!other) continue;
    const theirs = scored.parts.get(other) ?? new Map<string, number>();
    const keys = new Set([...own.keys(), ...theirs.keys()]);
    const drivers = [...keys]
      .map((key) => ({ key, mine: own.get(key) ?? 0, their: theirs.get(key) ?? 0 }))
      .filter((d) => d.mine !== d.their)
      .sort((a, b) => Math.abs(b.mine - b.their) - Math.abs(a.mine - a.their))
      .slice(0, 3)
      .map(({ key, mine, their }) => {
        // (its hover: both values, both shares, the gap)
        const stat = statOf.get(key)!;
        const values = `${valueText(player, stat, reader) || '-'} vs ${valueText(other, stat, reader) || '-'}`;
        const title = `${reader.name(stat)}: ${values}\n${signedScore(mine)} vs ${signedScore(their)} to the score: ${signedScore(mine - their)} for ${player.name}`;
        return { label: label(key), amount: mine - their, title };
      });
    const above = at > index;
    const diff = score - total(other);
    // (above a better score, or below a worse one: not the scores' doing)
    const against = !options.manual && (above ? diff < 0 : diff > 0);
    const [winner, loser] = above ? [player, other] : [other, player];
    const headToHead = against && beat ? (beat(winner, loser, options.settings) ? `${winner.name} won head to head` : 'Moved by head to head') : null;
    const title = `Score ${scoreText(score)} vs ${scoreText(total(other))}: ${signedScore(diff)}\nThe three stats that differ most (+ in favor of ${player.name})`;
    vs.push({ name: other.name, rank: at + 1, above, diff, drivers, headToHead, title });
  }

  return {
    id: player.gsisId,
    name: player.name,
    rank: index + 1,
    of: list.length,
    score,
    scoreRank,
    manual: options.manual,
    // (a better score below it or a worse one above: a tie's order isn't a move)
    movedByHeadToHead: !options.manual && !!beat && list.some((other, at) => (at < index ? total(other) < score : at > index && total(other) > score)),
    parts,
    vs,
  };
}

// A stat's value as the row shows it (the Recent squares as a record: "4-1")
function valueText(player: SkillPlayer, stat: SkillStat, reader: WhyReader): string {
  if (stat.format === 'recent') {
    const results = reader.lastFive(player);
    if (!results.length) return '';
    const wins = results.filter((r) => r === 1).length;
    const ties = results.filter((r) => r === 0.5).length;
    const losses = results.length - wins - ties;
    return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  }
  const text = reader.format(player, stat);
  return text === '-' ? 'none' : text;
}

// A score as is ("21.04", "−0.50")
export function scoreText(score: number): string {
  return (Number(score.toFixed(2)) + 0).toFixed(2).replace('-', '−');
}

// A share of the score, signed ("+0.12", "−0.08"; to three places when it's under a hundredth)
export function signedScore(amount: number): string {
  const digits = Math.abs(amount) < 0.01 && amount !== 0 ? 3 : 2;
  const text = Math.abs(amount).toFixed(digits);
  return Number(text) === 0 ? text : `${amount < 0 ? '−' : '+'}${text}`;
}
