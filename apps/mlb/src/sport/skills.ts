import { leagueRank, type Archetype, type SkillDef } from '@ranker/engine/skills';
import { SkillPosition } from '@sport/positions';

// MLB skills and archetypes for the player card (their shapes and the words for them:
// libs/ranker/src/engine/skills.ts)

// Hitters (every position tab; a DH has no defense)
const HITTER_SKILLS: SkillDef[] = [
  { id: 'contact', name: 'Contact', short: 'Contact', parts: [['avg', 1], ['kPct', -1]] },
  { id: 'power', name: 'Power', short: 'Power', parts: [['homeRuns', 1], ['slg', 1], ['barrelPct', 1], ['hardHitPct', 1]] },
  { id: 'discipline', name: 'Plate Discipline', short: 'Discipline', parts: [['bbPct', 1], ['kPct', -1], ['obp', 1]] },
  { id: 'hitting', name: 'Hitting', short: 'Hitting', parts: [['wrcPlus', 1], ['xwoba', 1]] },
  { id: 'production', name: 'Run Production', short: 'Production', parts: [['rbi', 1], ['runs', 1]] },
  { id: 'speed', name: 'Speed', short: 'Speed', parts: [['stolenBases', 1], ['sprintSpeed', 1], ['bsr', 1]] },
  { id: 'defense', name: 'Defense', short: 'Defense', parts: [['defRuns', 1], ['oaa', 1], ['fieldingPct', 1], ['rangeFactor', 1]] },
  { id: 'value', name: 'Overall Value', short: 'Value', parts: [['war', 1]] },
];

export const SKILLS: Record<SkillPosition, SkillDef[]> = {
  TM: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['playoffWins', 1]] },
    { id: 'margin', name: 'Run Margin', short: 'Margin', parts: [['runDiff', 1]] },
    { id: 'offense', name: 'Offense', short: 'Offense', parts: [['offRank', -1], ['ops', 1]] },
    { id: 'prevention', name: 'Run Prevention', short: 'Prevention', parts: [['defRank', -1], ['era', -1]] },
    { id: 'fielding', name: 'Fielding', short: 'Fielding', parts: [['fieldingRuns', 1]] },
    { id: 'roster', name: 'Roster', short: 'Roster', parts: [['hitters', 1], ['rotation', 1], ['bullpen', 1]] },
    { id: 'close', name: 'Close Games', short: 'Close Games', parts: [['pythDiff', 1]] },
  ],
  C: HITTER_SKILLS,
  '1B': HITTER_SKILLS,
  '2B': HITTER_SKILLS,
  '3B': HITTER_SKILLS,
  SS: HITTER_SKILLS,
  OF: HITTER_SKILLS,
  DH: HITTER_SKILLS.filter((s) => s.id !== 'defense'),
  SP: [
    { id: 'strikeouts', name: 'Missing Bats', short: 'Strikeouts', parts: [['kPct', 1], ['whiffPct', 1], ['strikeOuts', 1]] },
    { id: 'control', name: 'Control', short: 'Control', parts: [['bbPct', -1], ['whip', -1]] },
    { id: 'runPrevention', name: 'Run Prevention', short: 'Runs', parts: [['era', -1], ['fip', -1], ['xera', -1]] },
    { id: 'contact', name: 'Limiting Damage', short: 'Contact', parts: [['hr9', -1], ['hardHitAllowed', -1], ['barrelAllowed', -1]] },
    { id: 'durability', name: 'Durability', short: 'Innings', parts: [['ip', 1]] },
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1]] },
    { id: 'value', name: 'Overall Value', short: 'Value', parts: [['war', 1]] },
  ],
  RP: [
    { id: 'strikeouts', name: 'Missing Bats', short: 'Strikeouts', parts: [['kPct', 1], ['whiffPct', 1], ['strikeOuts', 1]] },
    { id: 'control', name: 'Control', short: 'Control', parts: [['bbPct', -1], ['whip', -1]] },
    { id: 'runPrevention', name: 'Run Prevention', short: 'Runs', parts: [['era', -1], ['fip', -1], ['xfip', -1]] },
    { id: 'contact', name: 'Limiting Damage', short: 'Contact', parts: [['xwobaAllowed', -1], ['hardHitAllowed', -1]] },
    { id: 'leverage', name: 'High-Leverage Role', short: 'Leverage', parts: [['saves', 1], ['holds', 1]] },
    { id: 'value', name: 'Overall Value', short: 'Value', parts: [['war', 1], ['ip', 1]] },
  ],
};

// The counting and rate skills whose split reads as "compiler" or "earning more playing time"
export const VOLUME_VS_EFFICIENCY: Partial<Record<SkillPosition, [volume: string, efficiency: string]>> = {
  C: ['production', 'hitting'],
  '1B': ['production', 'hitting'],
  '2B': ['production', 'hitting'],
  '3B': ['production', 'hitting'],
  SS: ['production', 'hitting'],
  OF: ['production', 'hitting'],
  DH: ['production', 'hitting'],
};

// The results skill and the pitching skill whose split reads as "winning more than the pitching
// says" (run support) or the reverse
export const WINS_VS_PLAY: Partial<Record<SkillPosition, [results: string, play: string]>> = {
  SP: ['winning', 'runPrevention'],
};

// (the league's top 8 by WAR: an MVP race or a Cy Young race is a handful of players, not a few per
// position)
const HITTERS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
const warRank = (player: Parameters<Archetype['test']>[2], tabs: string[]) => leagueRank(player, tabs, (row) => row.stats['war'], 'war');

const HITTER_ARCHETYPES: Archetype[] = [
  { name: 'MVP Candidate', test: (s, _, p) => s['hitting'] >= 0.8 && warRank(p, HITTERS) <= 8 },
  { name: 'Five-Tool Star', test: (s) => s['power'] >= 0.7 && s['contact'] >= 0.65 && s['speed'] >= 0.7 && s['defense'] >= 0.65 },
  { name: 'Three True Outcomes', test: (s) => s['power'] >= 0.75 && s['discipline'] >= 0.55 && s['contact'] <= 0.3 },
  { name: 'Slugger', test: (s) => s['power'] >= 0.85 },
  { name: 'Table Setter', test: (s) => s['discipline'] >= 0.75 && s['speed'] >= 0.6 && s['power'] <= 0.55 },
  { name: 'Speed Demon', test: (s) => s['speed'] >= 0.88 },
  { name: 'Contact Specialist', test: (s) => s['contact'] >= 0.82 && s['power'] <= 0.5 },
  { name: 'Defensive Wizard', test: (s) => s['defense'] >= 0.85 && s['hitting'] <= 0.55 },
  { name: 'Professional Hitter', test: (s) => s['hitting'] >= 0.8 },
  { name: 'Run Producer', test: (s) => s['production'] >= 0.8 },
  { name: 'Glove-First Regular', test: (s) => s['defense'] >= 0.75 && s['hitting'] <= 0.4 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = {
  TM: [
    // (the top few: the title race)
    { name: 'World Series Favorite', test: (s, o) => o >= 0.9 && s['winning'] >= 0.75 },
    { name: 'Juggernaut', test: (s) => s['margin'] >= 0.9 && s['winning'] >= 0.85 },
    { name: 'Slugging Machine', test: (s) => s['offense'] >= 0.88 && s['prevention'] <= 0.6 },
    { name: 'Pitching and Defense', test: (s) => s['prevention'] >= 0.88 && s['offense'] <= 0.6 },
    { name: 'Glove Team', test: (s) => s['fielding'] >= 0.9 },
    { name: 'Winning Ugly', test: (s) => s['close'] >= 0.85 && s['margin'] <= 0.6 },
    { name: 'Better Than the Record', test: (s) => s['close'] <= 0.15 && s['margin'] >= 0.5 },
    { name: 'Talent Without Results', test: (s) => s['roster'] >= 0.75 && s['winning'] <= 0.4 },
    // (the bottom with little to build on; the rest of the bottom quarter: the fallback's Retooling or Lottery Team)
    { name: 'Full Rebuild', test: (s) => s['winning'] <= 0.2 && s['roster'] <= 0.3 },
    // (a losing team's glaring hole)
    { name: 'Pitching Woes', test: (s) => s['prevention'] <= 0.15 && s['winning'] <= 0.45 },
    { name: 'Punchless Lineup', test: (s) => s['offense'] <= 0.15 && s['winning'] <= 0.45 },
  ],
  C: HITTER_ARCHETYPES,
  '1B': HITTER_ARCHETYPES,
  '2B': HITTER_ARCHETYPES,
  '3B': HITTER_ARCHETYPES,
  SS: HITTER_ARCHETYPES,
  OF: HITTER_ARCHETYPES,
  DH: HITTER_ARCHETYPES.filter((a) => !/Defensive|Glove|Five-Tool/.test(a.name)),
  SP: [
    { name: 'Ace', test: (s, _, p) => s['runPrevention'] >= 0.8 && warRank(p, ['SP']) <= 8 },
    { name: 'Power Pitcher', test: (s) => s['strikeouts'] >= 0.85 },
    { name: 'Workhorse', test: (s) => s['durability'] >= 0.85 && s['runPrevention'] >= 0.45 },
    { name: 'Control Artist', test: (s) => s['control'] >= 0.85 && s['strikeouts'] <= 0.55 },
    { name: 'Contact Manager', test: (s) => s['contact'] >= 0.8 && s['strikeouts'] <= 0.5 },
    { name: 'Wild Thing', test: (s) => s['control'] <= 0.15 && s['strikeouts'] >= 0.55 },
    { name: 'Innings Eater', test: (s) => s['durability'] >= 0.8 },
  ],
  RP: [
    { name: 'Lockdown Closer', test: (s) => s['leverage'] >= 0.85 && s['runPrevention'] >= 0.7 },
    { name: 'Setup Ace', test: (s) => s['leverage'] >= 0.7 && s['runPrevention'] >= 0.75 },
    { name: 'Strikeout Artist', test: (s) => s['strikeouts'] >= 0.85 },
    { name: 'High-Wire Act', test: (s) => s['control'] <= 0.2 && s['strikeouts'] >= 0.6 },
    { name: 'Bullpen Stopper', test: (s) => s['runPrevention'] >= 0.85 },
    { name: 'Middle Reliever', test: (s) => s['leverage'] <= 0.35 && s['value'] >= 0.5 },
  ],
};

// When no archetype fits: a plain label for where they rank
export function fallbackArchetype(position: SkillPosition, overall: number, _player?: unknown): string {
  if (position === 'TM') return overall >= 0.75 ? 'Contender' : overall >= 0.45 ? 'Playoff Team' : overall >= 0.25 ? 'Bubble Team' : 'Retooling';
  const noun: Record<SkillPosition, string> = {
    TM: 'Team',
    C: 'Catcher',
    '1B': 'First Baseman',
    '2B': 'Second Baseman',
    '3B': 'Third Baseman',
    SS: 'Shortstop',
    OF: 'Outfielder',
    DH: 'Hitter',
    SP: 'Starter',
    RP: 'Reliever',
  };
  const tier = overall >= 0.75 ? 'High-End' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Middling' : 'Struggling';
  return `${tier} ${noun[position]}`;
}
