import type { Archetype, SkillDef } from '@ranker/engine/skills';
import { SkillPosition } from '@sport/positions';

// NFL skills and archetypes for the player card (their shapes and the words for them:
// libs/ranker/src/engine/skills.ts)

export const SKILLS: Record<SkillPosition, SkillDef[]> = {
  QB: [
    { id: 'accuracy', name: 'Accuracy', short: 'Accuracy', parts: [['compPct', 1], ['cpoe', 1], ['badThrowPct', -1]] },
    { id: 'efficiency', name: 'Efficiency', short: 'Efficiency', parts: [['epaPerPlay', 1], ['successRate', 1], ['ypa', 1], ['rating', 1]] },
    { id: 'downfield', name: 'Pushing the Ball', short: 'Downfield', parts: [['adot', 1], ['aggressiveness', 1], ['ypa', 1]] },
    { id: 'security', name: 'Ball Security', short: 'Security', parts: [['ints', -1], ['fumbles', -1]] },
    { id: 'pocket', name: 'Pocket Presence', short: 'Pocket', parts: [['pressureToSack', -1], ['timeToThrow', -1]] },
    { id: 'legs', name: 'Running Threat', short: 'Legs', parts: [['rushYards', 1], ['rushTds', 1]] },
    { id: 'production', name: 'Production', short: 'Production', parts: [['passYards', 1], ['passTds', 1]] },
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['recent', 1]] },
  ],
  RB: [
    { id: 'efficiency', name: 'Rushing Efficiency', short: 'Efficiency', parts: [['ypc', 1], ['epaPerCarry', 1], ['ryoePerAtt', 1]] },
    { id: 'power', name: 'Breaking Tackles', short: 'Power', parts: [['yacoPerCarry', 1], ['brokenTackles', 1]] },
    { id: 'workload', name: 'Workload', short: 'Workload', parts: [['carries', 1], ['snapShare', 1], ['rushYards', 1]] },
    { id: 'receiving', name: 'Receiving', short: 'Receiving', parts: [['receptions', 1], ['recYards', 1], ['targets', 1], ['epaPerTarget', 1]] },
    { id: 'scoring', name: 'Scoring & Chains', short: 'Scoring', parts: [['rushTds', 1], ['recTds', 1], ['firstDowns', 1]] },
    { id: 'security', name: 'Ball Security', short: 'Security', parts: [['fumbles', -1], ['drops', -1]] },
  ],
  WR: [
    { id: 'role', name: 'Target Share', short: 'Role', parts: [['targets', 1], ['targetShare', 1], ['airYardsShare', 1]] },
    { id: 'production', name: 'Production', short: 'Production', parts: [['recYards', 1], ['receptions', 1]] },
    { id: 'scoring', name: 'Scoring', short: 'Scoring', parts: [['recTds', 1], ['rushTds', 1]] },
    { id: 'efficiency', name: 'Efficiency', short: 'Efficiency', parts: [['epaPerTarget', 1], ['catchPct', 1]] },
    { id: 'separation', name: 'Getting Open', short: 'Separation', parts: [['separation', 1]] },
    { id: 'deep', name: 'Deep Threat', short: 'Deep', parts: [['adot', 1], ['airYardsShare', 1]] },
    { id: 'yac', name: 'After the Catch', short: 'YAC', parts: [['yac', 1], ['yacOverExp', 1]] },
    { id: 'hands', name: 'Hands', short: 'Hands', parts: [['dropPct', -1], ['drops', -1], ['fumbles', -1]] },
  ],
  TE: [],
  K: [
    { id: 'accuracy', name: 'Accuracy', short: 'Accuracy', parts: [['fgPct', 1], ['fgOverExp', 1], ['patPct', 1]] },
    { id: 'range', name: 'Range', short: 'Range', parts: [['fg50', 1], ['fgLong', 1]] },
    { id: 'value', name: 'Points Added', short: 'Value', parts: [['epaPerKick', 1]] },
    { id: 'volume', name: 'Volume', short: 'Volume', parts: [['fgMade', 1]] },
  ],
  P: [
    { id: 'distance', name: 'Leg', short: 'Distance', parts: [['grossAvg', 1], ['netAvg', 1]] },
    { id: 'placement', name: 'Placement', short: 'Placement', parts: [['inside20Pct', 1], ['inside20', 1], ['touchbacks', -1]] },
    { id: 'hang', name: 'Hang Time', short: 'Hang', parts: [['fairCatchPct', 1], ['netAvg', 1]] },
    { id: 'value', name: 'Field Flipping', short: 'Value', parts: [['epaPerPunt', 1]] },
  ],
  DEF: [
    { id: 'overall', name: 'Down-to-Down Defense', short: 'Overall', parts: [['epaAllowed', -1], ['successAllowed', -1]] },
    { id: 'pass', name: 'Pass Defense', short: 'Pass D', parts: [['passEpaAllowed', -1]] },
    { id: 'run', name: 'Run Defense', short: 'Run D', parts: [['rushEpaAllowed', -1]] },
    { id: 'rush', name: 'Pass Rush', short: 'Pass Rush', parts: [['sacks', 1], ['pressureRate', 1]] },
    { id: 'takeaways', name: 'Takeaways', short: 'Takeaways', parts: [['takeaways', 1]] },
    { id: 'scoring', name: 'Keeping Points Off', short: 'Scoring D', parts: [['ptsAllowedPerGame', -1], ['redZoneTdPct', -1]] },
    { id: 'thirdDown', name: 'Getting Off the Field', short: '3rd Down', parts: [['thirdDownPct', -1]] },
    { id: 'tackling', name: 'Tackling', short: 'Tackling', parts: [['missedTacklePct', -1]] },
  ],
  OL: [
    { id: 'pass', name: 'Pass Protection', short: 'Pass Pro', parts: [['sacksAllowed', -1], ['qbHitsAllowed', -1], ['pressureRate', -1], ['sackRate', -1]] },
    { id: 'run', name: 'Run Blocking', short: 'Run Block', parts: [['ypc', 1], ['runEpa', 1], ['runSuccess', 1], ['yardsBeforeContact', 1]] },
    { id: 'push', name: 'Winning at the Line', short: 'Push', parts: [['stuffRate', -1], ['yardsBeforeContact', 1]] },
    { id: 'shortYardage', name: 'Short Yardage', short: 'Short Yd', parts: [['shortYardagePct', 1]] },
    { id: 'discipline', name: 'Discipline', short: 'Discipline', parts: [['linePenaltiesPerGame', -1]] },
  ],
  TM: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1]] },
    { id: 'dominance', name: 'Dominance', short: 'Dominance', parts: [['pointDiffPerGame', 1], ['netEpa', 1]] },
    { id: 'offense', name: 'Offense', short: 'Offense', parts: [['offEpa', 1], ['offRank', -1]] },
    { id: 'defense', name: 'Defense', short: 'Defense', parts: [['defEpaAllowed', -1], ['defRank', -1]] },
    { id: 'turnovers', name: 'Turnover Battle', short: 'Turnovers', parts: [['turnoverDiffPerGame', 1]] },
    { id: 'specialTeams', name: 'Special Teams', short: 'Spec Teams', parts: [['stEpaPerGame', 1]] },
    { id: 'roster', name: 'Roster', short: 'Roster', parts: [['qbPlay', 1], ['rbPlay', 1], ['weapons', 1], ['oline', 1], ['defense', 1]] },
    { id: 'close', name: 'Close Games', short: 'Close Games', parts: [['oneScoreWinPct', 1]] },
  ],
  HC: [
    { id: 'winning', name: 'Winning', short: 'Winning', parts: [['winPct', 1], ['oneScoreWinPct', 1]] },
    { id: 'expectations', name: 'Beating Expectations', short: 'Over Exp', parts: [['winsOverExpected', 1], ['atsPct', 1]] },
    { id: 'offense', name: 'Offense', short: 'Offense', parts: [['offRank', -1]] },
    { id: 'defense', name: 'Defense', short: 'Defense', parts: [['defRank', -1]] },
    { id: 'aggression', name: 'Aggressiveness', short: 'Aggression', parts: [['fourthDownGoPct', 1]] },
    { id: 'discipline', name: 'Discipline', short: 'Discipline', parts: [['penaltiesPerGame', -1]] },
  ],
};
// Tight ends are graded like receivers
SKILLS.TE = SKILLS.WR;

// The volume and efficiency skills whose split reads as "compiler" or "underused"
export const VOLUME_VS_EFFICIENCY: Partial<Record<SkillPosition, [volume: string, efficiency: string]>> = {
  QB: ['production', 'efficiency'],
  RB: ['workload', 'efficiency'],
  WR: ['role', 'efficiency'],
  TE: ['role', 'efficiency'],
};

// The team grades that bear on each tab's production, for the supporting-cast flags (a QB's own
// defense doesn't move his passing numbers)
export const CAST_GRADES: Partial<Record<SkillPosition, string[]>> = {
  QB: ['responsibility', 'oline', 'weapons'],
  RB: ['oline', 'qbPlay'],
  WR: ['qbPlay'],
  TE: ['qbPlay'],
  HC: ['qbPlay', 'weapons', 'oline', 'defense'],
};

// The results skill and the play skill whose split reads as "winning more than the numbers say" (or
// the reverse)
export const WINS_VS_PLAY: Partial<Record<SkillPosition, [results: string, play: string]>> = {
  QB: ['winning', 'efficiency'],
  TM: ['winning', 'dominance'],
};

// The stat whose garbage-time share gets flagged
export const GARBAGE_TIME_STAT: Partial<Record<SkillPosition, [key: string, words: string]>> = {
  QB: ['passYards', 'passing yards'],
  RB: ['rushYards', 'rushing yards'],
  WR: ['recYards', 'receiving yards'],
  TE: ['recYards', 'receiving yards'],
};

// Archetypes, most specific first: the first whose test passes names the card
const RECEIVER_ARCHETYPES = (lead: string): Archetype[] => [
  { name: `Alpha ${lead}`, test: (s) => s['role'] >= 0.85 && s['production'] >= 0.8 },
  { name: 'Deep Threat', test: (s) => s['deep'] >= 0.8 && s['production'] >= 0.5 },
  { name: 'YAC Monster', test: (s) => s['yac'] >= 0.82 },
  { name: 'Route Technician', test: (s) => s['separation'] >= 0.82 && s['efficiency'] >= 0.6 },
  { name: 'Red Zone Weapon', test: (s) => s['scoring'] >= 0.8 && s['role'] <= 0.6 },
  { name: 'Volume Compiler', test: (s) => s['role'] >= 0.7 && s['efficiency'] <= 0.35 },
  { name: 'Efficient Role Player', test: (s) => s['efficiency'] >= 0.7 && s['role'] <= 0.45 },
  { name: 'Possession Target', test: (s) => s['hands'] >= 0.65 && s['deep'] <= 0.4 },
  { name: `Featured ${lead}`, test: (_, o) => o >= 0.75 },
  { name: `Depth ${lead}`, test: (_, o) => o <= 0.3 },
];

export const ARCHETYPES: Record<SkillPosition, Archetype[]> = {
  QB: [
    { name: 'Dual-Threat Weapon', test: (s) => s['legs'] >= 0.8 && s['efficiency'] >= 0.6 },
    { name: 'Surgeon', test: (s) => s['accuracy'] >= 0.8 && s['efficiency'] >= 0.75 },
    { name: 'Gunslinger', test: (s) => s['downfield'] >= 0.7 && s['security'] <= 0.4 },
    { name: 'Field General', test: (s) => s['efficiency'] >= 0.75 && s['winning'] >= 0.7 },
    { name: 'Point Guard', test: (s) => s['accuracy'] >= 0.65 && s['downfield'] <= 0.35 },
    { name: 'Scrambler', test: (s) => s['legs'] >= 0.75 },
    { name: 'Volume Compiler', test: (s) => s['production'] >= 0.7 && s['efficiency'] <= 0.45 },
    { name: 'Game Manager', test: (s) => s['security'] >= 0.65 && s['production'] <= 0.5 },
    { name: 'Franchise Passer', test: (_, o) => o >= 0.75 },
    { name: 'Struggling Starter', test: (_, o) => o <= 0.3 },
  ],
  RB: [
    { name: 'Three-Down Back', test: (s) => s['workload'] >= 0.7 && s['receiving'] >= 0.7 },
    { name: 'Bell Cow', test: (s) => s['workload'] >= 0.8 },
    { name: 'Home Run Hitter', test: (s) => s['efficiency'] >= 0.8 },
    { name: 'Bruiser', test: (s) => s['power'] >= 0.75 },
    { name: 'Receiving Back', test: (s) => s['receiving'] >= 0.75 && s['workload'] <= 0.55 },
    { name: 'Goal-Line Back', test: (s) => s['scoring'] >= 0.75 && s['efficiency'] <= 0.5 },
    { name: 'Committee Back', test: (s) => s['workload'] <= 0.35 },
    { name: 'Lead Back', test: (_, o) => o >= 0.6 },
  ],
  WR: RECEIVER_ARCHETYPES('Receiver'),
  TE: RECEIVER_ARCHETYPES('Tight End'),
  K: [
    { name: 'Automatic', test: (s) => s['accuracy'] >= 0.85 },
    { name: 'Big Leg', test: (s) => s['range'] >= 0.8 },
    { name: 'Shaky Kicker', test: (s) => s['accuracy'] <= 0.25 },
  ],
  P: [
    { name: 'Boomer', test: (s) => s['distance'] >= 0.8 },
    { name: 'Coffin-Corner Specialist', test: (s) => s['placement'] >= 0.8 },
    { name: 'Field Flipper', test: (s) => s['value'] >= 0.8 },
  ],
  DEF: [
    { name: 'Brick Wall', test: (s) => s['overall'] >= 0.85 && s['scoring'] >= 0.75 },
    { name: 'Ballhawks', test: (s) => s['takeaways'] >= 0.85 },
    { name: 'Pass-Rush Machine', test: (s) => s['rush'] >= 0.85 },
    { name: 'No-Fly Zone', test: (s) => s['pass'] >= 0.85 },
    { name: 'Run Stuffers', test: (s) => s['run'] >= 0.85 },
    { name: "Bend Don't Break", test: (s) => s['scoring'] >= 0.7 && s['overall'] <= 0.5 },
    { name: 'Leaky Defense', test: (s) => s['overall'] <= 0.2 },
  ],
  OL: [
    { name: 'Fortress', test: (s) => s['pass'] >= 0.8 && s['run'] >= 0.8 },
    { name: 'Pass-Pro Wall', test: (s) => s['pass'] >= 0.8 },
    { name: 'Road Graders', test: (s) => s['run'] >= 0.8 },
    { name: 'Sieve', test: (s) => s['pass'] <= 0.2 },
    { name: 'Flag Magnets', test: (s) => s['discipline'] <= 0.15 },
  ],
  TM: [
    // (the top few: the title race)
    { name: 'Super Bowl Contender', test: (s, o) => o >= 0.9 && s['winning'] >= 0.75 },
    { name: 'Juggernaut', test: (s) => s['dominance'] >= 0.9 && s['winning'] >= 0.8 },
    { name: 'Offensive Powerhouse', test: (s) => s['offense'] >= 0.88 && s['defense'] <= 0.6 },
    { name: 'Defensive Juggernaut', test: (s) => s['defense'] >= 0.88 && s['offense'] <= 0.6 },
    { name: 'Turnover Machine', test: (s) => s['turnovers'] >= 0.9 },
    { name: 'Winning Ugly', test: (s) => s['close'] >= 0.85 && s['dominance'] <= 0.6 },
    { name: 'Better Than the Record', test: (s) => s['close'] <= 0.15 && s['dominance'] >= 0.5 },
    { name: 'Talent Without Results', test: (s) => s['roster'] >= 0.75 && s['winning'] <= 0.4 },
    // (the bottom with little to build on; the rest of the bottom quarter: the fallback's Retooling or Lottery Team)
    { name: 'Full Rebuild', test: (s) => s['winning'] <= 0.2 && s['roster'] <= 0.3 },
    // (a losing team's glaring hole)
    { name: "Can't Stop Anyone", test: (s) => s['defense'] <= 0.15 && s['winning'] <= 0.45 },
    { name: 'Stuck in Neutral', test: (s) => s['offense'] <= 0.15 && s['winning'] <= 0.45 },
    { name: 'Giveaway Prone', test: (s) => s['turnovers'] <= 0.12 && s['winning'] <= 0.45 },
  ],
  HC: [
    { name: 'Overachiever', test: (s) => s['expectations'] >= 0.85 },
    { name: 'Riverboat Gambler', test: (s) => s['aggression'] >= 0.9 },
    { name: 'Offensive Mastermind', test: (s) => s['offense'] >= 0.85 },
    { name: 'Defensive Mastermind', test: (s) => s['defense'] >= 0.85 },
    { name: 'Hot Seat', test: (s) => s['winning'] <= 0.15 },
  ],
};

// When no archetype fits: a plain label for where they rank
export function fallbackArchetype(position: SkillPosition, overall: number, _player?: unknown): string {
  if (position === 'TM') return overall >= 0.75 ? 'Playoff Favorite' : overall >= 0.45 ? 'Playoff Team' : overall >= 0.25 ? 'Bubble Team' : 'Retooling';
  const noun: Record<SkillPosition, string> = {
    TM: 'Team',
    QB: 'Starter',
    RB: 'Back',
    WR: 'Receiver',
    TE: 'Tight End',
    K: 'Kicker',
    P: 'Punter',
    DEF: 'Defense',
    OL: 'Line',
    HC: 'Head Coach',
  };
  const tier = overall >= 0.75 ? 'High-End' : overall >= 0.45 ? 'Solid' : overall >= 0.25 ? 'Middling' : 'Struggling';
  return `${tier} ${noun[position]}`;
}
