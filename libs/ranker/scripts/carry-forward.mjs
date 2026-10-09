// Carrying the committed data forward (the data scripts): when a source fails, the values it gives are
// taken from the file the last good run wrote, rather than written over with nulls or nothing. A night
// with Baseball Savant or ESPN down keeps yesterday's numbers; the next good night replaces them.
import { readFile } from 'node:fs/promises';

// A data file's rows, every tab ({ C: [...], ... } -> [...]); none when there's no file (or it won't read)
export async function previousRows(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return Object.values(data).filter(Array.isArray).flat();
  } catch {
    return [];
  }
}

// A data file's tab ([] when there's none)
export async function previousTab(file, tab) {
  try {
    const rows = JSON.parse(await readFile(file, 'utf8'))[tab];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Into each of rows (a list, or tabs of lists), the previous row's values (by key: gsisId) for the stats
// and the top-level fields given, and whatever take(row, prev) moves over itself (true when it did). A
// row with no previous row, or a value the previous row hasn't, is left as it is; so is a row whose
// previous one keep(row, prev) turns down. Returns how many rows took something.
export function carryForward(rows, previous, { stats = [], fields = [], take, keep = () => true, key = (row) => row.gsisId } = {}) {
  const before = new Map(previous.map((row) => [key(row), row]));
  let carried = 0;
  for (const row of Array.isArray(rows) ? rows : Object.values(rows).flat()) {
    const prev = before.get(key(row));
    if (!prev || !keep(row, prev)) continue;
    let took = false;
    for (const k of stats) {
      if (prev.stats && k in prev.stats) {
        row.stats[k] = prev.stats[k];
        took = true;
      }
    }
    for (const k of fields) {
      if (k in prev) {
        row[k] = prev[k];
        took = true;
      }
    }
    if (take?.(row, prev)) took = true;
    if (took) carried++;
  }
  return carried;
}

// keep: the previous row is this season's, as far as can be told: no more games than now (a season's
// games only grow; more is last season's file, the current one not yet rebuilt since the rollover)
export const sameSeason = (row, prev) => (prev.games ?? 0) <= (row.games ?? 0);
