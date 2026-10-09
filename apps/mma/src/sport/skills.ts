import { leagueRank, type Archetype, type SkillDef, type SkillDerivedStats, type SkillMinimum, type SkillMinimums } from '@ranker/engine/skills';
import { POSITIONS, SkillPlayer, SkillPosition } from '@sport/positions';

// MMA skills and archetypes for the fighter card (their shapes and the words for them:
// libs/ranker/src/engine/skills.ts)
const MMA_SKILLS: SkillDef[] = [
  { id: 'volume', name: 'Striking Output', short: 'Output', parts: [['slpm', 1], ['strDiff', 1]] },
  { id: 'accuracy', name: 'Striking Accuracy', short: 'Accuracy', parts: [['strAcc', 1]] },
  { id: 'striking-defense', name: 'Striking Defense', short: 'Str. Defense', parts: [['strDef', 1], ['sapm', -1]] },
  { id: 'power', name: 'Knockout Power', short: 'Power', parts: [['kd15', 1], ['koShare', 1]] },
  { id: 'wrestling', name: 'Wrestling', short: 'Wrestling', parts: [['td15', 1, 2], ['tdAcc', 1]] },
  { id: 'takedown-defense', name: 'Takedown Defense', short: 'TD Defense', parts: [['tdDef', 1]] },
  { id: 'grappling', name: 'Grappling', short: 'Grappling', parts: [['sub15', 1], ['adv15', 1]] },
  { id: 'durability', name: 'Durability', short: 'Chin', parts: [['kdAgainst', -1], ['finishedRate', -1]] },
  { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['recent', 1], ['rating', 1]] },
  { id: 'competition', name: 'Level of Competition', short: 'Competition', parts: [['titleWins', 1], ['titleDefenses', 1], ['qualityWins', 1], ['bestWin', 1], ['oppRating', 1]] },
];

export const SKILLS: Record<SkillPosition, SkillDef[]> = Object.fromEntries(POSITIONS.map((p) => [p, MMA_SKILLS])) as Record<
  SkillPosition,
  SkillDef[]
>;

// The box-score rates (strikes, takedowns, knockdowns, ground work) count toward a skill only over 4 or
// more fights with box stats (skills.ts SkillMinimum: the rows have no attempt counts, so his fights
// stand in for them); fewer, and a skill reads from his record's parts alone
const boxFights: SkillMinimum = { atLeast: 4, noun: 'fights with stats', attempts: (p) => p.statFights ?? 0 };
const BOX_MINIMUMS: SkillMinimums = Object.fromEntries(
  ['slpm', 'strDiff', 'strAcc', 'strDef', 'sapm', 'kd15', 'kdAgainst', 'td15', 'tdAcc', 'tdDef', 'sub15', 'adv15'].map((key) => [key, boxFights]),
);
export const SKILL_MINIMUMS: Partial<Record<SkillPosition, SkillMinimums>> = Object.fromEntries(POSITIONS.map((p) => [p, BOX_MINIMUMS]));

// Stats only skills read (skills.ts SkillDerived): how often he's been finished, per pro fight
export const SKILL_DERIVED: SkillDerivedStats = {
  finishedRate: {
    key: 'finishedRate',
    label: 'Finished / Fight',
    kind: 'efficiency',
    value: (p) => (p.games ? ((p.stats as Record<string, number | null>)['finished'] ?? 0) / p.games : null),
  },
};

// Volume against efficiency on the card: (output, accuracy)
export const VOLUME_VS_EFFICIENCY: Partial<Record<SkillPosition, [volume: string, efficiency: string]>> = Object.fromEntries(
  POSITIONS.map((p) => [p, ['volume', 'accuracy']]),
);

// Results against the fighting: winning more than the numbers say, or the reverse
export const WINS_VS_PLAY: Partial<Record<SkillPosition, [results: string, play: string]>> = Object.fromEntries(
  POSITIONS.map((p) => [p, ['winning', 'volume']]),
);

// Most specific first: the first whose test passes names the card
// (the pound-for-pound top: an active fighter by his rating against his division's best, a retired one
// by career points; the top 5 men, the top 3 women)
const p4pTop = (p: SkillPlayer) => {
  const women = ['WBW', 'WFLW', 'WSW', 'WP4P'].includes(p.division ?? '');
  const tab = women ? 'WP4P' : 'P4P';
  const rank = p.retired
    ? leagueRank(p, [tab], (row) => row.stats['careerPoints'], 'careerPoints')
    : leagueRank(p, [tab], (row) => (row.retired || row.games < 6 ? null : row.stats['rating']), 'rating');
  return rank <= (women ? 3 : 5);
};

const MMA_ARCHETYPES: Archetype[] = [
  { name: 'Pound-for-Pound Great', test: (s, _, p) => p4pTop(p) },
  { name: 'Complete Mixed Martial Artist', test: (s) => s['volume'] >= 0.7 && s['wrestling'] >= 0.7 && s['striking-defense'] >= 0.6 && s['takedown-defense'] >= 0.6 },
  { name: 'Knockout Artist', test: (s) => s['power'] >= 0.88 },
  // (a striker, not a grappler landing from the top: Sterling's output is control, not striking)
  { name: 'Volume Striker', test: (s) => s['volume'] >= 0.85 && s['power'] <= 0.6 && s['grappling'] < 0.75 && s['wrestling'] < 0.75 },
  { name: 'Sniper', test: (s) => s['accuracy'] >= 0.85 && s['striking-defense'] >= 0.6 },
  { name: 'Smothering Wrestler', test: (s) => s['wrestling'] >= 0.85 && s['grappling'] >= 0.55 },
  // (control over finishes: top position and the back, rarely a stoppage)
  { name: 'Wet Blanket', test: (s) => s['grappling'] >= 0.8 && s['power'] <= 0.35 },
  { name: 'Submission Specialist', test: (s) => s['grappling'] >= 0.85 },
  { name: 'Counter Striker', test: (s) => s['striking-defense'] >= 0.85 && s['volume'] <= 0.55 },
  { name: 'Sprawl and Brawl', test: (s) => s['takedown-defense'] >= 0.8 && s['volume'] >= 0.6 && s['wrestling'] <= 0.4 },
  { name: 'Iron Chin Brawler', test: (s) => s['durability'] >= 0.8 && s['volume'] >= 0.6 && s['striking-defense'] <= 0.4 },
  { name: 'Grinder', test: (s) => s['wrestling'] >= 0.7 && s['power'] <= 0.4 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = Object.fromEntries(POSITIONS.map((p) => [p, MMA_ARCHETYPES])) as Record<
  SkillPosition,
  Archetype[]
>;

// When no archetype fits: his belt (a champion now, or a former UFC champion), or a plain label for
// where he ranks
export function fallbackArchetype(_position: SkillPosition, overall: number, player: SkillPlayer): string {
  if (player.belt) return `${player.belt} Champion`;
  // (a former champion: the UFC's if he held its title, else the first other promotion's he did)
  if (player.titles?.length) return `Former ${player.titles.includes('UFC') ? 'UFC' : player.titles[0]} Champion`;
  // (a contender: the top 3 of his own division by rating, among the active; not the top of whatever
  // list the card was opened from)
  if (!player.retired && player.division && leagueRank(player, [player.division], (row) => (row.retired || row.only === 'allTime' ? null : row.stats['rating']), `rating/${player.division}`) <= 3) return 'Title Contender';
  return overall >= 0.6 ? 'Ranked-Level Fighter' : overall >= 0.3 ? 'Gatekeeper' : 'Prospect or Journeyman';
}
