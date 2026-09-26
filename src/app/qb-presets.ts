import { Filters } from 'app/types';

export type QbPresetKey =
  | 'default'
  | 'mvp'
  | 'stats'
  | 'analytics'
  | 'gunslinger'
  | 'dualThreat'
  | 'gameManager'
  | 'winner'
  | 'support'
  | 'fantasy';

export interface QbPreset {
  label: string;
  description: string;
  values: Filters;
  // Slider group to open when the preset is picked
  expand?: 'advanced' | 'yards' | 'tds' | 'tos' | 'support';
}

// Every preset starts from 50% everywhere and only changes what defines it
const ALL_50: Filters = {
  recordValue: 50,
  compValue: 50,
  yardsValue: 50,
  passYdValue: 50,
  rushYdValue: 50,
  ypaValue: 50,
  touchdownValue: 50,
  passTdValue: 50,
  rushTdValue: 50,
  turnoverValue: 50,
  intValue: 50,
  fumLostValue: 50,
  ratingValue: 50,
  advancedValue: 50,
  epaValue: 50,
  cpoeValue: 50,
  successValue: 50,
  fantasyValue: 50,
  pressureToSackValue: 50,
  badThrowValue: 50,
  timeToThrowValue: 50,
  adotValue: 50,
  aggressivenessValue: 50,
  recencyValue: 50,
  supportValue: 50,
  weaponsValue: 50,
  coachingValue: 50,
  olineValue: 50,
  defenseValue: 50,
  responsibilityValue: 50,
};

const preset = (overrides: Partial<Filters>): Filters => ({ ...ALL_50, ...overrides });

// Top-level groups at 0 (sub-sliders keep their mix)
const NO_MAIN_STATS: Partial<Filters> = {
  recordValue: 0,
  compValue: 0,
  yardsValue: 0,
  ypaValue: 0,
  touchdownValue: 0,
  turnoverValue: 0,
  ratingValue: 0,
  advancedValue: 0,
  recencyValue: 0,
  supportValue: 0,
};

const ADVANCED_OFF: Partial<Filters> = {
  epaValue: 0,
  cpoeValue: 0,
  successValue: 0,
  fantasyValue: 0,
  pressureToSackValue: 0,
  badThrowValue: 0,
  timeToThrowValue: 0,
  adotValue: 0,
  aggressivenessValue: 0,
};

export const QB_PRESETS: Record<QbPresetKey, QbPreset> = {
  default: {
    label: 'Defaults',
    description: 'Everything weighted equally at 50%',
    values: ALL_50,
  },
  mvp: {
    label: 'MVP',
    description: 'How voters tend to think: winning, touchdowns, big numbers, and carrying the team',
    values: preset({
      recordValue: 80,
      recencyValue: 40,
      compValue: 30,
      yardsValue: 60,
      ypaValue: 40,
      touchdownValue: 75,
      turnoverValue: 60,
      ratingValue: 60,
      advancedValue: 40,
      ...ADVANCED_OFF,
      epaValue: 75,
      cpoeValue: 50,
      successValue: 50,
      pressureToSackValue: 25,
      badThrowValue: 25,
      supportValue: 35,
      weaponsValue: 25,
      coachingValue: 25,
      olineValue: 25,
      defenseValue: 40,
      responsibilityValue: 75,
    }),
  },
  stats: {
    label: 'Stats Only',
    description: 'Just the numbers: no record, recent form, or support adjustments',
    values: preset({ recordValue: 0, recencyValue: 0, supportValue: 0 }),
  },
  analytics: {
    label: 'Analytics',
    description: 'Efficiency first: EPA, CPOE and success rate lead, box-score totals take a back seat',
    expand: 'advanced',
    values: preset({
      recordValue: 0,
      recencyValue: 25,
      compValue: 0,
      yardsValue: 20,
      ypaValue: 50,
      touchdownValue: 20,
      turnoverValue: 40,
      ratingValue: 0,
      advancedValue: 100,
      ...ADVANCED_OFF,
      epaValue: 100,
      cpoeValue: 80,
      successValue: 70,
      pressureToSackValue: 50,
      badThrowValue: 50,
      timeToThrowValue: 25,
      adotValue: 25,
      aggressivenessValue: 25,
    }),
  },
  gunslinger: {
    label: 'Gunslinger',
    description: 'Pushes the ball downfield: passing yards, TDs, depth of target and aggressiveness',
    values: preset({
      recordValue: 30,
      recencyValue: 30,
      compValue: 20,
      yardsValue: 80,
      passYdValue: 100,
      rushYdValue: 0,
      ypaValue: 80,
      touchdownValue: 80,
      passTdValue: 100,
      rushTdValue: 0,
      turnoverValue: 20,
      ratingValue: 40,
      advancedValue: 60,
      ...ADVANCED_OFF,
      epaValue: 50,
      cpoeValue: 25,
      successValue: 25,
      pressureToSackValue: 25,
      adotValue: 100,
      aggressivenessValue: 100,
      supportValue: 25,
    }),
  },
  dualThreat: {
    label: 'Dual Threat',
    description: 'Rewards QBs who hurt you with their legs as well as their arm',
    values: preset({
      recordValue: 40,
      recencyValue: 40,
      compValue: 30,
      yardsValue: 80,
      passYdValue: 40,
      rushYdValue: 100,
      ypaValue: 40,
      touchdownValue: 70,
      passTdValue: 50,
      rushTdValue: 100,
      ratingValue: 40,
      ...ADVANCED_OFF,
      epaValue: 75,
      successValue: 50,
      cpoeValue: 25,
      pressureToSackValue: 50,
      adotValue: 25,
      aggressivenessValue: 25,
      badThrowValue: 25,
      fantasyValue: 50,
    }),
  },
  gameManager: {
    label: 'Game Manager',
    description: 'Accurate, careful, on time: completions and ball security over big plays',
    values: preset({
      recordValue: 70,
      recencyValue: 30,
      compValue: 90,
      yardsValue: 25,
      ypaValue: 40,
      touchdownValue: 30,
      turnoverValue: 100,
      intValue: 75,
      fumLostValue: 75,
      ratingValue: 70,
      advancedValue: 60,
      ...ADVANCED_OFF,
      cpoeValue: 100,
      successValue: 75,
      epaValue: 50,
      badThrowValue: 100,
      pressureToSackValue: 75,
      timeToThrowValue: 75,
    }),
  },
  winner: {
    label: 'Winner',
    description: 'Wins and recent form above all; stats are just a tiebreaker',
    values: preset({
      recordValue: 100,
      recencyValue: 100,
      compValue: 25,
      yardsValue: 25,
      ypaValue: 25,
      touchdownValue: 25,
      turnoverValue: 25,
      ratingValue: 25,
      advancedValue: 25,
      supportValue: 25,
    }),
  },
  support: {
    label: 'Least Support',
    description: 'Ranks only by support: who is doing the most with the least around them',
    expand: 'support',
    values: preset({ ...NO_MAIN_STATS, supportValue: 50 }),
  },
  fantasy: {
    label: 'Fantasy',
    description: 'Fantasy points only (scoring is set in the settings menu)',
    expand: 'advanced',
    values: preset({ ...NO_MAIN_STATS, advancedValue: 100, ...ADVANCED_OFF, fantasyValue: 100 }),
  },
};

export const QB_PRESET_ORDER: QbPresetKey[] = [
  'default',
  'mvp',
  'stats',
  'analytics',
  'gunslinger',
  'dualThreat',
  'gameManager',
  'winner',
  'support',
  'fantasy',
];
