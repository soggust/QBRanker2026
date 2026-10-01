import type { SkillPosition, SkillWeights } from '@sport/positions';

// Presets for every division, each built around a kind of fighter. A preset sets the stats it's named
// for (60-100); every other stat stays in at 25 as a tiebreaker.
export interface SkillPresetDef {
  key: string;
  label: string;
  description: string;
  weights: SkillWeights;
}

const PRESETS: SkillPresetDef[] = [
  {
    key: 'resume',
    label: 'Resume',
    description: "Who he's beaten: the record, the streak, finishes and the strength of his schedule",
    weights: { winPct: 100, schedule: 90, recent: 70, streak: 60, finishRate: 50 },
  },
  {
    key: 'striker',
    label: 'Striker',
    description: 'Winning on the feet: volume, accuracy, defense and the striking differential',
    weights: { strDiff: 100, slpm: 80, strAcc: 70, strDef: 80, sapm: 60 },
  },
  {
    key: 'knockout',
    label: 'Knockout Artist',
    description: 'Power: knockdowns, finishes and a finish rate that ends fights early',
    weights: { kd15: 100, finishRate: 90, finishes: 80, slpm: 50 },
  },
  {
    key: 'wrestler',
    label: 'Wrestler',
    description: 'Taking it down and keeping it there: takedowns, accuracy, ground control, and stopping theirs',
    weights: { td15: 100, tdAcc: 80, adv15: 70, tdDef: 60 },
  },
  {
    key: 'grappler',
    label: 'Submission Artist',
    description: 'Hunting the finish on the mat: submission attempts, advances and finishes',
    weights: { sub15: 100, adv15: 80, finishRate: 60, td15: 50 },
  },
  {
    key: 'durable',
    label: 'Hard to Beat',
    description: 'Defense and durability: strike and takedown defense, rarely knocked down or finished',
    weights: { strDef: 100, tdDef: 90, kdAgainst: 80, finished: 80, sapm: 70 },
  },
  {
    key: 'momentum',
    label: 'Hot Right Now',
    description: 'Form: the last five, the current streak and the record',
    weights: { recent: 100, streak: 90, winPct: 50 },
  },
];

// (the same presets in every division; written out rather than read from positions.ts, which loads this
// file: the type makes sure every division is here)
export const SKILL_PRESETS: Record<SkillPosition, SkillPresetDef[]> = {
  HW: PRESETS,
  LHW: PRESETS,
  MW: PRESETS,
  WW: PRESETS,
  LW: PRESETS,
  FW: PRESETS,
  BW: PRESETS,
  FLW: PRESETS,
  WBW: PRESETS,
  WFLW: PRESETS,
  WSW: PRESETS,
};
