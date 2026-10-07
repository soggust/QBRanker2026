// The bet ledger (data/analysis/ledger.json): every week's bet desk picks as they stood when each game
// kicked off (bet-desk.mjs locks them in), each graded after its game (grade.mjs), and the record they
// make: by confidence level and by kind of bet. The bet desk reads the record back to calibrate itself;
// the Bets page shows it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LEDGER = path.resolve(import.meta.dirname, '../../src/StaticData/analysis/ledger.json');

export const readLedger = () => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { season: null, weeks: {}, record: null });
export const writeLedger = (ledger) => writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 1)}\n`);

// (a season runs into the next January and February)
export function seasonOf(date) {
  const d = new Date(date);
  return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

// A pick's confidence level, as the Bets page labels it
export const levelOf = (strength) => (strength >= 7 ? 'high' : strength >= 5 ? 'medium' : 'low');

// The record: wins, losses and pushes overall, by level and by kind of bet (a void, a player who didn't
// play, doesn't count)
export function record(ledger) {
  const tally = () => ({ wins: 0, losses: 0, pushes: 0 });
  const add = (t, result) => {
    if (result === 'win') t.wins++;
    else if (result === 'loss') t.losses++;
    else if (result === 'push') t.pushes++;
  };
  const overall = tally();
  const byLevel = { high: tally(), medium: tally(), low: tally() };
  const byKind = {};
  let graded = 0;
  for (const games of Object.values(ledger.weeks ?? {})) {
    for (const game of Object.values(games)) {
      for (const p of game.picks) {
        if (!['win', 'loss', 'push'].includes(p.result)) continue;
        graded++;
        add(overall, p.result);
        add(byLevel[levelOf(p.strength)], p.result);
        add((byKind[p.grade?.kind ?? 'other'] ??= tally()), p.result);
      }
    }
  }
  const pct = (t) => ({ ...t, winPct: t.wins + t.losses ? Math.round((1000 * t.wins) / (t.wins + t.losses)) / 10 : null });
  return {
    graded,
    overall: pct(overall),
    byLevel: Object.fromEntries(Object.entries(byLevel).map(([k, t]) => [k, pct(t)])),
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, t]) => [k, pct(t)])),
  };
}
