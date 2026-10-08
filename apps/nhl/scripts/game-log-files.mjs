// The NHL's game-log files (the card's Game Log tab: the NHL's API doesn't let the site ask), split so a
// card loads only its player's share: src/StaticData/game-logs/<season>/<bucket>.json, the bucket the
// player's id mod BUCKETS, each { skater, goalie, logs: { id: rows }, playoffs: { id: playoff games } }.
// The site reads the same way (apps/nhl/src/sport/sport.ts, nhlGameLogs).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BUCKETS = 32;
export const SKATER_LOG = ['G', 'A', 'P', '+/-', 'SOG', 'PIM', 'TOI'];
export const GOALIE_LOG = ['SA', 'GA', 'SV%', 'TOI'];

export const bucketOf = (id) => Number(id) % BUCKETS;
export const seasonDir = (root, season) => path.join(root, String(season));

// A season's logs, all buckets read back into one { logs, playoffs } (empty when none are written)
export function readLogFiles(root, season) {
  const dir = seasonDir(root, season);
  const logs = {};
  const playoffs = {};
  if (!existsSync(dir)) return { logs, playoffs };
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const file = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    Object.assign(logs, file.logs);
    Object.assign(playoffs, file.playoffs ?? {});
  }
  return { logs, playoffs };
}

// A season's logs written as its buckets (every bucket, empty ones too: the site asks for any of them);
// a bucket whose contents didn't change is left as it was (no churn in the nightly commit)
export function writeLogFiles(root, season, logs, playoffs) {
  const dir = seasonDir(root, season);
  mkdirSync(dir, { recursive: true });
  const buckets = Array.from({ length: BUCKETS }, () => ({ skater: SKATER_LOG, goalie: GOALIE_LOG, logs: {}, playoffs: {} }));
  for (const [id, rows] of Object.entries(logs)) buckets[bucketOf(id)].logs[id] = rows;
  for (const [id, n] of Object.entries(playoffs)) buckets[bucketOf(id)].playoffs[id] = n;
  let written = 0;
  buckets.forEach((bucket, i) => {
    const file = path.join(dir, `${i}.json`);
    const text = JSON.stringify(bucket);
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
    writeFileSync(file, text);
    written++;
  });
  return written;
}

// (the old one-file layout, gone once converted)
export function removeOldFile(file) {
  if (existsSync(file)) rmSync(file);
}
