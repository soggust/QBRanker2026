// The weekly NFL analysis run (scheduled after Monday night; tried again later in the day): once a day at
// most, and only once nflverse has every finished game. Rebuilds the dossiers from fresh data, then
// batch-runs every team and QB and publishes them for the site.
//
//   node apps/nfl/scripts/analysis/weekly.mjs        (npm run nfl:analysis)
//
// A run that's already done today, or whose data is behind (dossier.mjs exits 3), stops without spending
// anything; the next scheduled try picks it up.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const MARK = path.join(ROOT, '.cache/analysis/last-run.json');
const today = new Date().toLocaleDateString('en-CA');
const stamp = () => new Date().toLocaleString();

if (existsSync(MARK) && JSON.parse(readFileSync(MARK, 'utf8')).date === today) {
  console.log(`${stamp()}: already ran today`);
  process.exit(0);
}

const run = (script, args) => spawnSync(process.execPath, [path.join(import.meta.dirname, script), ...args], { cwd: ROOT, stdio: 'inherit' }).status;

console.log(`${stamp()}: building dossiers`);
const built = run('dossier.mjs', ['--fresh', '--require-complete']);
if (built === 3) {
  console.log(`${stamp()}: nflverse hasn't every finished game yet; trying again at the next scheduled time`);
  process.exit(0);
}
if (built !== 0) process.exit(built ?? 1);

console.log(`${stamp()}: analyzing every team and QB`);
const analyzed = run('analyze.mjs', ['--batch', '--teams', '--qbs']);
if (analyzed !== 0) process.exit(analyzed ?? 1);

writeFileSync(MARK, JSON.stringify({ date: today, at: new Date().toISOString() }));
console.log(`${stamp()}: done`);
