// A data file's rows with the ones repeated across tabs stored once (MMA's: every fighter in the pound-for-
// pound list and his division alike, his whole fight history twice). The fields every copy of a row has
// alike go in $shared under its id; each tab's copy keeps only its own ({ $id, rank, division... }). The
// site puts them back together as it loads the file (libs/ranker/src/engine/data.ts, expandRows).
export function shareRows(tabs) {
  const copies = new Map();
  for (const rows of Object.values(tabs)) {
    for (const row of rows) copies.set(row.gsisId, [...(copies.get(row.gsisId) ?? []), row]);
  }
  const $shared = {};
  for (const [id, list] of copies) {
    if (list.length < 2) continue;
    const same = {};
    for (const [key, value] of Object.entries(list[0])) {
      const text = JSON.stringify(value);
      if (list.every((row) => key in row && JSON.stringify(row[key]) === text)) same[key] = value;
    }
    if (Object.keys(same).length) $shared[id] = same;
  }
  const out = { $shared };
  for (const [tab, rows] of Object.entries(tabs)) {
    out[tab] = rows.map((row) => {
      const same = $shared[row.gsisId];
      if (!same) return row;
      return { $id: row.gsisId, ...Object.fromEntries(Object.entries(row).filter(([key]) => !(key in same))) };
    });
  }
  return out;
}

// (the site's side, here to check a written file reads back the same)
export function expandRows(file) {
  if (!file?.$shared) return file;
  const { $shared, ...tabs } = file;
  return Object.fromEntries(
    Object.entries(tabs).map(([tab, rows]) => [tab, rows.map(({ $id, ...own }) => ($id === undefined ? own : { ...$shared[$id], ...own }))]),
  );
}
