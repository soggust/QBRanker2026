// Fields the data scripts carry for the player card's skills (apps/<sport>/scripts/update-data.mjs):
// - NBA: Defensive Win Shares (stats.dws), in every season and part; both parts' (.all) the regular
//   season's and the playoffs' added up
// - NHL: faceoffs taken (stats.faceoffs) on every skater, behind Faceoff % (50+ of them)
// - MMA: the KO/TKO share of his wins (stats.koShare), and the strike and grappling stats of fighters ESPN's
//   athlete stats come back empty for (Francis Ngannou's: the core API's fight by fight)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expandRows, readJson, staticDir } from './support/engine.mjs';

// A sport's season folders: the current season's, then the finished ones
function seasonDirs(sport) {
  const root = staticDir(sport);
  const seasons = path.join(root, 'seasons');
  const past = fs.existsSync(seasons) ? fs.readdirSync(seasons).filter((d) => /^\d{4}$/.test(d)).map((d) => path.join(seasons, d)) : [];
  return [root, ...past];
}
const where = (dir) => (path.basename(dir) === 'StaticData' ? 'current' : path.basename(dir));
const PARTS = ['skill-players.json', 'skill-players.post.json', 'skill-players.all.json'];
const parts = (dir) => PARTS.filter((f) => fs.existsSync(path.join(dir, f))).map((f) => [f, expandRows(readJson(path.join(dir, f)))]);

test('nba: every player row has Defensive Win Shares, and both parts add the two up', () => {
  const TABS = ['PG', 'SG', 'SF', 'PF', 'C'];
  for (const dir of seasonDirs('nba')) {
    const byPart = {};
    for (const [file, data] of parts(dir)) {
      const rows = TABS.flatMap((tab) => data[tab] ?? []);
      assert.ok(rows.length, `nba ${where(dir)} ${file}: no players`);
      for (const u of rows) {
        assert.ok('dws' in u.stats, `nba ${where(dir)} ${file}: ${u.name} has no dws`);
        const v = u.stats.dws;
        assert.ok(v === null || (Number.isFinite(v) && v >= -3 && v <= 20), `nba ${where(dir)} ${file}: ${u.name}'s dws ${v}`);
      }
      const known = rows.filter((u) => u.stats.dws !== null).length;
      assert.ok(known >= rows.length * 0.95, `nba ${where(dir)} ${file}: dws for only ${known} of ${rows.length}`);
      // (a full season's leader: a few wins at least)
      if (file === 'skill-players.json') assert.ok(Math.max(...rows.map((u) => u.stats.dws ?? 0)) >= 2, `nba ${where(dir)}: no one with 2+ dws`);
      byPart[file] = new Map(rows.map((u) => [u.gsisId, u.stats.dws]));
    }
    const [reg, post, all] = PARTS.map((f) => byPart[f]);
    if (!post || !all) continue;
    for (const [id, v] of all) {
      if (v === null || reg.get(id) == null) continue;
      const expected = reg.get(id) + (post.get(id) ?? 0);
      assert.ok(Math.abs(v - expected) < 0.15, `nba ${where(dir)}: ${id}'s dws in both parts ${v}, not ${expected}`);
    }
  }
});

test('nhl: every skater row has the faceoffs he took, and Faceoff % only with 50+', () => {
  for (const dir of seasonDirs('nhl')) {
    for (const [file, data] of parts(dir)) {
      const rows = ['C', 'LW', 'RW', 'D'].flatMap((tab) => data[tab] ?? []);
      for (const u of rows) {
        const f = u.stats.faceoffs;
        assert.ok(Number.isInteger(f) && f >= 0, `nhl ${where(dir)} ${file}: ${u.name}'s faceoffs ${f}`);
        if (u.stats.faceoffPct !== null) assert.ok(f >= 50, `nhl ${where(dir)} ${file}: ${u.name} has a Faceoff % from ${f} faceoffs`);
        // (no more than a game's worth of draws a game, and the most any center takes is about 30)
        assert.ok(f <= 40 * u.games, `nhl ${where(dir)} ${file}: ${u.name} took ${f} faceoffs in ${u.games} games`);
      }
      // (the centers take them: one with a few hundred in a whole regular season)
      if (file === 'skill-players.json' && path.basename(dir) !== 'StaticData') {
        assert.ok(Math.max(...(data.C ?? []).map((u) => u.stats.faceoffs)) >= 500, `nhl ${where(dir)}: no center with 500+ faceoffs`);
      }
    }
  }
});

test('mma: the KO/TKO share of his wins, and the strike stats of every fighter with stats', () => {
  const data = expandRows(readJson(path.join(staticDir('mma'), 'skill-players.json')));
  const rows = Object.values(data).flat();
  assert.ok(rows.length > 100, 'mma: no fighters');
  for (const u of rows) {
    const { koShare, finishRate } = u.stats;
    assert.ok(koShare === null || (koShare >= 0 && koShare <= 1), `mma: ${u.name}'s koShare ${koShare}`);
    // (a KO is a finish: never more of them than finishes)
    if (koShare !== null) assert.ok(finishRate !== null && koShare <= finishRate + 1e-9, `mma: ${u.name}'s koShare ${koShare} over his Finish % ${finishRate}`);
  }
  const knockouts = rows.filter((u) => u.stats.koShare > 0).length;
  assert.ok(knockouts > rows.length * 0.3, `mma: only ${knockouts} of ${rows.length} with a KO win`);

  // Ngannou: ESPN's athlete stats come back empty for him; his fights' stats come from the core API
  const ngannou = rows.find((u) => u.name === 'Francis Ngannou');
  assert.ok(ngannou, 'mma: Francis Ngannou is listed');
  for (const key of ['slpm', 'strAcc', 'kd15', 'td15', 'sub15', 'adv15']) assert.ok(Number.isFinite(ngannou.stats[key]), `mma: Ngannou's ${key} is ${ngannou.stats[key]}`);
  assert.ok(ngannou.stats.koShare >= 0.5, `mma: Ngannou's koShare ${ngannou.stats.koShare}`);

  // ...and anyone with 3+ fights' stats has his strikes landed per minute (15+ minutes of them): the few
  // without are fighters whose stats ESPN has only from the other side
  const withStats = rows.filter((u) => u.statFights >= 3);
  const missing = withStats.filter((u) => u.stats.slpm === null);
  assert.ok(missing.length <= withStats.length * 0.1, `mma: ${missing.length} of ${withStats.length} fighters with 3+ stat fights have no strikes per minute (${missing.slice(0, 5).map((u) => u.name).join(', ')}...)`);
});
