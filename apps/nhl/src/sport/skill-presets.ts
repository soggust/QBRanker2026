import type { SkillPosition, SkillWeights } from '@sport/positions';

// Presets for every tab, each built around a kind of player. A preset sets the stats it's named for
// (60-100); every other stat stays in at 25 as a tiebreaker.
export interface SkillPresetDef {
  key: string;
  label: string;
  description: string;
  weights: SkillWeights;
}

// Skaters
const IMPACT: SkillPresetDef = {
  key: 'impact',
  label: 'Total Impact',
  description: 'The all-in-one numbers: Game Score, and how his team does with him on the ice',
  weights: { gameScore: 100, xgfRel: 90, xgfPct: 80, cfPct: 60, points: 60 },
};
const SNIPER: SkillPresetDef = {
  key: 'sniper',
  label: 'Sniper',
  description: 'Goals: scoring, shooting, the chances he gets and how he finishes them',
  weights: { goals: 100, shootingPct: 80, ixg: 80, goalsAboveX: 70, shots: 60, hdShots: 60, gwg: 40 },
};
const PLAYMAKER: SkillPresetDef = {
  key: 'playmaker',
  label: 'Playmaker',
  description: 'Setting others up: assists, points and the power play',
  weights: { assists: 100, points: 80, ppPoints: 70, xgfPct: 50 },
};
const TWO_WAY: SkillPresetDef = {
  key: 'twoWay',
  label: 'Two-Way',
  description: 'Both ends: shot and chance shares, takeaways, blocks and plus/minus',
  weights: { xgfPct: 100, xgfRel: 90, cfPct: 80, takeaways: 70, blocks: 50, plusMinus: 50, giveaways: 50, faceoffPct: 50 },
};
const ENFORCER: SkillPresetDef = {
  key: 'physical',
  label: 'Physical',
  description: 'Hits, blocks and the dirty areas (high-danger shots)',
  weights: { hits: 100, blocks: 80, hdShots: 60, takeaways: 40 },
};
const WINNER: SkillPresetDef = {
  key: 'winner',
  label: 'Winning',
  description: 'His team winning with him: the record, Game Score and his on-ice shares',
  weights: { winPct: 100, gameScore: 80, xgfPct: 60, plusMinus: 60 },
};

// Centers win draws; defensemen move the puck and defend
const FACEOFF_CENTER: SkillPresetDef = {
  key: 'faceoffs',
  label: 'Faceoff Man',
  description: 'Winning draws, and the defensive side of a center',
  weights: { faceoffPct: 100, takeaways: 60, xgfPct: 60, blocks: 40 },
};
const OFFENSIVE_D: SkillPresetDef = {
  key: 'offensiveD',
  label: 'Offensive D',
  description: 'Running the play from the back end: points, the power play, shots and expected goals for',
  weights: { points: 100, assists: 80, ppPoints: 80, shots: 60, xgfPct: 60, gameScore: 60 },
};
const SHUTDOWN_D: SkillPresetDef = {
  key: 'shutdown',
  label: 'Shutdown D',
  description: 'Keeping it out: chance share against, blocks, hits, takeaways and few giveaways',
  weights: { xgfPct: 100, xgfRel: 90, blocks: 80, hits: 60, takeaways: 60, giveaways: 60, plusMinus: 50 },
};

// Goalies
const GOALIE_PRESETS: SkillPresetDef[] = [
  {
    key: 'saves',
    label: 'Shot Stopper',
    description: 'Stopping the puck against the quality of his shots: GSAx, save percentage and the dangerous ones',
    weights: { gsax: 100, gsaxPer60: 90, savePct: 80, hdSavePct: 80 },
  },
  {
    key: 'workhorse',
    label: 'Workhorse',
    description: 'Carrying the load: saves, shutouts and goals saved over a full season',
    weights: { saves: 100, gsax: 80, shutouts: 70, winPct: 50 },
  },
  {
    key: 'winner',
    label: 'Winning',
    description: 'His record, his shutouts and the goals he kept out',
    weights: { winPct: 100, shutouts: 70, gaa: 70, gsax: 60 },
  },
  {
    key: 'classic',
    label: 'Old School',
    description: 'The traditional line: wins, save percentage, goals-against average and shutouts',
    weights: { winPct: 90, savePct: 100, gaa: 100, shutouts: 80 },
  },
];

export const SKILL_PRESETS: Record<SkillPosition, SkillPresetDef[]> = {
  C: [IMPACT, PLAYMAKER, SNIPER, TWO_WAY, FACEOFF_CENTER, WINNER],
  LW: [IMPACT, SNIPER, PLAYMAKER, TWO_WAY, ENFORCER, WINNER],
  RW: [IMPACT, SNIPER, PLAYMAKER, TWO_WAY, ENFORCER, WINNER],
  D: [IMPACT, OFFENSIVE_D, SHUTDOWN_D, ENFORCER, WINNER],
  G: GOALIE_PRESETS,
};
