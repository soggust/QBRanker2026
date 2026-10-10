// Saved lists' plain pieces (no Angular, no Firebase): the limits, the frozen snapshot a list keeps of the
// grid as it was saved (the order, and each row's name, logo, headshot, rank and the numbers in the
// columns showing), and the "Today" comparison against the season's data now. Tested by
// tests/lists.test.mjs; firestore.rules checks the same limits.
import type { Visibility } from '../account-helpers';

// (the rows a list keeps: the top of the grid as it's ordered, so a list stays far under Firestore's 1 MB
// a document, about 100 KB at most with every column showing)
export const LIST_MAX = 50;
// (the stat columns kept: every one showing, up to this many)
export const COLUMN_MAX = 60;
export const TITLE_MAX = 80;
export const NOTE_MAX = 500;

export type SeasonPartKey = 'regular' | 'post' | 'all';

// One row as it was saved: its name, its team's logo (the app's path, or an address), its headshot's
// address, its place in the list, and each column's number and text as the grid showed them
export interface SnapshotRow {
  name: string;
  teamLogo: string | null;
  photo: string | null;
  rank: number;
  values: Record<string, number | null>;
  texts: Record<string, string>;
}

// A column as it was saved: its stat's key, its label, how it reads (the stat's format) and whether
// lower is better (an interception, an ERA)
export interface SnapshotColumn {
  key: string;
  label: string;
  format: string;
  lower: boolean;
}

// What the grid hands over to save: its rows in order and the columns showing, each read as the grid
// reads it
export interface SnapshotSource<P> {
  rows: P[];
  columns: SnapshotColumn[];
  id: (row: P) => string;
  name: (row: P) => string;
  teamLogo: (row: P) => string | null | undefined;
  photo: (row: P) => string | null | undefined;
  value: (row: P, key: string) => number | null;
  text: (row: P, key: string) => string;
}

export interface Snapshot {
  ids: string[];
  snapshot: Record<string, SnapshotRow>;
  columns: string[];
  labels: string[];
  formats: string[];
  lower: string[];
}

// A saved list (users/{uid}/lists/{id}), as the app reads it
export interface SavedList extends Snapshot {
  id: string;
  owner: string;
  sport: string;
  tab: string;
  season: number;
  part: SeasonPartKey;
  // (how volume stats were showing: season totals, per game or a full season's pace)
  basis: string;
  title: string;
  note: string;
  visibility: Visibility;
  createdAt?: unknown;
  updatedAt?: unknown;
  community?: { submitted: boolean; key: string } | null;
}

// (a number kept as a number: a value the grid couldn't read is none)
const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;

// The snapshot of the grid as it is: its first LIST_MAX rows in their order (a player twice, a dragged
// duplicate, kept once), the first COLUMN_MAX columns showing (none twice), each row's numbers and texts
export function buildSnapshot<P>(source: SnapshotSource<P>, max = LIST_MAX): Snapshot {
  const seen = new Set<string>();
  const columns: SnapshotColumn[] = [];
  for (const column of source.columns) {
    if (seen.has(column.key) || columns.length >= COLUMN_MAX) continue;
    seen.add(column.key);
    columns.push(column);
  }
  const ids: string[] = [];
  const snapshot: Record<string, SnapshotRow> = {};
  for (const row of source.rows) {
    if (ids.length >= max) break;
    const id = String(source.id(row) ?? '');
    if (!id || id in snapshot) continue;
    ids.push(id);
    snapshot[id] = {
      name: source.name(row),
      teamLogo: source.teamLogo(row) || null,
      photo: source.photo(row) || null,
      rank: ids.length,
      values: Object.fromEntries(columns.map((c) => [c.key, finite(source.value(row, c.key))])),
      texts: Object.fromEntries(columns.map((c) => [c.key, source.text(row, c.key) ?? '-'])),
    };
  }
  return {
    ids,
    snapshot,
    columns: columns.map((c) => c.key),
    labels: columns.map((c) => c.label),
    formats: columns.map((c) => c.format),
    lower: columns.filter((c) => c.lower).map((c) => c.key),
  };
}

// A list put in a new order (dragged in its own view): the snapshot's rows renumbered, their numbers
// as they were saved
export function reorderSnapshot(list: Pick<Snapshot, 'ids' | 'snapshot'>, ids: string[]): Pick<Snapshot, 'ids' | 'snapshot'> {
  const kept = ids.filter((id) => id in list.snapshot);
  return {
    ids: kept,
    snapshot: Object.fromEntries(kept.map((id, i) => [id, { ...list.snapshot[id], rank: i + 1 }])),
  };
}

// The columns of a saved list, as one list (its key, label, format and direction)
export function listColumns(list: Pick<Snapshot, 'columns' | 'labels' | 'formats' | 'lower'>): SnapshotColumn[] {
  const lower = new Set(list.lower ?? []);
  return (list.columns ?? []).map((key, i) => ({ key, label: list.labels?.[i] ?? key, format: list.formats?.[i] ?? '', lower: lower.has(key) }));
}

// ---------------------------------------------------------------------------
// Today: each saved row against the season's data now
// ---------------------------------------------------------------------------
// A row as the data reads today (none: he isn't in the season's rows any more)
export interface TodayRow {
  values: Record<string, number | null>;
  texts: Record<string, string>;
  // (where today's default ranking puts him, among the players it lists; null when it leaves him out)
  rank: number | null;
}

export type Trend = 'up' | 'down' | 'same' | null;

export interface TodayCell {
  key: string;
  text: string;
  saved: string;
  delta: number | null;
  deltaText: string;
  // (better or worse for him: up is better, lower-is-better stats included)
  trend: Trend;
}

export interface ComparedRow {
  id: string;
  saved: SnapshotRow;
  today: TodayRow | null;
  cells: TodayCell[];
  // (his place in the list against where today's default ranking puts him: positive is higher today, ie
  // a smaller number)
  rankMove: number | null;
}

// (how many decimals a text shows: "4.35" 2, "1,234" 0, "65%" 0)
function decimalsOf(text: string): number {
  const match = /\.(\d+)/.exec(text.replace(/,/g, ''));
  return match ? match[1].length : 0;
}

// A change in a column, written like its values: "+0.45", "-3", "+5%" (a percent kept as a fraction),
// "+1.2%" (one kept in points), "+0:42" (minutes)
export function deltaText(delta: number | null, format: string, savedText = ''): string {
  if (delta === null || !Number.isFinite(delta)) return '';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±';
  const size = Math.abs(delta);
  switch (format) {
    case 'pct':
      return `${sign}${Math.round(size * 100)}%`;
    case 'pctPoints':
      return `${sign}${size.toFixed(1)}%`;
    case 'mmss': {
      const total = Math.round(size * 60);
      return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }
    case 'grade':
      return `${sign}${size.toFixed(1)}`;
    case 'avg3':
      return `${sign}${size.toFixed(3).replace(/^0/, '')}`;
    case 'rank':
      return `${sign}${Math.round(size)}`;
    default: {
      const places = Math.min(3, Math.max(decimalsOf(savedText), size > 0 && size < 1 && decimalsOf(savedText) === 0 ? 1 : 0));
      return `${sign}${new Intl.NumberFormat('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }).format(size)}`;
    }
  }
}

// (a change too small to show at the column's precision is no change)
function trendOf(delta: number | null, column: SnapshotColumn, text: string): Trend {
  if (delta === null) return null;
  if (text.replace(/[^0-9]/g, '').replace(/^0+/, '') === '' || Math.abs(delta) < 1e-9) return 'same';
  // (a rank column, "#3": a smaller number is better, like a lower-is-better stat)
  const better = column.lower || column.format === 'rank' ? delta < 0 : delta > 0;
  return better ? 'up' : 'down';
}

// Every saved row with its numbers today: each column's value now, its change since the list was
// saved (and whether that's better or worse), and where today's default ranking puts him
export function compareToday(list: Pick<Snapshot, 'ids' | 'snapshot' | 'columns' | 'labels' | 'formats' | 'lower'>, today: Map<string, TodayRow>): ComparedRow[] {
  const columns = listColumns(list);
  return list.ids
    .filter((id) => id in list.snapshot)
    .map((id, i) => {
      const saved = list.snapshot[id];
      const now = today.get(id) ?? null;
      const cells = columns.map((column) => {
        const was = saved.values?.[column.key] ?? null;
        const is = now ? (now.values[column.key] ?? null) : null;
        const savedText = saved.texts?.[column.key] ?? '-';
        // (records, "10-3", and anything without a number on both sides: no change to show)
        const delta = was === null || is === null || column.format === 'record' ? null : is - was;
        const text = deltaText(delta, column.format, savedText);
        return {
          key: column.key,
          text: now ? (now.texts[column.key] ?? '-') : savedText,
          saved: savedText,
          delta,
          deltaText: text,
          trend: trendOf(delta, column, text),
        };
      });
      // (his place in the list as it's ordered now: a drag not saved yet counts)
      const rankMove = now?.rank ? i + 1 - now.rank : null;
      return { id, saved, today: now, cells, rankMove };
    });
}

// ---------------------------------------------------------------------------
// Checks (firestore.rules has the same)
// ---------------------------------------------------------------------------
export function titleProblem(title: string): string | null {
  const t = title.trim();
  if (!t) return 'Give it a title.';
  if (t.length > TITLE_MAX) return `At most ${TITLE_MAX} characters.`;
  return null;
}

export function noteProblem(note: string): string | null {
  return note.trim().length > NOTE_MAX ? `At most ${NOTE_MAX} characters.` : null;
}

// (a team logo's address from anywhere on the site: an app's own path made absolute under its sport)
export function logoUrl(sport: string, logo: string | null | undefined): string | null {
  if (!logo) return null;
  return /^(https?:|data:|\/)/.test(logo) ? logo : `/${sport}/${logo}`;
}

// A list's address, to open or share it: on its own sport's page
export function listPath(sport: string, owner: string, id: string): string {
  return `/${sport}/#lists/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`;
}

// (#lists/<uid>/<id>: whose list and which; null for the lists page itself)
export function readListHash(hash: string): { owner: string; id: string } | null {
  const match = /^#?lists\/([^/]+)\/([^/?#]+)/.exec(hash);
  if (!match) return null;
  try {
    return { owner: decodeURIComponent(match[1]), id: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Presets: a tab's sliders, the stats switched off and the groups switched off, under a name
// ---------------------------------------------------------------------------
export const PRESET_NAME_MAX = 40;

export interface PresetSettings {
  weights: Record<string, number>;
  hidden: string[];
  groups: string[];
}

export interface UserPreset {
  id: string;
  sport: string;
  tab: string;
  name: string;
  settings: PresetSettings;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function presetNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give it a name.';
  if (n.length > PRESET_NAME_MAX) return `At most ${PRESET_NAME_MAX} characters.`;
  return null;
}

// A tab's settings as a preset keeps them: every slider (whole numbers, 0 to 100), the stats switched off
// ("TAB.key" in the app, the key alone here) and the groups switched off
export function presetSettings(
  tab: string,
  weights: Record<string, number | undefined>,
  hiddenStats: Record<string, boolean>,
  hiddenGroups: Record<string, boolean | undefined>,
): PresetSettings {
  const sliders = Object.entries(weights)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([k, v]) => [k, Math.max(0, Math.min(100, Math.round(v as number)))] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    weights: Object.fromEntries(sliders),
    hidden: Object.entries(hiddenStats)
      .filter(([key, off]) => off && key.startsWith(`${tab}.`))
      .map(([key]) => key.slice(tab.length + 1))
      .sort(),
    groups: Object.entries(hiddenGroups)
      .filter(([, off]) => !!off)
      .map(([id]) => id)
      .sort(),
  };
}

// (the same settings: Update has nothing to do)
export function samePreset(a: PresetSettings, b: PresetSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// (a preset's dropdown value, beside the built-in presets' keys)
export const USER_PRESET = 'user:';

// A new list's title to start from: the season, the part when it isn't the regular season, the tab's
// name and the day ("2026 Quarterbacks · Oct 9", "2024 Playoffs Teams · Oct 9")
export function defaultListTitle(season: string, tab: string, part: 'regular' | 'post' | 'all', today: Date): string {
  const when = part === 'post' ? ' Playoffs' : part === 'all' ? ' Full Season' : '';
  const day = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${season}${when} ${tab} · ${day}`;
}
