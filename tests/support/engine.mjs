// Loads the app's engine with one sport's modules under Node: bundled with esbuild through the
// sport's tsconfig (its @ranker/* and @sport/* paths), the way the build scripts do it, into a temp
// file that's removed once imported. DATA starts filled with a season's files (see engine-entry.ts).
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SPORTS = ['nfl', 'mlb', 'nba', 'nhl', 'mma'];
// (two overrides, for checking that the tests catch a regression without touching the repo: DATA_ROOT, a
// folder laid out like this one whose apps/<sport>/src/StaticData is read instead; RANKER_SRC, a copy of
// libs/ranker/src the engine is bundled from instead)
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : ROOT;
export const staticDir = (sport) => path.join(DATA_ROOT, 'apps', sport, 'src/StaticData');

// A season's folder: the current season's files sit at the top of StaticData, finished ones in seasons/<year>
export function seasonDir(sport, season, current) {
  return season === current ? staticDir(sport) : path.join(staticDir(sport), 'seasons', String(season));
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// A file whose rows repeated across tabs are stored once ($shared: MMA), put back together (as data.ts does)
export function expandRows(file) {
  const shared = file?.$shared;
  if (!shared) return file;
  const { $shared: _, ...tabs } = file;
  return Object.fromEntries(
    Object.entries(tabs).map(([tab, rows]) => [tab, rows.map(({ $id, ...own }) => ($id === undefined ? own : { ...shared[$id], ...own }))]),
  );
}

// skill-players.json -> skillPlayers
const keyOf = (file) => file.replace(/\.json$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());

// A season's data as the app loads it: skill-players.json and the sport's dataFiles (before the engine
// is loaded, every plain file in the folder, so whichever the sport needs is there)
export function seasonData(dir, dataFiles) {
  const files = dataFiles
    ? { skillPlayers: 'skill-players.json', ...dataFiles }
    : Object.fromEntries(
        fs
          .readdirSync(dir)
          .filter((f) => /^[a-z-]+\.json$/.test(f) && f !== 'comps.json' && f !== 'blocking.json')
          .map((f) => [keyOf(f), f]),
      );
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, expandRows(readJson(path.join(dir, file)))]));
}

// The app's tsconfig, or with RANKER_SRC one like it whose @ranker/* paths point at that copy
function tsconfigFor(app, bundle) {
  const own = path.join(app, 'tsconfig.json');
  if (!process.env.RANKER_SRC) return own;
  const file = `${bundle}.tsconfig.json`;
  const config = {
    extends: own,
    compilerOptions: { baseUrl: path.join(app, 'src'), paths: { '@ranker/*': [path.resolve(process.env.RANKER_SRC) + '/*'], '@sport/*': ['sport/*'] } },
  };
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

// The engine for a sport, its DATA filled with the current season's files
export async function loadEngine(sport, { entry = path.join(import.meta.dirname, 'engine-entry.ts'), data } = {}) {
  const app = path.join(ROOT, 'apps', sport);
  const bundle = path.join(os.tmpdir(), `ranker-test-${sport}-${process.pid}-${Date.now()}.mjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    logLevel: 'error',
    outfile: bundle,
    platform: 'node',
    tsconfig: tsconfigFor(app, bundle),
    // (packages from the repo's node_modules, also for a RANKER_SRC copy outside it)
    nodePaths: [path.join(ROOT, 'node_modules')],
  });
  if (process.env.RANKER_SRC) fs.rmSync(`${bundle}.tsconfig.json`, { force: true });
  globalThis.__DATA = data ?? seasonData(staticDir(sport));
  try {
    return await import(pathToFileURL(bundle).href);
  } finally {
    fs.rmSync(bundle, { force: true });
  }
}
