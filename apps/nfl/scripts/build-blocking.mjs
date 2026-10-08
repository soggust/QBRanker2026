// Blocking reads from who was on the field each play (nflverse participation, published after each
// season: 2016 on). For every RB, WR and TE: how many of his team's designed runs he was on the field
// for without carrying the ball, out of the team's runs in the games he played, and how those runs
// went with him on and off the field; and (for backs' pass protection) how often the QB was pressured
// on dropbacks with him on and off. Run after a season's participation data comes out:
// `npm run build-blocking`, then `npm run build-comps`.
//
// seasons/<year>/blocking.json: gsisId -> [runs on the field, team runs in his games, EPA per carry
// with him on, success rate with him on, runs off the field, EPA per carry with him off, success off,
// his offensive snaps (runs and passes), the team's snaps in his games, dropbacks on the field, QB
// pressured on those, dropbacks off the field, pressured on those]. Snaps give his run tilt: how much
// more of his snaps were runs than his team's play mix (a blocking role).
//
// The table gets Run Block EPA (WRs, TEs: runs with him on minus off) and Pass Pro (RBs: pressure rate
// on dropbacks with him on minus off, in percentage points, lower is better), each once he sat for at
// least 40 of those plays.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SEASONS_DIR = path.join(ROOT, 'src/StaticData/seasons');
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const FIRST = 2016;
const POSITIONS = ['RB', 'WR', 'TE'];

// A CSV parser that keeps only the columns asked for (play-by-play has 370 of them)
function parseCsv(text, wanted) {
  const out = [];
  let row = [];
  let field = '';
  let quoted = false;
  let header = null;
  let keep = null;
  const flush = () => {
    if (!header) {
      header = row;
      keep = wanted.map((name) => header.indexOf(name));
    } else if (row.length > 1) {
      const obj = {};
      wanted.forEach((name, i) => (obj[name] = row[keep[i]]));
      out.push(obj);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      flush();
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    flush();
  }
  return out;
}

// (a finished season's files don't change: kept in .cache/nflverse, shared with update-data.mjs)
const CACHE = path.resolve(ROOT, '../../.cache/nflverse');
async function fetchText(url, gz) {
  const cached = path.join(CACHE, url.split('/').pop());
  let buf;
  if (fs.existsSync(cached)) buf = fs.readFileSync(cached);
  else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, buf);
  }
  return gz ? gunzipSync(buf).toString() : buf.toString();
}

// The parts of a season filled in (update-data.mjs: the regular season's skill-players.json, the
// playoffs' skill-players.post.json, both's .all.json; PART=post,all for only those), each from its
// own plays. blocking.json, the card's detail, is the regular season's.
const PARTS = (process.env.PART ?? 'regular,post,all').split(',').map((part) => part.trim());
const PART_FILES = { regular: 'skill-players.json', post: 'skill-players.post.json', all: 'skill-players.all.json' };
const inPart = (part, seasonType) => part === 'all' || (part === 'regular') === (seasonType === 'REG');

const round = (v, d = 3) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

const seasons = fs
  .readdirSync(SEASONS_DIR)
  .filter((dir) => /^\d{4}$/.test(dir) && Number(dir) >= FIRST)
  .map(Number)
  .sort((a, b) => a - b);

for (const season of seasons) {
  let pbp, participation;
  try {
    [pbp, participation] = await Promise.all([
      fetchText(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`, true).then((t) =>
        parseCsv(t, ['game_id', 'play_id', 'season_type', 'posteam', 'play_type', 'qb_scramble', 'qb_dropback', 'rusher_player_id', 'epa', 'success', 'two_point_attempt']),
      ),
      fetchText(`${NFLVERSE}/pbp_participation/pbp_participation_${season}.csv`, false).then((t) =>
        parseCsv(t, ['nflverse_game_id', 'play_id', 'possession_team', 'offense_players', 'was_pressure']),
      ),
    ]);
  } catch (err) {
    console.warn(`${season}: skipped (${err.message})`);
    continue;
  }

  for (const part of PARTS) {
    const file = path.join(SEASONS_DIR, String(season), PART_FILES[part]);
    if (!fs.existsSync(file)) continue;
    // The RBs, WRs and TEs the app lists that season
    const units = JSON.parse(fs.readFileSync(file, 'utf8'));
    const tracked = new Set(POSITIONS.flatMap((pos) => (units[pos] ?? []).map((u) => u.gsisId)));

    const onField = new Map(participation.map((p) => [`${p.nflverse_game_id}.${p.play_id}`, p.offense_players?.split(';') ?? []]));
    const pressured = new Set(participation.filter((p) => p.was_pressure === 'TRUE').map((p) => `${p.nflverse_game_id}.${p.play_id}`));
    // Games each player was on the field for (by team), so a team's runs only count in his games
    const gamesOf = new Map();
    for (const p of participation) {
      for (const id of p.offense_players?.split(';') ?? []) {
        if (!tracked.has(id)) continue;
        if (!gamesOf.has(id)) gamesOf.set(id, new Set());
        gamesOf.get(id).add(`${p.nflverse_game_id}.${p.possession_team}`);
      }
    }

    // Designed runs (no scrambles or two-point tries), by game and team; and every run or pass play
    const runs = new Map();
    const plays = new Map();
    // Dropbacks (passes, sacks, scrambles), with whether the QB was pressured
    const dropbacks = new Map();
    for (const play of pbp) {
      if (inPart(part, play.season_type) && play.qb_dropback === '1' && play.two_point_attempt !== '1') {
        const id = `${play.game_id}.${play.play_id}`;
        const players = onField.get(id);
        if (players?.length) {
          const key = `${play.game_id}.${play.posteam}`;
          if (!dropbacks.has(key)) dropbacks.set(key, []);
          dropbacks.get(key).push({ players: new Set(players), pressure: pressured.has(id) ? 1 : 0 });
        }
      }
      if (inPart(part, play.season_type) && (play.play_type === 'run' || play.play_type === 'pass') && play.two_point_attempt !== '1') {
        const players = onField.get(`${play.game_id}.${play.play_id}`);
        if (players?.length) {
          const key = `${play.game_id}.${play.posteam}`;
          if (!plays.has(key)) plays.set(key, []);
          plays.get(key).push(new Set(players));
        }
      }
      if (!inPart(part, play.season_type) || play.play_type !== 'run' || play.qb_scramble === '1' || play.two_point_attempt === '1') continue;
      const players = onField.get(`${play.game_id}.${play.play_id}`);
      if (!players?.length) continue;
      const key = `${play.game_id}.${play.posteam}`;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key).push({ players: new Set(players), rusher: play.rusher_player_id, epa: Number(play.epa) || 0, success: play.success === '1' ? 1 : 0 });
    }

    const out = {};
    for (const [id, games] of gamesOf) {
      let on = 0, off = 0, epaOn = 0, epaOff = 0, sOn = 0, sOff = 0;
      for (const game of games) {
        for (const run of runs.get(game) ?? []) {
          if (run.rusher === id) continue;
          if (run.players.has(id)) {
            on++;
            epaOn += run.epa;
            sOn += run.success;
          } else {
            off++;
            epaOff += run.epa;
            sOff += run.success;
          }
        }
      }
      if (on + off < 20) continue;
      let snaps = 0, teamSnaps = 0;
      for (const game of games) {
        for (const players of plays.get(game) ?? []) {
          teamSnaps++;
          if (players.has(id)) snaps++;
        }
      }
      let dbOn = 0, prOn = 0, dbOff = 0, prOff = 0;
      for (const game of games) {
        for (const db of dropbacks.get(game) ?? []) {
          if (db.players.has(id)) {
            dbOn++;
            prOn += db.pressure;
          } else {
            dbOff++;
            prOff += db.pressure;
          }
        }
      }
      out[id] = [on, on + off, round(on ? epaOn / on : null), round(on ? sOn / on : null), off, round(off ? epaOff / off : null), round(off ? sOff / off : null), snaps, teamSnaps, dbOn, prOn, dbOff, prOff];
    }
    if (part === 'regular') fs.writeFileSync(path.join(SEASONS_DIR, String(season), 'blocking.json'), JSON.stringify(out));

    // The table's Run Block EPA (WRs, TEs) and Pass Pro (RBs), written into the season's player lists;
    // run build-comps afterwards so its per-tab files pick them up
    let runFilled = 0;
    let passFilled = 0;
    for (const pos of POSITIONS) {
      for (const unit of units[pos] ?? []) {
        const row = out[unit.gsisId];
        if (pos === 'RB') {
          delete unit.stats.runBlockEpa;
          const value = row && row[11] >= 40 && row[9] >= 40 ? round((row[10] / row[9] - row[12] / row[11]) * 100, 1) : null;
          unit.stats.passProPct = value;
          if (value !== null) passFilled++;
        } else {
          const value = row && row[4] >= 40 && row[2] !== null && row[5] !== null ? round(row[2] - row[5]) : null;
          unit.stats.runBlockEpa = value;
          if (value !== null) runFilled++;
        }
      }
    }
    fs.writeFileSync(file, JSON.stringify(units));
    console.log(`${season} ${part}: ${Object.keys(out).length} players, ${runFilled} with Run Block EPA, ${passFilled} RBs with Pass Pro`);
  }
}

// This season has no participation data yet: empty values keep those columns hidden (the nightly
// update writes them empty too)
const currentFile = path.join(SEASONS_DIR, '..', 'skill-players.json');
const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
for (const pos of POSITIONS) {
  for (const unit of current[pos] ?? []) {
    if (pos === 'RB') {
      delete unit.stats.runBlockEpa;
      unit.stats.passProPct ??= null;
    } else unit.stats.runBlockEpa ??= null;
  }
}
fs.writeFileSync(currentFile, JSON.stringify(current));
