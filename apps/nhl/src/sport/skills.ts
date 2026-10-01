import type { Archetype, SkillDef } from '@ranker/engine/skills';
import { SkillPosition } from '@sport/positions';

// NHL skills and archetypes for the player card (their shapes and the words for them:
// libs/ranker/src/engine/skills.ts)

// Skaters: the same skills at every skater tab (a defenseman's scoring still counts; the archetypes
// below are what differ). Faceoffs only count where there's a column for them (centers).
const SKATER_SKILLS: SkillDef[] = [
  { id: 'scoring', name: 'Goal Scoring', short: 'Scoring', parts: [['goals', 1], ['ixg', 1]] },
  { id: 'finishing', name: 'Finishing', short: 'Finishing', parts: [['shootingPct', 1], ['goalsAboveX', 1]] },
  { id: 'playmaking', name: 'Playmaking', short: 'Playmaking', parts: [['assists', 1], ['ppPoints', 1]] },
  { id: 'shooting', name: 'Shot Volume', short: 'Shooting', parts: [['shots', 1], ['hdShots', 1]] },
  { id: 'possession', name: 'Driving Play', short: 'Possession', parts: [['xgfPct', 1], ['cfPct', 1], ['xgfRel', 1]] },
  { id: 'defense', name: 'Defense', short: 'Defense', parts: [['takeaways', 1], ['blocks', 1], ['giveaways', -1]] },
  { id: 'physical', name: 'Physicality', short: 'Physical', parts: [['hits', 1], ['blocks', 1]] },
  { id: 'value', name: 'Overall Value', short: 'Value', parts: [['gameScore', 1], ['points', 1]] },
];
const CENTER_SKILLS: SkillDef[] = [
  ...SKATER_SKILLS.slice(0, 7),
  { id: 'faceoffs', name: 'Faceoffs', short: 'Faceoffs', parts: [['faceoffPct', 1]] },
  SKATER_SKILLS[7],
];

export const SKILLS: Record<SkillPosition, SkillDef[]> = {
  C: CENTER_SKILLS,
  LW: SKATER_SKILLS,
  RW: SKATER_SKILLS,
  D: SKATER_SKILLS,
  G: [
    { id: 'stopping', name: 'Shot Stopping', short: 'Stopping', parts: [['gsax', 1], ['gsaxPer60', 1]] },
    { id: 'saving', name: 'Save Percentage', short: 'Save %', parts: [['savePct', 1], ['gaa', -1]] },
    { id: 'danger', name: 'Big Saves', short: 'High Danger', parts: [['hdSavePct', 1]] },
    { id: 'workload', name: 'Workload', short: 'Workload', parts: [['saves', 1], ['shutouts', 1]] },
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1]] },
  ],
};

// Volume against efficiency on the card: (counting skill, rate skill)
export const VOLUME_VS_EFFICIENCY: Partial<Record<SkillPosition, [volume: string, efficiency: string]>> = {
  C: ['shooting', 'finishing'],
  LW: ['shooting', 'finishing'],
  RW: ['shooting', 'finishing'],
};

// Results against play (a goalie winning more than his saves say, or the reverse)
export const WINS_VS_PLAY: Partial<Record<SkillPosition, [results: string, play: string]>> = {
  G: ['winning', 'stopping'],
};

// Every skater can be a Hart-level player or a true two-way star
const STAR: Archetype[] = [
  { name: 'Hart Candidate', test: (s) => s['value'] >= 0.95 && s['possession'] >= 0.8 },
  { name: 'Two-Way Star', test: (s) => s['value'] >= 0.8 && s['possession'] >= 0.8 && s['defense'] >= 0.7 },
];
const FORWARD: Archetype[] = [
  ...STAR,
  { name: 'Pure Sniper', test: (s) => s['scoring'] >= 0.88 && s['finishing'] >= 0.7 },
  { name: 'Playmaker', test: (s) => s['playmaking'] >= 0.85 && s['scoring'] <= 0.7 },
  { name: 'Power Forward', test: (s) => s['scoring'] >= 0.7 && s['physical'] >= 0.75 },
  { name: 'Play Driver', test: (s) => s['possession'] >= 0.85 },
  { name: 'Shoot-First Volume Shooter', test: (s) => s['shooting'] >= 0.8 && s['finishing'] <= 0.35 },
  { name: 'Grinder', test: (s) => s['physical'] >= 0.8 && s['scoring'] <= 0.4 },
  { name: 'Defensive Forward', test: (s) => s['defense'] >= 0.8 && s['possession'] >= 0.6 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = {
  C: [
    ...FORWARD.slice(0, 2),
    { name: 'Two-Way Center', test: (s) => s['faceoffs'] >= 0.75 && s['defense'] >= 0.7 && s['playmaking'] >= 0.6 },
    { name: 'Faceoff Specialist', test: (s) => s['faceoffs'] >= 0.9 && s['value'] <= 0.5 },
    ...FORWARD.slice(2),
  ],
  LW: FORWARD,
  RW: FORWARD,
  D: [
    ...STAR,
    { name: 'Offensive Defenseman', test: (s) => s['playmaking'] >= 0.85 && s['shooting'] >= 0.6 },
    { name: 'Shutdown Defenseman', test: (s) => s['possession'] >= 0.75 && s['defense'] >= 0.75 && s['playmaking'] <= 0.6 },
    { name: 'Puck-Moving Defenseman', test: (s) => s['playmaking'] >= 0.7 && s['possession'] >= 0.7 },
    { name: 'Physical Defenseman', test: (s) => s['physical'] >= 0.85 },
    { name: 'Power-Play Quarterback', test: (s) => s['playmaking'] >= 0.8 && s['possession'] <= 0.5 },
  ],
  G: [
    { name: 'Vezina Candidate', test: (s) => s['stopping'] >= 0.92 && s['workload'] >= 0.7 },
    { name: 'Brick Wall', test: (s) => s['stopping'] >= 0.85 },
    { name: 'Workhorse', test: (s) => s['workload'] >= 0.85 && s['stopping'] >= 0.5 },
    { name: 'Highlight-Reel Goalie', test: (s) => s['danger'] >= 0.85 },
    { name: 'Riding the Team', test: (s) => s['winning'] >= 0.75 && s['stopping'] <= 0.35 },
    { name: 'Steady Backup', test: (s, o) => s['workload'] <= 0.35 && s['stopping'] >= 0.55 && o >= 0.4 },
  ],
};

// When no archetype fits: a plain label for where they rank
export function fallbackArchetype(position: SkillPosition, overall: number): string {
  const noun: Record<SkillPosition, string> = { C: 'Center', LW: 'Winger', RW: 'Winger', D: 'Defenseman', G: 'Goalie' };
  const tier = overall >= 0.75 ? 'Top-Line' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Depth' : 'Fringe';
  return position === 'G' ? `${overall >= 0.75 ? 'Starting' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Backup' : 'Fringe'} Goalie` : `${tier} ${noun[position]}`;
}
