import type { SkillPosition, SkillWeights } from 'app/positions';

// Presets for every tab, each built around a kind of player. A preset sets the stats it's named for
// (60-100); every other stat stays in at 25 as a tiebreaker.
export interface SkillPresetDef {
  key: string;
  label: string;
  description: string;
  weights: SkillWeights;
}

// On every tab
const IMPACT: SkillPresetDef = {
  key: 'impact',
  label: 'Total Impact',
  description: 'The all-in-one numbers: Win Shares, VORP, Box Plus/Minus and on-off',
  weights: { ws: 100, vorp: 100, bpm: 90, ws48: 70, onOff: 60, per: 50 },
};
const SCORER: SkillPresetDef = {
  key: 'scorer',
  label: 'Scorer',
  description: 'Buckets: points, usage and how efficiently he gets them',
  weights: { points: 100, tsPct: 80, usgPct: 70, fgPct: 50, ftPct: 50, threes: 40 },
};
const DEFENDER: SkillPresetDef = {
  key: 'defender',
  label: 'Defender',
  description: 'Stops: Defensive Box Plus/Minus, steals, blocks and defensive rebounding',
  weights: { dbpm: 100, stlPct: 80, blkPct: 80, steals: 60, blocks: 60, trbPct: 50 },
};
const WINNER: SkillPresetDef = {
  key: 'winner',
  label: 'Winning',
  description: 'His team winning with him: the record, Win Shares and on-off',
  weights: { winPct: 100, ws: 90, onOff: 80, vorp: 60 },
};

// Guards run the offense; wings shoot and defend; bigs rebound, protect the rim and finish
export const SKILL_PRESETS: Record<SkillPosition, SkillPresetDef[]> = {
  PG: [
    IMPACT,
    {
      key: 'floorGeneral',
      label: 'Floor General',
      description: 'Running the offense: assists and assist rate, taking care of the ball',
      weights: { assists: 100, astPct: 100, tovPct: 80, turnovers: 50, onOff: 50 },
    },
    SCORER,
    {
      key: 'shooter',
      label: 'Shooter',
      description: 'Range: 3s made, 3-point and free throw accuracy, true shooting',
      weights: { threes: 100, fg3Pct: 100, ftPct: 70, tsPct: 70 },
    },
    DEFENDER,
    WINNER,
  ],
  SG: [
    IMPACT,
    SCORER,
    {
      key: 'shooter',
      label: 'Shooter',
      description: 'Range: 3s made, 3-point and free throw accuracy, true shooting',
      weights: { threes: 100, fg3Pct: 100, ftPct: 70, tsPct: 70 },
    },
    {
      key: 'threeAndD',
      label: '3 & D',
      description: 'Knock down 3s and guard: 3-point shooting with steals and defensive BPM',
      weights: { fg3Pct: 90, threes: 80, dbpm: 90, stlPct: 70, tovPct: 40 },
    },
    DEFENDER,
    WINNER,
  ],
  SF: [
    IMPACT,
    SCORER,
    {
      key: 'threeAndD',
      label: '3 & D',
      description: 'Knock down 3s and guard: 3-point shooting with steals and defensive BPM',
      weights: { fg3Pct: 90, threes: 80, dbpm: 90, stlPct: 70, tovPct: 40 },
    },
    {
      key: 'allAround',
      label: 'Point Forward',
      description: 'Does it all: points, rebounds and assists, with playmaking rates',
      weights: { points: 70, rebounds: 80, assists: 90, astPct: 70, trbPct: 60, bpm: 60 },
    },
    DEFENDER,
    WINNER,
  ],
  PF: [
    IMPACT,
    SCORER,
    {
      key: 'stretch',
      label: 'Stretch Four',
      description: 'A big who spaces the floor: 3s made and accuracy with rebounding',
      weights: { threes: 100, fg3Pct: 90, tsPct: 60, trbPct: 60, rebounds: 50 },
    },
    {
      key: 'glass',
      label: 'Glass Cleaner',
      description: 'Rebounds: totals and rebound rate, plus efficient finishing',
      weights: { rebounds: 100, trbPct: 100, fgPct: 60, blocks: 40 },
    },
    DEFENDER,
    WINNER,
  ],
  HC: [
    {
      key: 'coachingJob',
      label: 'Coaching Job',
      description: 'Getting more from a roster than its talent: the coaching lift and wins over point differential',
      weights: { lift: 100, pythDiff: 60, netRtg: 50 },
    },
    {
      key: 'winner',
      label: 'Winning',
      description: 'Results: the record and playoff wins',
      weights: { winPct: 100, playoffWins: 100, netRtg: 60 },
    },
    {
      key: 'offense',
      label: 'Offensive Mind',
      description: 'Scheme on offense: the offense\'s rank first',
      weights: { offRank: 100, netRtg: 50, lift: 40 },
    },
    {
      key: 'defense',
      label: 'Defensive Mind',
      description: 'Scheme on defense: the defense\'s rank first',
      weights: { defRank: 100, netRtg: 50, lift: 40 },
    },
  ],
  C: [
    IMPACT,
    {
      key: 'rimProtector',
      label: 'Rim Protector',
      description: 'Protecting the paint: blocks, block rate, defensive BPM and defensive boards',
      weights: { blocks: 100, blkPct: 100, dbpm: 90, trbPct: 60, rebounds: 50 },
    },
    {
      key: 'glass',
      label: 'Glass Cleaner',
      description: 'Rebounds: totals and rebound rate, plus efficient finishing',
      weights: { rebounds: 100, trbPct: 100, fgPct: 60, blocks: 40 },
    },
    {
      key: 'hub',
      label: 'Playmaking Big',
      description: 'The offense runs through him: assists, assist rate and efficient scoring',
      weights: { assists: 100, astPct: 100, tsPct: 70, points: 60, bpm: 60 },
    },
    SCORER,
    WINNER,
  ],
};
