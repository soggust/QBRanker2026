import { SkillPosition } from 'app/positions';

// The player card's Overview: related stats rolled up into skills (each a 0-1 percentile in the list,
// the average of its stats' percentiles), an archetype picked from the skill profile, and the words
// for how good a skill is. Counting stats count per game, so missed games don't sink a skill.

// A stat in a skill: +1 when more is better for the skill, -1 when less is
export type SkillPart = [key: string, dir: 1 | -1];

export interface SkillDef {
  id: string;
  name: string;
  // Radar label
  short: string;
  parts: SkillPart[];
}

// Every position has the same skills (a center's playmaking and a point guard's rebounding still
// count; the archetypes below are what differ)
const NBA_SKILLS: SkillDef[] = [
  { id: 'scoring', name: 'Scoring', short: 'Scoring', parts: [['points', 1], ['usgPct', 1]] },
  { id: 'efficiency', name: 'Efficiency', short: 'Efficiency', parts: [['tsPct', 1], ['fgPct', 1], ['per', 1]] },
  { id: 'shooting', name: 'Shooting', short: 'Shooting', parts: [['threes', 1], ['fg3Pct', 1], ['ftPct', 1]] },
  { id: 'playmaking', name: 'Playmaking', short: 'Playmaking', parts: [['assists', 1], ['astPct', 1], ['tovPct', -1]] },
  { id: 'rebounding', name: 'Rebounding', short: 'Rebounding', parts: [['rebounds', 1], ['trbPct', 1]] },
  { id: 'defense', name: 'Defense', short: 'Defense', parts: [['dbpm', 1], ['stlPct', 1], ['blkPct', 1]] },
  { id: 'impact', name: 'Impact', short: 'Impact', parts: [['bpm', 1], ['onOff', 1], ['ws48', 1]] },
  { id: 'value', name: 'Overall Value', short: 'Value', parts: [['ws', 1], ['vorp', 1]] },
];

export const SKILLS: Record<SkillPosition, SkillDef[]> = {
  PG: NBA_SKILLS,
  SG: NBA_SKILLS,
  SF: NBA_SKILLS,
  PF: NBA_SKILLS,
  C: NBA_SKILLS,
  HC: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1]] },
    { id: 'playoffs', name: 'Playoff Success', short: 'Playoffs', parts: [['playoffWins', 1]] },
    { id: 'offense', name: 'Offense', short: 'Offense', parts: [['offRank', -1]] },
    { id: 'defense', name: 'Defense', short: 'Defense', parts: [['defRank', -1]] },
    { id: 'lift', name: 'Coaching Lift', short: 'Lift', parts: [['lift', 1]] },
    { id: 'close', name: 'Close Games', short: 'Close Games', parts: [['pythDiff', 1]] },
  ],
};

// The counting and rate skills whose split reads as "empty stats" or "earning more minutes"
export const VOLUME_VS_EFFICIENCY: Partial<Record<SkillPosition, [volume: string, efficiency: string]>> = {
  PG: ['scoring', 'efficiency'],
  SG: ['scoring', 'efficiency'],
  SF: ['scoring', 'efficiency'],
  PF: ['scoring', 'efficiency'],
  C: ['scoring', 'efficiency'],
};

// (no NBA position has a results skill to set against the play)
export const WINS_VS_PLAY: Partial<Record<SkillPosition, [results: string, play: string]>> = {};

// Archetypes, most specific first: the first whose test passes names the card (s: skill id ->
// percentile, 0.5 when a skill has no data; overall: the list rank as a percentile)
export interface Archetype {
  name: string;
  test: (s: Record<string, number>, overall: number) => boolean;
}

// Every position can be an MVP-level player or a two-way star
const STAR: Archetype[] = [
  { name: 'MVP Candidate', test: (s) => s['value'] >= 0.95 && s['impact'] >= 0.9 },
  { name: 'Two-Way Star', test: (s) => s['impact'] >= 0.8 && s['defense'] >= 0.8 && s['scoring'] >= 0.7 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = {
  PG: [
    ...STAR,
    { name: 'Floor General', test: (s) => s['playmaking'] >= 0.85 && s['scoring'] <= 0.7 },
    { name: 'Scoring Point Guard', test: (s) => s['scoring'] >= 0.8 && s['playmaking'] >= 0.6 },
    { name: 'Sharpshooter', test: (s) => s['shooting'] >= 0.85 },
    { name: 'Pest on Defense', test: (s) => s['defense'] >= 0.85 },
    { name: 'Volume Scorer', test: (s) => s['scoring'] >= 0.8 && s['efficiency'] <= 0.4 },
    { name: 'Game Manager', test: (s) => s['playmaking'] >= 0.7 && s['efficiency'] >= 0.5 },
  ],
  SG: [
    ...STAR,
    { name: 'Primary Scorer', test: (s) => s['scoring'] >= 0.88 },
    { name: 'Movement Shooter', test: (s) => s['shooting'] >= 0.85 && s['scoring'] <= 0.75 },
    { name: '3-and-D Wing', test: (s) => s['shooting'] >= 0.65 && s['defense'] >= 0.7 },
    { name: 'Combo Guard', test: (s) => s['playmaking'] >= 0.7 && s['scoring'] >= 0.6 },
    { name: 'Lockdown Defender', test: (s) => s['defense'] >= 0.85 },
    { name: 'Microwave Scorer', test: (s) => s['scoring'] >= 0.7 && s['efficiency'] <= 0.4 },
  ],
  SF: [
    ...STAR,
    { name: 'Point Forward', test: (s) => s['playmaking'] >= 0.8 && s['rebounding'] >= 0.6 },
    { name: 'Go-To Scorer', test: (s) => s['scoring'] >= 0.88 },
    { name: '3-and-D Wing', test: (s) => s['shooting'] >= 0.65 && s['defense'] >= 0.7 },
    { name: 'Stopper', test: (s) => s['defense'] >= 0.85 },
    { name: 'Floor Spacer', test: (s) => s['shooting'] >= 0.85 },
    { name: 'Glue Guy', test: (s) => s['impact'] >= 0.7 && s['scoring'] <= 0.5 },
  ],
  PF: [
    ...STAR,
    { name: 'Stretch Four', test: (s) => s['shooting'] >= 0.8 && s['rebounding'] >= 0.4 },
    { name: 'Point Forward', test: (s) => s['playmaking'] >= 0.8 },
    { name: 'Interior Scorer', test: (s) => s['scoring'] >= 0.8 && s['efficiency'] >= 0.6 },
    { name: 'Glass Cleaner', test: (s) => s['rebounding'] >= 0.88 },
    { name: 'Defensive Anchor', test: (s) => s['defense'] >= 0.85 },
    { name: 'Energy Big', test: (s) => s['rebounding'] >= 0.7 && s['defense'] >= 0.6 && s['scoring'] <= 0.4 },
  ],
  HC: [
    { name: 'Coach of the Year Type', test: (s) => s['lift'] >= 0.9 && s['winning'] >= 0.7 },
    { name: 'Title Contender', test: (s) => s['playoffs'] >= 0.9 && s['winning'] >= 0.8 },
    { name: 'Defensive Architect', test: (s) => s['defense'] >= 0.85 && s['offense'] <= 0.6 },
    { name: 'Offensive Innovator', test: (s) => s['offense'] >= 0.85 && s['defense'] <= 0.6 },
    { name: 'Overachiever', test: (s) => s['lift'] >= 0.8 },
    { name: 'Close-Game Closer', test: (s) => s['close'] >= 0.88 },
    { name: 'Talent Underachiever', test: (s) => s['lift'] <= 0.15 && s['winning'] >= 0.4 },
    { name: 'Rebuilding Job', test: (s) => s['winning'] <= 0.25 && s['lift'] >= 0.5 },
  ],
  C: [
    ...STAR,
    { name: 'Playmaking Hub', test: (s) => s['playmaking'] >= 0.85 },
    { name: 'Rim Protector', test: (s) => s['defense'] >= 0.85 && s['rebounding'] >= 0.6 },
    { name: 'Stretch Five', test: (s) => s['shooting'] >= 0.8 },
    { name: 'Post Scorer', test: (s) => s['scoring'] >= 0.8 },
    { name: 'Rebounding Machine', test: (s) => s['rebounding'] >= 0.88 },
    { name: 'Rim Runner', test: (s) => s['efficiency'] >= 0.8 && s['scoring'] <= 0.5 },
  ],
};

// When no archetype fits: a plain label for where they rank
export function fallbackArchetype(position: SkillPosition, overall: number): string {
  const noun: Record<SkillPosition, string> = {
    PG: 'Point Guard',
    SG: 'Shooting Guard',
    SF: 'Small Forward',
    PF: 'Power Forward',
    C: 'Center',
    HC: 'Head Coach',
  };
  const tier = overall >= 0.75 ? 'High-End' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Middling' : 'Struggling';
  return `${tier} ${noun[position]}`;
}

// How good a skill is, in words
export function tierWord(pct: number): string {
  if (pct >= 0.9) return 'Elite';
  if (pct >= 0.75) return 'Strong';
  if (pct >= 0.6) return 'Above-average';
  if (pct > 0.4) return 'Average';
  if (pct > 0.25) return 'Below-average';
  if (pct > 0.1) return 'Poor';
  return 'Bottom-tier';
}

// "Top 8%" / "Bottom 15%" / "Middle of the pack"
export function standing(pct: number): string {
  if (pct >= 0.5) {
    const top = Math.max(1, Math.round((1 - pct) * 100));
    return top >= 45 ? 'Middle of the pack' : `Top ${top}%`;
  }
  return `Bottom ${Math.max(1, Math.round(pct * 100))}%`;
}
