import type { Archetype, SkillDef, SkillDerivedStats, SkillMinimums } from '@ranker/engine/skills';
import { SkillPlayer, SkillPosition } from '@sport/positions';

// NBA skills and archetypes for the player card (their shapes and the words for them:
// libs/ranker/src/engine/skills.ts)

// Every position has the same skills (a center's playmaking and a point guard's rebounding still
// count; the archetypes below are what differ)
const NBA_SKILLS: SkillDef[] = [
  { id: 'scoring', name: 'Scoring', short: 'Scoring', parts: [['points', 1], ['usgPct', 1]] },
  { id: 'efficiency', name: 'Efficiency', short: 'Efficiency', parts: [['tsPct', 1, 3], ['per', 1]] },
  { id: 'shooting', name: 'Shooting', short: 'Shooting', parts: [['threes', 1], ['fg3Pct', 1], ['ftPct', 1, 0.5]] },
  { id: 'playmaking', name: 'Playmaking', short: 'Playmaking', parts: [['assists', 1, 2], ['astPct', 1, 2], ['tovPct', -1]] },
  { id: 'rebounding', name: 'Rebounding', short: 'Rebounding', parts: [['rebounds', 1], ['trbPct', 1]] },
  // (Defensive Win Shares a game beside DBPM, so a rim protector's stops count, not just his steals and
  // blocks)
  { id: 'defense', name: 'Defense', short: 'Defense', parts: [['dbpm', 1, 2], ['dwsGame', 1], ['stlPct', 1], ['blkPct', 1]] },
  { id: 'impact', name: 'Impact', short: 'Impact', parts: [['bpm', 1, 2], ['onOff', 1], ['ws48', 1, 2]] },
  { id: 'value', name: 'Overall Value', short: 'Value', parts: [['ws', 1], ['vorp', 1]] },
];

export const SKILLS: Record<SkillPosition, SkillDef[]> = {
  TM: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['playoffWins', 1]] },
    { id: 'margin', name: 'Point Margin', short: 'Margin', parts: [['netRtg', 1]] },
    { id: 'offense', name: 'Offense', short: 'Offense', parts: [['offRank', -1]] },
    { id: 'defense', name: 'Defense', short: 'Defense', parts: [['defRank', -1]] },
    { id: 'roster', name: 'Roster', short: 'Roster', parts: [['backcourt', 1], ['wings', 1], ['frontcourt', 1]] },
    { id: 'close', name: 'Close Games', short: 'Close Games', parts: [['pythDiff', 1]] },
  ],
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

// The shooting percentages count toward a skill only with the attempts a game behind them (skills.ts
// SkillMinimum): 3P % 1.5 a game, FT % 1 (the data's own floor, 25 and 20 a season, lets a 2-for-4 bench
// shooter through on a few games). The attempts: the row's fg3a and fta where the data has them, else
// worked out from what it has: 3-point attempts from makes and 3P %, free throws from points, makes,
// FG % and TS % (TS % = PTS / 2(FGA + 0.44 FTA), and PTS = 2 FG + 3PM + FT; within a few attempts)
const stat = (p: SkillPlayer, key: string): number | null => (p.stats as Record<string, number | null | undefined>)[key] ?? null;
export function threeAttempts(p: SkillPlayer): number | null {
  const own = stat(p, 'fg3a');
  if (own !== null) return own;
  const made = stat(p, 'threes');
  const pct = stat(p, 'fg3Pct');
  return made !== null && pct ? made / (pct / 100) : null;
}
export function freeThrowAttempts(p: SkillPlayer): number | null {
  const own = stat(p, 'fta');
  if (own !== null) return own;
  const [points, threes, fg, ft, ts] = ['points', 'threes', 'fgPct', 'ftPct', 'tsPct'].map((k) => stat(p, k));
  if (points === null || fg === null || ft === null || !ts) return null;
  const f = fg / 100;
  const shots = points / (2 * (ts / 100));
  // (a big who makes most of his shots and few free throws: too close to call, he counts as usual)
  const per = ft / 100 - 0.88 * f;
  if (per < 0.1) return null;
  const fta = (points - (threes ?? 0) - 2 * f * shots) / per;
  return Number.isFinite(fta) && fta >= 0 ? fta : null;
}
const SHOOTING_MINIMUMS: SkillMinimums = {
  fg3Pct: { perGame: 1.5, noun: 'attempts', attempts: threeAttempts },
  ftPct: { perGame: 1, noun: 'attempts', attempts: freeThrowAttempts },
};
export const SKILL_MINIMUMS: Partial<Record<SkillPosition, SkillMinimums>> = {
  PG: SHOOTING_MINIMUMS,
  SG: SHOOTING_MINIMUMS,
  SF: SHOOTING_MINIMUMS,
  PF: SHOOTING_MINIMUMS,
  C: SHOOTING_MINIMUMS,
};

// (a skill's stats that aren't columns: Defensive Win Shares, a season's, read a game)
export const SKILL_DERIVED: SkillDerivedStats = {
  dwsGame: { key: 'dwsGame', label: 'DWS', kind: 'volume', value: (p) => stat(p, 'dws') },
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

// Every position can be an MVP-level player or a two-way star
const STAR: Archetype[] = [
  { name: 'MVP Candidate', test: (s) => s['value'] >= 0.95 && s['impact'] >= 0.9 },
  { name: 'Two-Way Star', test: (s) => s['impact'] >= 0.8 && s['defense'] >= 0.8 && s['scoring'] >= 0.7 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = {
  TM: [
    { name: 'Title Favorite', test: (s) => s['margin'] >= 0.9 && s['winning'] >= 0.85 },
    { name: 'Juggernaut', test: (s) => s['offense'] >= 0.8 && s['defense'] >= 0.8 },
    { name: 'Offensive Powerhouse', test: (s) => s['offense'] >= 0.88 && s['defense'] <= 0.6 },
    { name: 'Defensive Wall', test: (s) => s['defense'] >= 0.88 && s['offense'] <= 0.6 },
    { name: 'Winning Ugly', test: (s) => s['close'] >= 0.85 && s['margin'] <= 0.6 },
    { name: 'Better Than the Record', test: (s) => s['close'] <= 0.15 && s['margin'] >= 0.5 },
    { name: 'Talent Without Results', test: (s) => s['roster'] >= 0.75 && s['winning'] <= 0.4 },
    // (the bottom with little to build on; the rest of the bottom quarter: the fallback's Retooling or Lottery Team)
    { name: 'Full Rebuild', test: (s) => s['winning'] <= 0.2 && s['roster'] <= 0.3 },
    // (a losing team's glaring hole)
    { name: 'No Defense', test: (s) => s['defense'] <= 0.15 && s['winning'] <= 0.45 },
    { name: "Can't Score", test: (s) => s['offense'] <= 0.15 && s['winning'] <= 0.45 },
  ],
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
export function fallbackArchetype(position: SkillPosition, overall: number, _player?: unknown): string {
  if (position === 'TM') return overall >= 0.75 ? 'Contender' : overall >= 0.45 ? 'Playoff Team' : overall >= 0.25 ? 'Bubble Team' : 'Lottery Team';
  const noun: Record<SkillPosition, string> = {
    TM: 'Team',
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
