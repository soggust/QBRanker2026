// The card's Field Map: where each player's plays went on the field, from nflverse's play-by-play. A
// quarterback's throws by zone (behind the line, short, intermediate, deep; left, middle, right) and his
// designed runs by lane; a receiver's or back's targets by the same zones, a back's carries by lane (the
// ends, tackles and guards on each side, and the middle); a kicker's field goals by distance and his extra
// points; a punter's punts (gross, net, inside the 20, touchbacks, fair catches, by distance); and each
// defense's, what it allowed by zone and lane. The league's pooled the same way, what "average" is. One
// file per season: StaticData/field-maps.json for the season being played, StaticData/seasons/<year>/ for
// past ones, each with the regular season, the playoffs (null until they've begun) and both. Free: no AI.
//
//   node apps/nfl/scripts/build-field-maps.mjs              (the season being played: nightly, after update-data)
//   node apps/nfl/scripts/build-field-maps.mjs 2000-2025    (past seasons: once; a finished season doesn't change)
//
// Keys, as the card has its rows: the players by their gsisId (skill-players.json's RB, WR, TE, K and P
// rows), the quarterbacks by their ESPN id (games.json's id: players.csv's espn_id to the play-by-play's
// passer), the defenses "DEF-ARI". Only the rows the season's files have are kept (the file stays small).
// nflverse's pass_location and air_yards start in 2006 (earlier seasons: the zones all empty, the runs
// and kicks still there).

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRetry } from '../../../libs/ranker/scripts/fetch.mjs';
import { currentSeason } from '../../../libs/ranker/scripts/wiki-staff.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CACHE = path.join(ROOT, '.cache/nflverse');
const DATA = path.join(ROOT, 'apps/nfl/src/StaticData');
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
// (fresh enough: the nightly run downloads the season being played again; a past season's never change)
const FRESH_HOURS = 6;

// ---- the field's parts, in the contract's fixed orders
export const DEPTHS = ['behind', 'short', 'mid', 'deep'];
export const SIDES = ['left', 'middle', 'right'];
export const LANES = ['left end', 'left tackle', 'left guard', 'middle', 'right guard', 'right tackle', 'right end'];
export const FG_BANDS = ['<30', '30-39', '40-49', '50-59', '60+'];
export const PUNT_BANDS = ['<40', '40-49', '50-59', '60+'];
// Earlier seasons' abbreviations for teams that moved, as today's (update-data.mjs's sameTeamAbbrs)
const MOVED_TEAMS = { OAK: 'LV', SD: 'LAC', STL: 'LA' };

// (the play-by-play's columns this reads)
export const COLUMNS = [
  'season_type', 'play_type', 'posteam', 'defteam', 'pass_attempt', 'sack', 'two_point_attempt', 'pass_location', 'air_yards',
  'complete_pass', 'passing_yards', 'yards_gained', 'pass_touchdown', 'interception', 'epa', 'passer_player_id',
  'receiver_player_id', 'rusher_player_id', 'run_location', 'run_gap', 'rushing_yards', 'rush_touchdown', 'qb_scramble',
  'qb_kneel', 'field_goal_result', 'kick_distance', 'kicker_player_id', 'extra_point_result', 'punter_player_id',
  'punt_inside_twenty', 'touchback', 'punt_fair_catch', 'punt_blocked', 'return_yards',
];

const num = (v) => (v === undefined || v === null || v === '' || v === 'NA' ? null : Number(v));
const yes = (v) => v === '1' || v === 1 || v === true;
const id = (v) => (v && v !== 'NA' ? v : null);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// A zone's place in the 12 (depth-major, then side), or -1: no location or air yards
export function zoneIndex(airYards, location) {
  const ay = num(airYards);
  const side = SIDES.indexOf(location);
  if (ay === null || side < 0) return -1;
  const depth = ay < 0 ? 0 : ay < 10 ? 1 : ay < 20 ? 2 : 3;
  return depth * 3 + side;
}

// A lane's place in the 7, or -1: the middle has no gap; a left or right run without one isn't placed
export function laneIndex(location, gap) {
  if (location === 'middle') return 3;
  if (location !== 'left' && location !== 'right') return -1;
  const g = ['end', 'tackle', 'guard'].indexOf(gap);
  if (g < 0) return -1;
  return location === 'left' ? g : 6 - g;
}

export function fgBand(distance) {
  const d = num(distance);
  if (d === null) return -1;
  return d < 30 ? 0 : d < 40 ? 1 : d < 50 ? 2 : d < 60 ? 3 : 4;
}

export function puntBand(distance) {
  const d = num(distance);
  if (d === null) return -1;
  return d < 40 ? 0 : d < 50 ? 1 : d < 60 ? 2 : 3;
}

// ---- the tallies (sums while counting; finished into the contract's shapes at the end)
const newZones = () => DEPTHS.flatMap((depth) => SIDES.map((side) => ({ depth, side, att: 0, comp: 0, yds: 0, td: 0, int: 0, epa: 0 })));
const newLanes = () => LANES.map((lane) => ({ lane, att: 0, yds: 0, td: 0, epa: 0, success: 0 }));
const newBands = () => FG_BANDS.map((band) => ({ band, att: 0, made: 0 }));
const newPunt = () => ({ n: 0, kicked: 0, gross: 0, net: 0, inside20: 0, touchbacks: 0, fairCatches: 0, blocked: 0, bands: PUNT_BANDS.map((band) => ({ band, n: 0 })) });

function addPass(z, play) {
  z.att++;
  if (yes(play.complete_pass)) {
    z.comp++;
    z.yds += num(play.passing_yards) ?? num(play.yards_gained) ?? 0;
  }
  if (yes(play.pass_touchdown)) z.td++;
  if (yes(play.interception)) z.int++;
  z.epa += num(play.epa) ?? 0;
}
function addRun(l, play) {
  const epa = num(play.epa) ?? 0;
  l.att++;
  l.yds += num(play.rushing_yards) ?? num(play.yards_gained) ?? 0;
  if (yes(play.rush_touchdown)) l.td++;
  l.epa += epa;
  if (epa > 0) l.success++;
}
function addPunt(p, play) {
  p.n++;
  if (yes(play.punt_blocked)) {
    p.blocked++;
    return;
  }
  const gross = num(play.kick_distance);
  if (gross === null) return;
  const tb = yes(play.touchback);
  p.kicked++;
  p.gross += gross;
  // (the NFL's net: the kick, less the return, less 20 for a touchback)
  p.net += gross - (num(play.return_yards) ?? 0) - (tb ? 20 : 0);
  if (yes(play.punt_inside_twenty)) p.inside20++;
  if (tb) p.touchbacks++;
  if (yes(play.punt_fair_catch)) p.fairCatches++;
  p.bands[puntBand(gross)].n++;
}

// One part's plays (already that part's: REG, POST or both) tallied: the league's, each player's (by the
// play-by-play's gsis id) and each defense's (by its abbreviation). Plays are the play-by-play's rows (strings,
// as read) or the same with numbers.
export function tally(plays) {
  const league = { pass: newZones(), runs: newLanes(), fg: newBands(), xp: { att: 0, made: 0 }, punt: newPunt() };
  const players = new Map();
  const defenses = new Map();
  const player = (pid) => {
    if (!players.has(pid)) players.set(pid, {});
    return players.get(pid);
  };
  const defense = (team) => {
    if (!defenses.has(team)) defenses.set(team, { pass: newZones(), runs: newLanes() });
    return defenses.get(team);
  };
  for (const play of plays) {
    if (yes(play.two_point_attempt)) continue;
    const type = play.play_type;
    const def = MOVED_TEAMS[play.defteam] ?? play.defteam;
    if (type === 'pass' && yes(play.pass_attempt) && !yes(play.sack)) {
      const z = zoneIndex(play.air_yards, play.pass_location);
      if (z < 0) continue;
      addPass(league.pass[z], play);
      if (def && def !== 'NA') addPass(defense(def).pass[z], play);
      const passer = id(play.passer_player_id);
      if (passer) addPass(((player(passer).pass ??= newZones()))[z], play);
      const receiver = id(play.receiver_player_id);
      if (receiver) addPass(((player(receiver).targets ??= newZones()))[z], play);
    } else if (type === 'run' && !yes(play.qb_kneel) && !yes(play.qb_scramble)) {
      const l = laneIndex(play.run_location, play.run_gap);
      if (l < 0) continue;
      addRun(league.runs[l], play);
      if (def && def !== 'NA') addRun(defense(def).runs[l], play);
      const rusher = id(play.rusher_player_id);
      if (rusher) addRun(((player(rusher).runs ??= newLanes()))[l], play);
    } else if (type === 'field_goal') {
      const b = fgBand(play.kick_distance);
      if (b < 0 || !play.field_goal_result || play.field_goal_result === 'NA') continue;
      const made = play.field_goal_result === 'made';
      const add = (bands) => {
        bands[b].att++;
        if (made) bands[b].made++;
      };
      add(league.fg);
      const kicker = id(play.kicker_player_id);
      if (kicker) add((player(kicker).fg ??= newBands()));
    } else if (type === 'extra_point') {
      const r = play.extra_point_result;
      if (!r || r === 'NA' || r === 'aborted') continue;
      const add = (xp) => {
        xp.att++;
        if (r === 'good') xp.made++;
      };
      add(league.xp);
      const kicker = id(play.kicker_player_id);
      if (kicker) add((player(kicker).xp ??= { att: 0, made: 0 }));
    } else if (type === 'punt') {
      addPunt(league.punt, play);
      const punter = id(play.punter_player_id);
      if (punter) addPunt((player(punter).punt ??= newPunt()), play);
    }
  }
  return { league, players, defenses };
}

// ---- finished, packed (a season's file with every zone an object was over a megabyte): each zone, lane
// and band a tuple in the order FIELDS gives (the file carries FIELDS too), in the zones', lanes' and
// bands' fixed orders; EPA and success per attempt to 3dp, yards to 1dp; the punt's averages
export const FIELDS = {
  zone: ['att', 'comp', 'yds', 'td', 'int', 'epa'],
  lane: ['att', 'yds', 'td', 'epa', 'success'],
  band: ['att', 'made'],
  zones: DEPTHS.flatMap((depth) => SIDES.map((side) => `${depth}-${side}`)),
  lanes: LANES,
  fgBands: FG_BANDS,
  puntBands: PUNT_BANDS,
};
const finishZones = (zones) => zones.map((z) => [z.att, z.comp, round(z.yds, 1), z.td, z.int, z.att ? round(z.epa / z.att, 3) : 0]);
const finishLanes = (lanes) =>
  lanes.map((l) => [l.att, round(l.yds, 1), l.td, l.att ? round(l.epa / l.att, 3) : 0, l.att ? round(l.success / l.att, 3) : 0]);
const finishBands = (bands) => bands.map((b) => [b.att, b.made]);
const finishPunt = ({ kicked, gross, net, ...p }) => ({
  n: p.n,
  gross: kicked ? round(gross / kicked, 1) : 0,
  net: kicked ? round(net / kicked, 1) : 0,
  inside20: p.inside20,
  touchbacks: p.touchbacks,
  fairCatches: p.fairCatches,
  blocked: p.blocked,
  bands: p.bands.map((b) => b.n),
});
function finishPlayer(p) {
  const out = {};
  if (p.pass) out.pass = finishZones(p.pass);
  if (p.targets) out.targets = finishZones(p.targets);
  if (p.runs) out.runs = finishLanes(p.runs);
  if (p.fg) out.fg = finishBands(p.fg);
  if (p.xp) out.xp = p.xp;
  if (p.punt) out.punt = finishPunt(p.punt);
  return out;
}

// A part's section, as the contract has it: the tallies keyed the card's way. keys: the gsis ids the
// season's skill-player rows have (kept under themselves), qbs: games.json's QB ids (ESPN) by gsis id,
// teams: the defenses' abbreviations the season has (null: every one).
export function section(plays, { keys = null, qbs = new Map(), teams = null } = {}) {
  const t = tally(plays);
  const players = {};
  for (const [gsis, p] of t.players) {
    if (!keys || keys.has(gsis)) players[gsis] = finishPlayer(p);
    const espn = qbs.get(gsis);
    if (espn) players[espn] = finishPlayer(p);
  }
  const defenses = {};
  for (const [team, d] of [...t.defenses].sort(([a], [b]) => a.localeCompare(b))) {
    if (teams && !teams.has(team)) continue;
    defenses[`DEF-${team}`] = { pass: finishZones(d.pass), runs: finishLanes(d.runs) };
  }
  return {
    league: { pass: finishZones(t.league.pass), runs: finishLanes(t.league.runs), fg: finishBands(t.league.fg), xp: t.league.xp, punt: finishPunt(t.league.punt) },
    players,
    defenses,
  };
}

// ---- reading the play-by-play: only the columns above (a season's file is ~370 columns, 50,000 plays)
export function parsePlays(text, columns = COLUMNS) {
  let i = 0;
  const n = text.length;
  // (one line's fields; quoted ones, the play descriptions, can hold commas and newlines)
  const readRow = () => {
    const row = [];
    while (i < n) {
      let field;
      if (text[i] === '"') {
        let j = i + 1;
        let out = '';
        for (;;) {
          const q = text.indexOf('"', j);
          if (q < 0) {
            out += text.slice(j);
            j = n;
            break;
          }
          out += text.slice(j, q);
          if (text[q + 1] === '"') {
            out += '"';
            j = q + 2;
          } else {
            j = q + 1;
            break;
          }
        }
        field = out;
        i = j;
      } else {
        let j = i;
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
        field = text.slice(i, j);
        i = j;
      }
      row.push(field);
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '\r') i++;
      if (text[i] === '\n') i++;
      break;
    }
    return row;
  };
  const head = readRow();
  const at = columns.map((c) => [c, head.indexOf(c)]).filter(([, k]) => k >= 0);
  const plays = [];
  while (i < n) {
    const row = readRow();
    if (row.length < 2) continue;
    const play = {};
    for (const [c, k] of at) play[c] = row[k];
    plays.push(play);
  }
  return plays;
}

async function download(file, url, current) {
  const to = path.join(CACHE, file);
  if (existsSync(to) && (!current || Date.now() - statSync(to).mtimeMs < FRESH_HOURS * 36e5)) return readFileSync(to);
  // (the big play-by-play files get longer: libs/ranker/scripts/fetch.mjs)
  const body = await fetchRetry(url, { as: 'buffer', attempts: 2, timeout: 300000 });
  mkdirSync(CACHE, { recursive: true });
  if (body.length) writeFileSync(to, body);
  return body;
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

async function buildSeason(season, current, { espnToGsis, byName }) {
  const dir = current ? DATA : path.join(DATA, 'seasons', String(season));
  if (!existsSync(path.join(dir, 'skill-players.json'))) return null;
  const plays = parsePlays(gunzipSync(await download(`play_by_play_${season}.csv.gz`, `${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`, current)).toString());

  // (the rows the season's files have, every part's: who gets a key)
  const keys = new Set();
  const teams = new Set();
  const qbs = new Map();
  // (a QB whose ESPN id players.csv has another of, Shaun Hill's: by his name, among the season's passers)
  const passers = new Set(plays.map((p) => p.passer_player_id));
  const gsisOf = (row) => espnToGsis.get(Number(row.id)) ?? (byName.get(row.name) ?? []).find((g) => passers.has(g));
  for (const suffix of ['', '.post', '.all']) {
    const skill = readJson(path.join(dir, `skill-players${suffix}.json`));
    for (const pos of ['RB', 'WR', 'TE', 'K', 'P']) for (const row of skill?.[pos] ?? []) if (row.gsisId) keys.add(row.gsisId);
    for (const row of skill?.DEF ?? []) teams.add(row.gsisId.replace(/^DEF-/, ''));
    for (const row of readJson(path.join(dir, `games${suffix}.json`)) ?? []) {
      const gsis = gsisOf(row);
      if (gsis) qbs.set(gsis, String(row.id));
    }
  }
  const opts = { keys, qbs, teams };
  const regular = plays.filter((p) => p.season_type === 'REG');
  const post = plays.filter((p) => p.season_type === 'POST');
  const out = {
    season,
    fields: FIELDS,
    updated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    regular: section(regular, opts),
    post: post.length ? section(post, opts) : null,
    all: section(plays, opts),
  };
  const file = path.join(dir, 'field-maps.json');
  // (nothing new: the file as it was, its "updated" too, so a quiet night commits nothing)
  const old = readJson(file);
  if (old && JSON.stringify({ ...old, updated: null }) === JSON.stringify({ ...out, updated: null })) return { file, size: statSync(file).size, same: true };
  writeFileSync(file, JSON.stringify(out));
  return { file, size: statSync(file).size, same: false };
}

async function main() {
  const CURRENT_SEASON = currentSeason(path.join(import.meta.dirname, '..'));
  const arg = process.argv[2];
  const seasons = !arg
    ? [CURRENT_SEASON]
    : arg.includes('-')
      ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number))
      : arg.split(',').map(Number);
  const players = parsePlays(gunzipSync(await download('players.csv.gz', `${NFLVERSE}/players/players.csv.gz`, true)).toString(), ['gsis_id', 'espn_id', 'display_name']);
  const espnToGsis = new Map(players.filter((p) => id(p.espn_id) && id(p.gsis_id)).map((p) => [Number(p.espn_id), p.gsis_id]));
  const byName = new Map();
  for (const p of players) if (id(p.gsis_id) && p.display_name) byName.set(p.display_name, [...(byName.get(p.display_name) ?? []), p.gsis_id]);
  for (const season of seasons) {
    try {
      const r = await buildSeason(season, season === CURRENT_SEASON, { espnToGsis, byName });
      console.log(r ? `${season}: ${r.same ? 'unchanged' : 'written'} (${Math.round(r.size / 1024)} KB)` : `${season}: no season files, skipped`);
    } catch (err) {
      console.log(`${season}: FAILED ${err.message}`);
    }
  }
}

if (process.argv[1] && path.relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
