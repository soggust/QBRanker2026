// The generated data the apps serve (apps/<sport>/src/StaticData, written by the nightly workflows):
// every file parses; a season's playoffs (.post) and whole-season (.all) files come in pairs, have the
// same tabs as its regular season and the same fields in their rows; the sport's other per-part files
// (SPORT.seasonPartFiles) are there wherever its playoffs are; and the model desk's ledger and state
// read, every bet with the fields the desk needs (more fields are fine: the model keeps adding them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SPORTS, expandRows, loadEngine, readJson, staticDir } from './support/engine.mjs';

// Every .json under a folder
function jsonFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

// A sport's season folders: the current season's at the top of StaticData, the finished ones in seasons/
function seasonDirs(sport) {
  const root = staticDir(sport);
  const seasons = path.join(root, 'seasons');
  const past = fs.existsSync(seasons) ? fs.readdirSync(seasons).filter((d) => /^\d{4}$/.test(d)).map((d) => path.join(seasons, d)) : [];
  return [root, ...past];
}
const isCurrent = (dir) => path.basename(dir) === 'StaticData';
const label = (sport, dir) => `${sport} ${isCurrent(dir) ? 'current' : path.basename(dir)}`;

// A row's fields: its own, and the keys inside its stat blocks (stats.passYards)
const BLOCKS = new Set(['stats', 'box', 'advanced']);
const fieldsOf = (row) =>
  Object.entries(row).flatMap(([key, value]) =>
    BLOCKS.has(key) && value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).map((k) => `${key}.${k}`) : [key],
  );
// ...that every row of a tab has
function commonFields(rows) {
  let common = null;
  for (const row of rows) {
    const own = new Set(fieldsOf(row));
    common = common ? new Set([...common].filter((f) => own.has(f))) : own;
  }
  return common ?? new Set();
}

// Fields a row has only sometimes: an injury (a playoff list may have nobody hurt)
const OPTIONAL = new Set(['injured', 'injuryStatus']);
// Recent form, which a finished season's regular-season file leaves out (the app shows Recent for the
// season being played only) and its playoff files keep
const RECENT = /^(team)?[lL]astFive(Vs|Ot)?$/;

for (const sport of SPORTS) {
  test(`${sport}: every JSON file under StaticData parses`, () => {
    const files = jsonFiles(staticDir(sport));
    assert.ok(files.length > 0, `${sport}: no data files`);
    for (const file of files) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        assert.fail(`${sport}: ${path.relative(staticDir(sport), file)} doesn't parse: ${err.message}`);
      }
    }
  });

  test(`${sport}: season parts (.post / .all) are complete and match the regular season`, async () => {
    // (the sport's own per-part files: SPORT.seasonPartFiles, keys of SPORT.dataFiles)
    const { SPORT } = await loadEngine(sport);
    const partFiles = (SPORT.seasonPartFiles ?? []).map((key) => {
      assert.ok(SPORT.dataFiles?.[key], `${sport}: seasonPartFiles names ${key}, which isn't in dataFiles`);
      return SPORT.dataFiles[key];
    });

    for (const dir of seasonDirs(sport)) {
      const where = label(sport, dir);
      const names = new Set(fs.readdirSync(dir));
      // No .post without its .all, or the other way round (and never without the regular season's)
      for (const name of names) {
        const m = name.match(/^(.*)\.(post|all)\.json$/);
        if (!m) continue;
        const other = `${m[1]}.${m[2] === 'post' ? 'all' : 'post'}.json`;
        assert.ok(names.has(other), `${where}: ${name} without ${other}`);
        assert.ok(names.has(`${m[1]}.json`), `${where}: ${name} without ${m[1]}.json`);
      }
      if (!names.has('skill-players.post.json')) continue;

      for (const file of partFiles) {
        for (const part of ['post', 'all']) {
          const name = file.replace(/\.json$/, `.${part}.json`);
          assert.ok(names.has(name), `${where}: has its playoffs but no ${name} (SPORT.seasonPartFiles)`);
        }
      }

      const regular = expandRows(readJson(path.join(dir, 'skill-players.json')));
      for (const part of ['post', 'all']) {
        const rows = expandRows(readJson(path.join(dir, `skill-players.${part}.json`)));
        assert.deepEqual(Object.keys(rows).sort(), Object.keys(regular).sort(), `${where}: skill-players.${part}.json's tabs differ from skill-players.json's`);
        for (const [tab, regRows] of Object.entries(regular)) {
          assert.ok(Array.isArray(rows[tab]), `${where} ${part} ${tab}: not a list of rows`);
          // Every field each regular-season row has, each row of the part has
          const need = [...commonFields(regRows)].filter((f) => !OPTIONAL.has(f));
          for (const row of rows[tab]) {
            const own = new Set(fieldsOf(row));
            const missing = need.filter((f) => !own.has(f));
            assert.deepEqual(missing, [], `${where} ${part} ${tab}: ${row.name ?? row.gsisId} is missing ${missing.join(', ')}`);
          }
          // ...and the part has no field (in every row) that the regular season never has
          if (!rows[tab].length || !regRows.length) continue;
          const regAny = new Set(regRows.flatMap(fieldsOf));
          const finished = !isCurrent(dir);
          const extra = [...commonFields(rows[tab])].filter(
            (f) => !regAny.has(f) && !(finished && RECENT.test(f)),
          );
          assert.deepEqual(extra, [], `${where} ${part} ${tab}: has ${extra.join(', ')}, which skill-players.json doesn't`);
        }
      }
    }
  });
}

// The model desk (libs/ranker/scripts/model/run.mjs writes these): only the fields the desk and its page
// rely on are required, so the model can add more
const STATUSES = new Set(['open', 'won', 'lost', 'push']);
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

for (const sport of SPORTS) {
  const dir = path.join(staticDir(sport), 'model');
  if (!fs.existsSync(dir)) continue;
  test(`${sport}: model ledger and state parse, and every bet is whole`, () => {
    const statePath = path.join(dir, 'state.json');
    if (fs.existsSync(statePath)) {
      const state = readJson(statePath);
      assert.ok(state && typeof state === 'object' && !Array.isArray(state), 'state.json is not an object');
      if ('sport' in state) assert.equal(state.sport, sport);
    }
    const ledgerPath = path.join(dir, 'ledger.json');
    if (!fs.existsSync(ledgerPath)) return;
    const ledger = readJson(ledgerPath);
    assert.ok(Array.isArray(ledger.bets), 'ledger.json has no bets list');
    if ('sport' in ledger) assert.equal(ledger.sport, sport);
    if ('bankroll' in ledger) assert.ok(Number.isFinite(ledger.bankroll), 'bankroll');
    const ids = new Set();
    for (const bet of ledger.bets) {
      const at = `${sport} bet ${bet?.id}`;
      assert.equal(typeof bet.id, 'string', `${at}: id`);
      assert.ok(!ids.has(bet.id), `${at}: id placed twice`);
      ids.add(bet.id);
      assert.equal(typeof bet.event, 'string', `${at}: event`);
      assert.equal(bet.sport, sport, `${at}: sport`);
      assert.ok(isDate(bet.start), `${at}: start ${bet.start}`);
      if ('placedAt' in bet) assert.ok(isDate(bet.placedAt), `${at}: placedAt ${bet.placedAt}`);
      for (const key of ['matchup', 'market', 'side', 'pick']) assert.equal(typeof bet[key], 'string', `${at}: ${key}`);
      assert.ok(bet.line === null || Number.isFinite(bet.line), `${at}: line ${bet.line}`);
      assert.ok(Number.isFinite(bet.odds), `${at}: odds ${bet.odds}`);
      assert.ok(Number.isFinite(bet.units) && bet.units > 0, `${at}: units ${bet.units}`);
      for (const key of ['model', 'fair', 'p', 'ev']) if (key in bet) assert.ok(Number.isFinite(bet[key]), `${at}: ${key} ${bet[key]}`);
      assert.ok(STATUSES.has(bet.status), `${at}: status ${bet.status}`);
      assert.ok(Number.isFinite(bet.profit), `${at}: profit ${bet.profit}`);
      if (bet.status === 'open') assert.equal(bet.profit, 0, `${at}: an open bet with a profit`);
      if (bet.market === 'prop') for (const key of ['player', 'propType']) assert.equal(typeof bet[key], 'string', `${at}: ${key}`);
    }
  });

  // The public Bets page's picks (libs/ranker/scripts/model/picks.mjs): the algorithm's top bets, ranked
  test(`${sport}: model picks are whole and ranked`, () => {
    const picksPath = path.join(dir, 'picks.json');
    if (!fs.existsSync(picksPath)) return;
    const file = readJson(picksPath);
    assert.ok(isDate(file.at), 'picks.json: at');
    assert.ok(Array.isArray(file.picks), 'picks.json: no picks list');
    if (file.record) for (const key of ['overall', 'byLevel']) assert.ok(file.record[key], `picks.json: record.${key}`);
    const KINDS = new Set(['spread', 'total', 'team_total', 'moneyline', 'player', 'team_stat']);
    // (the bands, by the Kelly score: a lock above them all; picks.mjs BANDS)
    const LEVELS = new Set(['lock', 'high', 'medium', 'low']);
    let last = Infinity;
    for (const [i, p] of file.picks.entries()) {
      const at = `${sport} pick ${i + 1}`;
      assert.equal(p.sport, sport, `${at}: sport`);
      for (const key of ['id', 'pick', 'matchup', 'market', 'book', 'reason']) assert.equal(typeof p[key], 'string', `${at}: ${key}`);
      assert.ok(KINDS.has(p.kind), `${at}: kind ${p.kind}`);
      assert.ok(LEVELS.has(p.level), `${at}: level ${p.level}`);
      // (a Kelly score: 0 or under for a pick with no edge on its price; files before it, the chance)
      assert.ok(Number.isFinite(p.score), `${at}: score ${p.score}`);
      assert.ok(p.score <= last, `${at}: not in score order`);
      last = p.score;
      assert.ok(Number.isFinite(p.odds), `${at}: odds`);
      assert.ok(isDate(p.start), `${at}: start`);
      assert.ok(Array.isArray(p.teams) && p.teams.length === 2, `${at}: teams`);
    }
  });
}

// The game view's kept highlights (libs/ranker/scripts/highlights.mjs writes StaticData/highlights/<season>.json):
// each game's a list of clips, and every clip has something to play (a YouTube id or a video file) and a title
for (const sport of SPORTS) {
  const dir = path.join(staticDir(sport), 'highlights');
  if (!fs.existsSync(dir)) continue;
  test(`${sport}: kept highlights are whole`, () => {
    for (const name of fs.readdirSync(dir)) {
      assert.match(name, /^\d{4}\.json$/, `${sport} highlights: ${name} isn't a season's file`);
      const kept = readJson(path.join(dir, name));
      assert.ok(kept && typeof kept === 'object' && !Array.isArray(kept), `${sport} highlights/${name}: not an object`);
      for (const [id, clips] of Object.entries(kept)) {
        const at = `${sport} highlights/${name} game ${id}`;
        assert.match(id, /^\d+$/, `${at}: not an ESPN event id`);
        assert.ok(Array.isArray(clips) && clips.length, `${at}: no clips`);
        for (const c of clips) {
          assert.equal(typeof c.title, 'string', `${at}: a clip without a title`);
          assert.ok((typeof c.youtube === 'string' && c.youtube) || (typeof c.src === 'string' && c.src), `${at}: "${c.title}" has no YouTube id or video file`);
          assert.ok(c.duration === null || Number.isFinite(c.duration), `${at}: "${c.title}" duration ${c.duration}`);
        }
      }
    }
  });
}
