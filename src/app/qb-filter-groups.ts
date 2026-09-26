import { Filters } from 'app/types';

export type FilterKey = keyof Filters;
export type QbGroupId = 'results' | 'box' | 'advanced' | 'support';

export interface FilterRow {
  key: FilterKey;
  label: string;
  hint?: string;
  // Sub-sliders that set the mix inside this row (e.g. pass vs rush yards)
  children?: FilterRow[];
}

export interface FilterGroup {
  id: QbGroupId;
  title: string;
  icon: string;
  // Group-wide weight shown even when the group is collapsed
  master?: FilterKey;
  rows: FilterRow[];
}

// How the QB sliders are organized in the sidebar
export const QB_FILTER_GROUPS: FilterGroup[] = [
  {
    id: 'results',
    title: 'Results',
    icon: 'emoji_events',
    rows: [
      { key: 'recordValue', label: 'Record', hint: 'Win % as a starter' },
      { key: 'recencyValue', label: 'Recent Form', hint: 'Last five starts, newest counts most' },
    ],
  },
  {
    id: 'box',
    title: 'Basic Stats',
    icon: 'bar_chart',
    rows: [
      { key: 'compValue', label: 'Completion %' },
      {
        key: 'yardsValue',
        label: 'Yards',
        children: [
          { key: 'passYdValue', label: 'Pass Yards' },
          { key: 'rushYdValue', label: 'Rush Yards' },
        ],
      },
      { key: 'ypaValue', label: 'Yards / Attempt' },
      {
        key: 'touchdownValue',
        label: 'Touchdowns',
        children: [
          { key: 'passTdValue', label: 'Pass TDs' },
          { key: 'rushTdValue', label: 'Rush TDs' },
        ],
      },
      {
        key: 'turnoverValue',
        label: 'Turnovers',
        children: [
          { key: 'intValue', label: 'Interceptions' },
          { key: 'fumLostValue', label: 'Fumbles Lost' },
        ],
      },
      { key: 'ratingValue', label: 'Passer Rating' },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced Stats',
    icon: 'insights',
    rows: [
      { key: 'epaValue', label: 'EPA / Play', hint: 'Expected Points Added per play' },
      { key: 'cpoeValue', label: 'CPOE', hint: 'Completion % over expected' },
      { key: 'successValue', label: 'Success Rate', hint: 'Share of plays gaining positive EPA' },
      { key: 'pressureToSackValue', label: 'Pressure → Sack', hint: 'Lower is better' },
      { key: 'badThrowValue', label: 'Bad Throw %', hint: 'Lower is better' },
      { key: 'timeToThrowValue', label: 'Time To Throw', hint: 'Quicker is better' },
      { key: 'adotValue', label: 'Avg Depth Of Target' },
      { key: 'aggressivenessValue', label: 'Aggressiveness', hint: 'Throws into tight coverage' },
      { key: 'fantasyValue', label: 'Fantasy Pts' },
    ],
  },
  {
    id: 'support',
    title: 'Support',
    icon: 'groups',
    master: 'supportValue',
    rows: [
      { key: 'weaponsValue', label: 'Weapons', hint: 'Better weapons count against the QB' },
      { key: 'coachingValue', label: 'Coaching', hint: 'Better coaching counts against the QB' },
      { key: 'olineValue', label: 'O-Line', hint: 'Better O-line counts against the QB' },
      { key: 'defenseValue', label: 'Defense', hint: 'Better defense counts against the QB' },
      { key: 'responsibilityValue', label: 'Responsibility', hint: 'Carrying the offense counts for the QB' },
    ],
  },
];
