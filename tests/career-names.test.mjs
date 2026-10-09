// The compare view's search (careers/names.json, libs/ranker/scripts/career-names.mjs): every sport with
// careers has a name for everyone in them, tab by tab, so nobody the tab has had is missing from a search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SPORTS, readJson, staticDir } from './support/engine.mjs';

for (const sport of SPORTS) {
  const dir = path.join(staticDir(sport), 'careers');
  if (!fs.existsSync(path.join(dir, 'first-seasons.json'))) continue;
  test(`${sport}: the careers' names cover everyone in them`, () => {
    const names = readJson(path.join(dir, 'names.json'));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !['names.json', 'first-seasons.json'].includes(f))) {
      const tab = file.replace(/\.json$/, '');
      const careers = readJson(path.join(dir, file));
      const missing = Object.keys(careers).filter((id) => !names[tab]?.[id]);
      assert.equal(missing.length, 0, `${tab}: ${missing.length} without a name (${missing.slice(0, 3).join(', ')})`);
      for (const [id, [name, , last]] of Object.entries(names[tab] ?? {})) {
        assert.ok(typeof name === 'string' && name.length > 1, `${tab} ${id}: no name`);
        assert.ok(Number.isInteger(last), `${tab} ${id}: no last season`);
      }
    }
  });
}
