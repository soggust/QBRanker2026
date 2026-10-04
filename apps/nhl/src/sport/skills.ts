import { leagueRank, type Archetype, type SkillDef } from '@ranker/engine/skills';
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
  TM: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['playoffWins', 1]] },
    { id: 'margin', name: 'Goal Margin', short: 'Margin', parts: [['goalDiff', 1]] },
    { id: 'play', name: 'Driving Play', short: 'Play', parts: [['xgfPct', 1], ['cfPct', 1]] },
    { id: 'special', name: 'Special Teams', short: 'Special Teams', parts: [['ppPct', 1], ['pkPct', 1]] },
    { id: 'goalies', name: 'Goaltending', short: 'Goalies', parts: [['gsaxTeam', 1], ['goaltending', 1]] },
    { id: 'roster', name: 'Roster', short: 'Roster', parts: [['forwards', 1], ['blueline', 1], ['goaltending', 1]] },
    { id: 'close', name: 'Close Games', short: 'Close Games', parts: [['ptsOver', 1]] },
  ],
  HC: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1]] },
    { id: 'playoffs', name: 'Playoff Success', short: 'Playoffs', parts: [['playoffWins', 1]] },
    { id: 'offense', name: 'Offense', short: 'Offense', parts: [['offRank', -1]] },
    { id: 'defense', name: 'Defense', short: 'Defense', parts: [['defRank', -1]] },
    { id: 'lift', name: 'Coaching Lift', short: 'Lift', parts: [['lift', 1]] },
    { id: 'close', name: 'Close Games', short: 'Close Games', parts: [['ptsOver', 1]] },
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
  // (and among the league's top 10 scorers: a few per position would be too many)
  { name: 'Hart Candidate', test: (s, _, p) => s['value'] >= 0.95 && s['possession'] >= 0.8 && leagueRank(p, ['C', 'LW', 'RW', 'D'], (row) => row.stats['points'], 'points') <= 10 },
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
  TM: [
    { name: 'Cup Favorite', test: (s) => s['margin'] >= 0.9 && s['play'] >= 0.8 },
    { name: 'Possession Machine', test: (s) => s['play'] >= 0.88 },
    { name: 'Hot Goalie Team', test: (s) => s['goalies'] >= 0.88 && s['play'] <= 0.5 },
    { name: 'Special Teams Threat', test: (s) => s['special'] >= 0.88 },
    { name: 'Winning Ugly', test: (s) => s['close'] >= 0.85 && s['margin'] <= 0.6 },
    { name: 'Better Than the Record', test: (s) => s['close'] <= 0.15 && s['play'] >= 0.6 },
    { name: 'Talent Without Results', test: (s) => s['roster'] >= 0.75 && s['winning'] <= 0.4 },
    // (the bottom with little to build on; the rest of the bottom quarter: the fallback's Retooling or Lottery Team)
    { name: 'Full Rebuild', test: (s) => s['winning'] <= 0.2 && s['roster'] <= 0.3 },
    // (a losing team's glaring hole)
    { name: 'Leaky in Net', test: (s) => s['goalies'] <= 0.15 && s['winning'] <= 0.45 },
    { name: 'Outshot Nightly', test: (s) => s['play'] <= 0.15 && s['winning'] <= 0.45 },
  ],
  HC: [
    { name: 'Jack Adams Type', test: (s) => s['lift'] >= 0.9 && s['winning'] >= 0.7 },
    { name: 'Cup Contender', test: (s) => s['playoffs'] >= 0.9 && s['winning'] >= 0.8 },
    { name: 'Defensive Architect', test: (s) => s['defense'] >= 0.85 && s['offense'] <= 0.6 },
    { name: 'Run-and-Gun', test: (s) => s['offense'] >= 0.85 && s['defense'] <= 0.6 },
    { name: 'Overachiever', test: (s) => s['lift'] >= 0.8 },
    { name: 'Close-Game Closer', test: (s) => s['close'] >= 0.88 },
    { name: 'Talent Underachiever', test: (s) => s['lift'] <= 0.15 && s['winning'] >= 0.4 },
    { name: 'Rebuilding Job', test: (s) => s['winning'] <= 0.25 && s['lift'] >= 0.5 },
  ],
};

// When no archetype fits: a plain label for where they rank
export function fallbackArchetype(position: SkillPosition, overall: number, _player?: unknown): string {
  if (position === 'TM') return overall >= 0.75 ? 'Contender' : overall >= 0.45 ? 'Playoff Team' : overall >= 0.25 ? 'Bubble Team' : 'Lottery Team';
  const noun: Record<SkillPosition, string> = { TM: 'Team', C: 'Center', LW: 'Winger', RW: 'Winger', D: 'Defenseman', G: 'Goalie', HC: 'Head Coach' };
  if (position === 'HC') return `${overall >= 0.75 ? 'High-End' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Middling' : 'Struggling'} Head Coach`;
  const tier = overall >= 0.75 ? 'Top-Line' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Depth' : 'Fringe';
  return position === 'G' ? `${overall >= 0.75 ? 'Starting' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Backup' : 'Fringe'} Goalie` : `${tier} ${noun[position]}`;
}
