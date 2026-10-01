import type { Archetype, SkillDef } from '@ranker/engine/skills';
import { POSITIONS, SkillPosition } from '@sport/positions';

// UFC skills and archetypes for the fighter card (their shapes and the words for them:
// libs/ranker/src/engine/skills.ts)
const UFC_SKILLS: SkillDef[] = [
  { id: 'volume', name: 'Striking Output', short: 'Output', parts: [['slpm', 1], ['strDiff', 1]] },
  { id: 'accuracy', name: 'Striking Accuracy', short: 'Accuracy', parts: [['strAcc', 1]] },
  { id: 'striking-defense', name: 'Striking Defense', short: 'Str. Defense', parts: [['strDef', 1], ['sapm', -1]] },
  { id: 'power', name: 'Knockout Power', short: 'Power', parts: [['kd15', 1], ['finishRate', 1]] },
  { id: 'wrestling', name: 'Wrestling', short: 'Wrestling', parts: [['td15', 1], ['tdAcc', 1]] },
  { id: 'takedown-defense', name: 'Takedown Defense', short: 'TD Defense', parts: [['tdDef', 1]] },
  { id: 'grappling', name: 'Grappling', short: 'Grappling', parts: [['sub15', 1], ['adv15', 1]] },
  { id: 'durability', name: 'Durability', short: 'Chin', parts: [['kdAgainst', -1], ['finished', -1]] },
  { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['recent', 1], ['schedule', 1]] },
];

export const SKILLS: Record<SkillPosition, SkillDef[]> = Object.fromEntries(POSITIONS.map((p) => [p, UFC_SKILLS])) as Record<
  SkillPosition,
  SkillDef[]
>;

// Volume against efficiency on the card: (output, accuracy)
export const VOLUME_VS_EFFICIENCY: Partial<Record<SkillPosition, [volume: string, efficiency: string]>> = Object.fromEntries(
  POSITIONS.map((p) => [p, ['volume', 'accuracy']]),
);

// Results against the fighting: winning more than the numbers say, or the reverse
export const WINS_VS_PLAY: Partial<Record<SkillPosition, [results: string, play: string]>> = Object.fromEntries(
  POSITIONS.map((p) => [p, ['winning', 'volume']]),
);

// Most specific first: the first whose test passes names the card
const UFC_ARCHETYPES: Archetype[] = [
  { name: 'Pound-for-Pound Great', test: (s, o) => s['winning'] >= 0.92 && o >= 0.9 && s['volume'] >= 0.6 },
  { name: 'Complete Mixed Martial Artist', test: (s) => s['volume'] >= 0.7 && s['wrestling'] >= 0.7 && s['striking-defense'] >= 0.6 && s['takedown-defense'] >= 0.6 },
  { name: 'Knockout Artist', test: (s) => s['power'] >= 0.88 },
  { name: 'Volume Striker', test: (s) => s['volume'] >= 0.85 && s['power'] <= 0.6 },
  { name: 'Sniper', test: (s) => s['accuracy'] >= 0.85 && s['striking-defense'] >= 0.6 },
  { name: 'Smothering Wrestler', test: (s) => s['wrestling'] >= 0.85 && s['grappling'] >= 0.55 },
  { name: 'Submission Specialist', test: (s) => s['grappling'] >= 0.85 },
  { name: 'Counter Striker', test: (s) => s['striking-defense'] >= 0.85 && s['volume'] <= 0.55 },
  { name: 'Sprawl and Brawl', test: (s) => s['takedown-defense'] >= 0.8 && s['volume'] >= 0.6 && s['wrestling'] <= 0.4 },
  { name: 'Iron Chin Brawler', test: (s) => s['durability'] >= 0.8 && s['volume'] >= 0.6 && s['striking-defense'] <= 0.4 },
  { name: 'Grinder', test: (s) => s['wrestling'] >= 0.7 && s['power'] <= 0.4 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = Object.fromEntries(POSITIONS.map((p) => [p, UFC_ARCHETYPES])) as Record<
  SkillPosition,
  Archetype[]
>;

// When no archetype fits: a plain label for where they rank
export function fallbackArchetype(_position: SkillPosition, overall: number): string {
  return overall >= 0.85 ? 'Title Contender' : overall >= 0.6 ? 'Ranked-Level Fighter' : overall >= 0.3 ? 'Gatekeeper' : 'Prospect or Journeyman';
}
