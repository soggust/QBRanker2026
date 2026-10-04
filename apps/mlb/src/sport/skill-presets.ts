import type { SkillPosition, SkillWeights } from '@sport/positions';

// Presets for every tab, each built around a kind of player. A preset sets the stats it's named for
// (60-100); every other stat stays in at 25 as a tiebreaker.
export interface SkillPresetDef {
  key: string;
  label: string;
  description: string;
  weights: SkillWeights;
}

// Hitters: the same presets on every position tab (a catcher's or shortstop's defense counts in the
// all-around and glove presets)
const HITTER_PRESETS: SkillPresetDef[] = [
  {
    key: 'war',
    label: 'Total Value',
    description: 'WAR first: hitting, defense and baserunning rolled into one',
    weights: { war: 100, wrcPlus: 60, defRuns: 40, bsr: 30 },
  },
  {
    key: 'slugger',
    label: 'Slugger',
    description: 'Power: home runs, slugging, barrels and hard contact',
    weights: { homeRuns: 100, slg: 90, barrelPct: 80, hardHitPct: 70, rbi: 60, xwoba: 60 },
  },
  {
    key: 'onBase',
    label: 'On-Base Machine',
    description: 'Getting on: OBP, walks, average and few strikeouts',
    weights: { obp: 100, bbPct: 80, avg: 70, kPct: 70, wrcPlus: 60, runs: 50 },
  },
  {
    key: 'speed',
    label: 'Speed & Glove',
    description: 'Legs and leather: stolen bases, sprint speed, baserunning and defense',
    weights: { stolenBases: 90, sprintSpeed: 90, bsr: 90, defRuns: 100, oaa: 90, fieldingPct: 60, rangeFactor: 60, runs: 50 },
  },
  {
    key: 'saber',
    label: 'Sabermetric',
    description: 'The analytics view: wRC+, xwOBA and quality of contact over counting stats',
    weights: { wrcPlus: 100, xwoba: 90, barrelPct: 60, hardHitPct: 60, bbPct: 50, kPct: 50, war: 60 },
  },
  {
    key: 'classic',
    label: 'Old School',
    description: 'The back of the baseball card: AVG, HR, RBI, runs and steals',
    weights: { avg: 100, homeRuns: 100, rbi: 100, runs: 80, stolenBases: 60 },
  },
];

export const SKILL_PRESETS: Record<SkillPosition, SkillPresetDef[]> = {
  TM: [
    {
      key: 'contender',
      label: 'Contender',
      description: 'The best teams: run differential, the record and postseason wins',
      weights: { runDiff: 100, winPct: 90, playoffWins: 70 },
    },
    {
      key: 'roster',
      label: 'Best Roster',
      description: 'The players, by your own rankings at every spot',
      weights: { hitters: 100, rotation: 100, bullpen: 70 },
    },
    {
      key: 'offense',
      label: 'Offense',
      description: 'The lineup: runs per game, OPS and its hitters',
      weights: { offRank: 100, ops: 90, hitters: 60 },
    },
    {
      key: 'prevention',
      label: 'Run Prevention',
      description: 'Pitching and defense: runs allowed, ERA, fielding and the staff',
      weights: { defRank: 100, era: 90, fieldingRuns: 60, rotation: 50, bullpen: 40 },
    },
  ],
  C: HITTER_PRESETS,
  '1B': HITTER_PRESETS,
  '2B': HITTER_PRESETS,
  '3B': HITTER_PRESETS,
  SS: HITTER_PRESETS,
  OF: HITTER_PRESETS,
  DH: HITTER_PRESETS.filter((p) => p.key !== 'speed'),
  SP: [
    {
      key: 'ace',
      label: 'Ace',
      description: 'Dominance: strikeouts, run prevention and the peripherals behind it',
      weights: { war: 90, era: 90, fip: 80, kPct: 90, kbbPct: 80, whiffPct: 60, strikeOuts: 70 },
    },
    {
      key: 'workhorse',
      label: 'Workhorse',
      description: 'Innings and value: eating innings, WAR and keeping runs down',
      weights: { ip: 100, war: 90, era: 60, whip: 50, strikeOuts: 50 },
    },
    {
      key: 'runPrevention',
      label: 'Run Prevention',
      description: 'The results: ERA, WHIP and wins',
      weights: { era: 100, whip: 90, winPct: 70, hr9: 60 },
    },
    {
      key: 'stuff',
      label: 'Stuff',
      description: 'What the pitches do: whiffs, strikeouts, weak contact and expected stats',
      weights: { whiffPct: 100, kPct: 90, xera: 80, hardHitAllowed: 70, barrelAllowed: 70, xfip: 60 },
    },
    {
      key: 'classic',
      label: 'Old School',
      description: 'Wins, ERA, strikeouts and innings',
      weights: { winPct: 100, era: 100, strikeOuts: 90, ip: 80 },
    },
  ],
  RP: [
    {
      key: 'closer',
      label: 'Closer',
      description: 'The ninth inning: saves, ERA and missing bats',
      weights: { saves: 100, era: 80, kPct: 80, whip: 60, war: 60 },
    },
    {
      key: 'setup',
      label: 'Setup Man',
      description: 'The bridge: holds, run prevention and strikeouts',
      weights: { holds: 100, era: 80, kPct: 70, whip: 60 },
    },
    {
      key: 'stuff',
      label: 'Stuff',
      description: 'What the pitches do: whiffs, strikeouts and weak contact',
      weights: { whiffPct: 100, kPct: 100, kbbPct: 80, xwobaAllowed: 70, hardHitAllowed: 60 },
    },
    {
      key: 'value',
      label: 'Total Value',
      description: 'WAR and innings: the relievers who helped their team most',
      weights: { war: 100, ip: 60, fip: 60, era: 50 },
    },
  ],
};
