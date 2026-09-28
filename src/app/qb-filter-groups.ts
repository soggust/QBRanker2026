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

// The QB grid columns each sidebar row controls (a row with a breakdown covers the combined column
// and its parts), so dragging a row in the sidebar moves its columns together
export const QB_ROW_COLUMNS: Partial<Record<FilterKey, string[]>> = {
  recordValue: ['record'],
  recencyValue: ['last-five'],
  compValue: ['comp-percent'],
  yardsValue: ['total-yards', 'pass-yards', 'rush-yards'],
  ypaValue: ['ypa'],
  touchdownValue: ['touchdowns', 'pass-tds', 'rush-tds'],
  turnoverValue: ['turnovers', 'interceptions', 'fumbles-lost'],
  ratingValue: ['rating'],
  epaValue: ['epa'],
  cpoeValue: ['cpoe'],
  successValue: ['success-rate'],
  pressureToSackValue: ['pressureToSack'],
  badThrowValue: ['badThrowPct'],
  timeToThrowValue: ['timeToThrow'],
  adotValue: ['adot'],
  aggressivenessValue: ['aggressiveness'],
  fantasyValue: ['fantasy'],
  weaponsValue: ['weapons'],
  coachingValue: ['coaching'],
  olineValue: ['o-line'],
  defenseValue: ['defense'],
  responsibilityValue: ['responsibility'],
};

// How the QB sliders are organized in the sidebar (labels match the grid's column labels)
export const QB_FILTER_GROUPS: FilterGroup[] = [
  {
    id: 'results',
    title: 'Results',
    icon: 'emoji_events',
    rows: [
      { key: 'recordValue', label: 'Record', hint: 'Win % as a starter' },
      { key: 'recencyValue', label: 'Recent', hint: 'Last five starts, newest counts most' },
    ],
  },
  {
    id: 'box',
    title: 'Basic Stats',
    icon: 'bar_chart',
    rows: [
      { key: 'compValue', label: 'Comp %', hint: 'Completion percentage' },
      {
        key: 'yardsValue',
        label: 'Total Yds',
        children: [
          { key: 'passYdValue', label: 'Pass Yards' },
          { key: 'rushYdValue', label: 'Rush Yards' },
        ],
      },
      { key: 'ypaValue', label: 'Per Attempt', hint: 'Yards per pass attempt' },
      {
        key: 'touchdownValue',
        label: 'Total TDs',
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
      { key: 'ratingValue', label: 'Rating', hint: 'Passer rating' },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced Stats',
    icon: 'insights',
    rows: [
      { key: 'epaValue', label: 'EPA / Play', hint: 'Expected Points Added per play' },
      { key: 'cpoeValue', label: 'CPOE', hint: 'Completion % over expected' },
      { key: 'successValue', label: 'Success', hint: 'Share of plays gaining positive EPA' },
      { key: 'pressureToSackValue', label: 'Pressure → Sack', hint: 'Lower is better' },
      { key: 'badThrowValue', label: 'Bad Throw %', hint: 'Lower is better' },
      { key: 'timeToThrowValue', label: 'Time To Throw', hint: 'Quicker is better' },
      { key: 'adotValue', label: 'aDOT', hint: 'Average depth of target' },
      { key: 'aggressivenessValue', label: 'Aggressive %', hint: 'Throws into tight coverage' },
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
      { key: 'olineValue', label: 'O-Line', hint: 'Better O-line counts against the QB' },
      { key: 'defenseValue', label: 'Defense', hint: 'Better defense counts against the QB' },
      { key: 'coachingValue', label: 'Coaching', hint: 'Better coaching counts against the QB' },
      { key: 'responsibilityValue', label: 'Responsibility', hint: 'Carrying the offense counts for the QB' },
    ],
  },
];

// Breakdown sliders and the column each one controls
const QB_CHILD_COLUMNS: Partial<Record<FilterKey, string[]>> = {
  passYdValue: ['pass-yards'],
  rushYdValue: ['rush-yards'],
  passTdValue: ['pass-tds'],
  rushTdValue: ['rush-tds'],
  intValue: ['interceptions'],
  fumLostValue: ['fumbles-lost'],
};

// Every slider that controls a QB column (its row, the row's group-wide weight, and a breakdown
// slider); switching any of them off with its eye hides the column
export const QB_COLUMN_KEYS: Record<string, FilterKey[]> = (() => {
  const keys: Record<string, FilterKey[]> = {};
  for (const group of QB_FILTER_GROUPS) {
    for (const row of group.rows) {
      for (const column of QB_ROW_COLUMNS[row.key] ?? []) {
        keys[column] = [row.key, ...(group.master ? [group.master] : [])];
      }
      for (const child of row.children ?? []) {
        for (const column of QB_CHILD_COLUMNS[child.key] ?? []) keys[column].push(child.key);
      }
    }
  }
  return keys;
})();
