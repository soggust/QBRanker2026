import type { SkillPosition, SkillWeights } from '@sport/positions';

// Presets for every tab, one set per position, each built around a real player / unit type.
// A preset sets the stats it's named for (75-100); every other stat stays in at 25 as a tiebreaker,
// and support grades and the Total Yds / Total TDs parent sliders stay neutral at 50.
// Fantasy ranks purely on fantasy points.
export interface SkillPresetDef {
  key: string;
  label: string;
  description: string;
  weights: SkillWeights;
}

const FANTASY: SkillPresetDef = {
  key: 'fantasy',
  label: 'Fantasy',
  description: 'Fantasy points only (scoring is set in the settings menu)',
  weights: { fantasy: 100 },
};

const WR_TE_EFFICIENCY: SkillPresetDef = {
  key: 'efficiency',
  label: 'Efficiency',
  description: 'Production per target: EPA, catch rate, yards after catch over expected, sure hands',
  weights: { epaPerTarget: 100, catchPct: 80, yacOverExp: 75, separation: 60, dropPct: 75, fumbles: 60 },
};

export const SKILL_PRESETS: Record<SkillPosition, SkillPresetDef[]> = {
  // Carried over from the original QB page: each group weight (Support, Advanced) is folded into the
  // sliders it scaled; every slider is listed, so a preset fully sets the tab
  QB: [
    {
      key: 'mvp',
      label: 'MVP',
      description: 'How voters tend to think: winning, touchdowns, big numbers, and carrying the team',
      weights: {
        winPct: 80, recent: 40, compPct: 30, totalYards: 60, passYards: 50, rushYards: 50,
        ypa: 40, totalTds: 75, passTds: 50, rushTds: 50, turnovers: 60, ints: 50,
        fumbles: 50, rating: 60, epaPerPlay: 60, cpoe: 40, successRate: 40, fantasy: 0,
        pressureToSack: 20, badThrowPct: 20, timeToThrow: 0, adot: 0, aggressiveness: 0, weapons: 20,
        coaching: 20, oline: 20, defense: 30, responsibility: 55,
      },
    },
    {
      key: 'stats',
      label: 'Stats Only',
      description: 'Just the numbers: no record, recent form, or support adjustments',
      weights: {
        winPct: 0, recent: 0, compPct: 50, totalYards: 50, passYards: 50, rushYards: 50,
        ypa: 50, totalTds: 50, passTds: 50, rushTds: 50, turnovers: 50, ints: 50,
        fumbles: 50, rating: 50, epaPerPlay: 50, cpoe: 50, successRate: 50, fantasy: 50,
        pressureToSack: 50, badThrowPct: 50, timeToThrow: 50, adot: 50, aggressiveness: 50, weapons: 0,
        coaching: 0, oline: 0, defense: 0, responsibility: 0,
      },
    },
    {
      key: 'analytics',
      label: 'Analytics',
      description: 'Efficiency first: EPA, CPOE and success rate lead, box-score totals take a back seat',
      weights: {
        winPct: 0, recent: 25, compPct: 0, totalYards: 20, passYards: 50, rushYards: 50,
        ypa: 50, totalTds: 20, passTds: 50, rushTds: 50, turnovers: 40, ints: 50,
        fumbles: 50, rating: 0, epaPerPlay: 100, cpoe: 100, successRate: 100, fantasy: 0,
        pressureToSack: 100, badThrowPct: 100, timeToThrow: 50, adot: 50, aggressiveness: 50, weapons: 50,
        coaching: 50, oline: 50, defense: 50, responsibility: 50,
      },
    },
    {
      key: 'gunslinger',
      label: 'Gunslinger',
      description: 'Pushes the ball downfield: passing yards, TDs, depth of target and aggressiveness',
      weights: {
        winPct: 30, recent: 30, compPct: 20, totalYards: 80, passYards: 100, rushYards: 0,
        ypa: 80, totalTds: 80, passTds: 100, rushTds: 0, turnovers: 20, ints: 50,
        fumbles: 50, rating: 40, epaPerPlay: 60, cpoe: 30, successRate: 30, fantasy: 0,
        pressureToSack: 30, badThrowPct: 0, timeToThrow: 0, adot: 100, aggressiveness: 100, weapons: 25,
        coaching: 25, oline: 25, defense: 25, responsibility: 25,
      },
    },
    {
      key: 'dualThreat',
      label: 'Dual Threat',
      description: 'Rewards QBs who hurt you with their legs as well as their arm',
      weights: {
        winPct: 40, recent: 40, compPct: 30, totalYards: 80, passYards: 40, rushYards: 100,
        ypa: 40, totalTds: 70, passTds: 50, rushTds: 100, turnovers: 50, ints: 50,
        fumbles: 50, rating: 40, epaPerPlay: 75, cpoe: 25, successRate: 50, fantasy: 50,
        pressureToSack: 50, badThrowPct: 25, timeToThrow: 0, adot: 25, aggressiveness: 25, weapons: 50,
        coaching: 50, oline: 50, defense: 50, responsibility: 50,
      },
    },
    {
      key: 'gameManager',
      label: 'Game Manager',
      description: 'Accurate, careful, on time: completions and ball security over big plays',
      weights: {
        winPct: 70, recent: 30, compPct: 90, totalYards: 25, passYards: 50, rushYards: 50,
        ypa: 40, totalTds: 30, passTds: 50, rushTds: 50, turnovers: 100, ints: 75,
        fumbles: 75, rating: 70, epaPerPlay: 60, cpoe: 100, successRate: 90, fantasy: 0,
        pressureToSack: 90, badThrowPct: 100, timeToThrow: 90, adot: 0, aggressiveness: 0, weapons: 50,
        coaching: 50, oline: 50, defense: 50, responsibility: 50,
      },
    },
    {
      key: 'winner',
      label: 'Winner',
      description: 'Wins and recent form above all; stats are just a tiebreaker',
      weights: {
        winPct: 100, recent: 100, compPct: 25, totalYards: 25, passYards: 50, rushYards: 50,
        ypa: 25, totalTds: 25, passTds: 50, rushTds: 50, turnovers: 25, ints: 50,
        fumbles: 50, rating: 25, epaPerPlay: 25, cpoe: 25, successRate: 25, fantasy: 25,
        pressureToSack: 25, badThrowPct: 25, timeToThrow: 25, adot: 25, aggressiveness: 25, weapons: 25,
        coaching: 25, oline: 25, defense: 25, responsibility: 25,
      },
    },
    {
      key: 'support',
      label: 'Least Support',
      description: 'Ranks only by support: who is doing the most with the least around them',
      weights: {
        winPct: 0, recent: 0, compPct: 0, totalYards: 0, passYards: 50, rushYards: 50,
        ypa: 0, totalTds: 0, passTds: 50, rushTds: 50, turnovers: 0, ints: 50,
        fumbles: 50, rating: 0, epaPerPlay: 0, cpoe: 0, successRate: 0, fantasy: 0,
        pressureToSack: 0, badThrowPct: 0, timeToThrow: 0, adot: 0, aggressiveness: 0, weapons: 50,
        coaching: 50, oline: 50, defense: 50, responsibility: 50,
      },
    },
    FANTASY,
  ],
  RB: [
    {
      key: 'workhorse',
      label: 'Workhorse',
      description: 'Every-down volume: carries, rushing yards and TDs, first downs, snaps',
      weights: { carries: 100, rushYards: 90, rushTds: 80, firstDowns: 75, snapShare: 90, receptions: 50 },
    },
    {
      key: 'efficiency',
      label: 'Efficiency',
      description: 'Production per touch: yards per carry, EPA and rush yards over expected',
      weights: { ypc: 90, epaPerCarry: 100, ryoePerAtt: 100, yacoPerCarry: 75, epaPerTarget: 75, fumbles: 60 },
    },
    {
      key: 'passCatcher',
      label: 'Pass Catcher',
      description: 'Backs who matter in the passing game: targets, catches and receiving production',
      weights: { targets: 100, receptions: 90, recYards: 90, recTds: 75, epaPerTarget: 75 },
    },
    {
      key: 'elusive',
      label: 'Elusive',
      description: 'Makes defenders miss: broken tackles, yards after contact, yards over expected',
      weights: { brokenTackles: 100, yacoPerCarry: 100, ryoePerAtt: 80, ypc: 60 },
    },
    FANTASY,
  ],
  WR: [
    {
      key: 'alpha',
      label: 'Alpha',
      description: 'The focal point of the offense: targets, target and air-yards share, catches, yards, TDs',
      weights: { targets: 100, targetShare: 100, airYardsShare: 90, receptions: 80, recYards: 90, recTds: 75, snapShare: 60 },
    },
    WR_TE_EFFICIENCY,
    {
      key: 'deepThreat',
      label: 'Deep Threat',
      description: 'Stretches the field: depth of target, air-yards share, yards and touchdowns',
      weights: { adot: 100, airYardsShare: 90, recYards: 75, recTds: 75, epaPerTarget: 60 },
    },
    {
      key: 'playmaker',
      label: 'Playmaker',
      description: 'Dangerous with the ball: yards after catch (total and over expected), rushing yards',
      weights: { yac: 100, yacOverExp: 100, rushYards: 60, recTds: 60 },
    },
    {
      key: 'routeRunner',
      label: 'Route Runner',
      description: 'Gets open and catches it: separation, catch rate, few drops',
      weights: { separation: 100, catchPct: 80, dropPct: 80, targetShare: 60 },
    },
    FANTASY,
  ],
  TE: [
    {
      key: 'receivingTe',
      label: 'Receiving TE',
      description: 'A true target: targets, share, catches, yards and touchdowns',
      weights: { targets: 100, targetShare: 100, receptions: 90, recYards: 90, recTds: 75 },
    },
    WR_TE_EFFICIENCY,
    {
      key: 'redZone',
      label: 'Red Zone',
      description: 'Finishes drives: touchdowns first, then target share and catch rate',
      weights: { recTds: 100, rushTds: 60, targetShare: 60, catchPct: 60 },
    },
    {
      key: 'everyDown',
      label: 'Every Down',
      description: 'On the field for every snap (blocking and receiving), with steady production',
      weights: { snapShare: 100, receptions: 60, catchPct: 60, dropPct: 60 },
    },
    FANTASY,
  ],
  K: [
    {
      key: 'accuracy',
      label: 'Accuracy',
      description: 'Makes what he should and more: FG %, over expected, extra points, EPA',
      weights: { fgPct: 100, fgOverExp: 100, patPct: 80, epaPerKick: 75 },
    },
    {
      key: 'bigLeg',
      label: 'Big Leg',
      description: 'Range: 50+ yard makes and the longest kick',
      weights: { fg50: 100, fgLong: 100, fgOverExp: 60 },
    },
    {
      key: 'volume',
      label: 'Volume',
      description: 'Points on the board: field goals made and extra points',
      weights: { fgMade: 100, patPct: 60, fg50: 60 },
    },
    FANTASY,
  ],
  P: [
    {
      key: 'distance',
      label: 'Distance',
      description: 'Boots it: gross and net average',
      weights: { grossAvg: 100, netAvg: 80 },
    },
    {
      key: 'placement',
      label: 'Placement',
      description: 'Pins them deep: inside the 20, few touchbacks',
      weights: { inside20: 100, inside20Pct: 100, touchbacks: 80 },
    },
    {
      key: 'hangTime',
      label: 'Hang Time',
      description: 'Unreturnable punts: net average, fair catches and EPA',
      weights: { netAvg: 100, fairCatchPct: 90, epaPerPunt: 80 },
    },
  ],
  DEF: [
    {
      key: 'passRush',
      label: 'Pass Rush',
      description: 'Gets home: sacks, pressure rate, and pass EPA allowed',
      weights: { sacks: 100, pressureRate: 100, passEpaAllowed: 75 },
    },
    {
      key: 'ballHawks',
      label: 'Ball Hawks',
      description: 'Takes the ball away: takeaways first, then pass defense',
      weights: { takeaways: 100, passEpaAllowed: 60, pressureRate: 50 },
    },
    {
      key: 'runStop',
      label: 'Run Stop',
      description: 'Shuts down the ground game: rush EPA allowed, success rate, tackling',
      weights: { rushEpaAllowed: 100, successAllowed: 75, missedTacklePct: 80 },
    },
    {
      key: 'bendDontBreak',
      label: "Bend Don't Break",
      description: 'Keeps points off the board: points allowed, red zone and third down',
      weights: { ptsAllowedPerGame: 100, redZoneTdPct: 100, thirdDownPct: 80 },
    },
    {
      key: 'analytics',
      label: 'Analytics',
      description: 'Play-by-play efficiency: EPA and success rate allowed',
      weights: { epaAllowed: 100, successAllowed: 90, passEpaAllowed: 75, rushEpaAllowed: 75 },
    },
    FANTASY,
  ],
  OL: [
    {
      key: 'passPro',
      label: 'Pass Pro',
      description: 'Keeps the QB clean: pressure rate, sack rate, sacks and hits allowed',
      weights: { pressureRate: 100, sackRate: 100, sacksAllowed: 75, qbHitsAllowed: 75 },
    },
    {
      key: 'maulers',
      label: 'Maulers',
      description: 'Moves people in the run game: yards before contact, stuffs, yards per carry',
      weights: { yardsBeforeContact: 100, stuffRate: 90, ypc: 80, shortYardagePct: 60 },
    },
    {
      key: 'shortYardage',
      label: 'Short Yardage',
      description: 'Wins the must-have yards: 3rd / 4th and short conversions and stuff rate',
      weights: { shortYardagePct: 100, stuffRate: 80, runSuccess: 60 },
    },
    {
      key: 'analytics',
      label: 'Analytics',
      description: 'Play-by-play efficiency: run EPA and success rate, pressure and sack rate',
      weights: { runEpa: 100, runSuccess: 90, pressureRate: 75, sackRate: 75 },
    },
    {
      key: 'discipline',
      label: 'Discipline',
      description: 'Clean blocking: few holding and false-start penalties, few sacks',
      weights: { linePenaltiesPerGame: 100, sacksAllowed: 60 },
    },
  ],
  HC: [
    {
      key: 'winner',
      label: 'Winner',
      description: 'Wins, close games and point differential',
      weights: { winPct: 100, oneScoreWinPct: 80, pointDiffPerGame: 60 },
    },
    {
      key: 'overachiever',
      label: 'Overachiever',
      description: 'Beats expectations: wins over the betting lines and against the spread',
      weights: { winsOverExpected: 100, atsPct: 100 },
    },
    {
      key: 'analytics',
      label: 'Analytics',
      description: 'Plays the percentages: net EPA, 4th-down aggressiveness, point differential',
      weights: { netEpa: 100, fourthDownGoPct: 80, pointDiffPerGame: 75 },
    },
    {
      key: 'discipline',
      label: 'Discipline',
      description: 'Clean football: few penalties, winning the turnover battle',
      weights: { penaltiesPerGame: 100, turnoverDiffPerGame: 100 },
    },
  ],
};
