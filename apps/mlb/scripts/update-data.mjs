// Builds the MLB app's data: every tab's players for a season, from the MLB Stats API (standard and
// sabermetric stats, WAR back to 2000, awards, the injured list) and Baseball Savant (Statcast: expected
// stats, barrels, hard-hit rate, sprint speed, whiffs; 2015 on, so those columns hide for earlier years).
//
// Usage: npm run mlb:update-data                 this season, to src/StaticData/
//        SEASON=2019 npm run mlb:update-data     a finished season, to src/StaticData/seasons/2019/
//        ALL=1 npm run mlb:update-data           every finished season from 2000 to last year
//        PARTS=post,all ...                      only these parts (default: regular,post,all)
//        CACHE=0 ...                             fetch a finished season afresh (not from apps/mlb/.cache)
//
// Writes skill-players.json in the shape the app reads: { C: [...], 1B: [...], ..., SP: [...], RP: [...] },
// each player { id, gsisId, name, teamLogo, teamName, games, stats, awards, injured?, injuryStatus? }.
// gsisId is "H-<id>" for hitters and "P-<id>" for pitchers (a two-way player is on both sides).
//
// Stats From (the app's seasonParts): once a season's postseason has begun, the same rows over its
// playoff games (skill-players.post.json) and over the regular season and playoffs together
// (skill-players.all.json), beside its skill-players.json. Counts are the Stats API's postseason
// numbers (gameType=P), summed with the regular season's for "all"; rates (AVG, OBP, SLG, ERA, WHIP,
// K%...) are recomputed from the summed counts. The sabermetrics endpoint has no postseason, so:
// wOBA from the counts with the season's own linear weights, wRC+ from that wOBA on the season's
// league scale (an average park), FIP with the season's FIP constant (the constants fit to the
// regular season's sabermetrics: leagueConstants). Statcast's from Baseball Savant's search over
// those games (xwOBA, barrel %, hard-hit %, whiff %). WAR, fielding and baserunning runs, xFIP, xERA,
// sprint speed and OAA have no postseason source: null. Teams: record, runs, OPS and ERA over those
// games. A player or team with no playoff games isn't in the .post file.
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { curve } from '../../../libs/ranker/scripts/grades.mjs';
import { blendWithLastSeason } from '../../../libs/ranker/scripts/early-season.mjs';
import { carryForward, previousRows, previousTab, sameSeason } from '../../../libs/ranker/scripts/carry-forward.mjs';
import { fetchRetry } from '../../../libs/ranker/scripts/fetch.mjs';

const CURRENT_SEASON = 2026;
const FIRST_SEASON = 2000;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
// (finished seasons' responses, kept between runs: gitignored)
const CACHE = path.join(ROOT, '.cache');
const API = 'https://statsapi.mlb.com/api/v1';
const SAVANT = 'https://baseballsavant.mlb.com/leaderboard';
const PARTS = (process.env.PARTS ?? 'regular,post,all').split(',').map((p) => p.trim()).filter(Boolean);
// (the postseason's game types: wild card, division series, league championship, World Series)
const POST_TYPES = ['F', 'D', 'L', 'W'];

// Hitters by primary position (outfielders together); pitchers by role
const HITTER_TABS = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'OF', CF: 'OF', RF: 'OF', OF: 'OF', DH: 'DH', TWP: 'DH' };
const TABS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'];

// Awards that show as badges (the Stats API's award ids, both leagues)
const AWARDS = {
  mvp: ['ALMVP', 'NLMVP'],
  cy: ['ALCY', 'NLCY'],
  roy: ['ALROY', 'NLROY'],
  gg: ['ALGG', 'NLGG'],
  ss: ['ALSS', 'NLSS'],
  as: ['ALAS', 'NLAS'],
};

// A few requests at a time (polite to both APIs)
const MAX_REQUESTS = 4;
let active = 0;
const waiting = [];
async function limited(fn) {
  while (active >= MAX_REQUESTS) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// Whether the season being built is a finished one, whose responses can come from the cache
let cacheOn = false;

// A URL's body, with retries (libs/ranker/scripts/fetch.mjs); a finished season's from (and to) the
// cache. Only a body valid() passes is kept (an empty or error answer is asked again next run, not
// read back for good; one kept before this check is passed over the same way).
const filled = (body) => body.trim().length > 0;
async function text(url, valid = filled) {
  const file = cacheOn ? path.join(CACHE, `${createHash('sha1').update(url).digest('hex')}.txt`) : null;
  if (file) {
    const kept = await readFile(file, 'utf8').catch(() => null);
    if (kept !== null && valid(kept)) return kept;
  }
  const body = await limited(() => fetchRetry(url, { backoff: 1500 }));
  if (file && valid(body)) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, body);
  }
  return body;
}

const isJson = (body) => {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
};
const json = async (url) => JSON.parse(await text(url, isJson));
// (a Savant CSV: its header names the player_id column; an error page doesn't)
const isCsv = (body) => /\bplayer_id\b/.test(body.split('\n', 1)[0]);

// A Savant leaderboard CSV as rows keyed by column, by MLBAM id; null when it fails (no CSV came back:
// the columns it gives are then carried from the last good run: carryFailed)
async function savant(url) {
  try {
    const body = (await text(url, isCsv)).replace(/^﻿/, '');
    if (!isCsv(body)) return null;
    const lines = body.trim().split('\n');
    const split = (line) => {
      const out = [];
      let cur = '';
      let quoted = false;
      for (const c of line) {
        if (c === '"') quoted = !quoted;
        else if (c === ',' && !quoted) {
          out.push(cur);
          cur = '';
        } else if (c !== '\r') cur += c;
      }
      out.push(cur);
      return out;
    };
    const head = split(lines[0]);
    const rows = new Map();
    for (const line of lines.slice(1)) {
      const cells = split(line);
      const row = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
      if (row.player_id) rows.set(Number(row.player_id), row);
    }
    return rows;
  } catch {
    return null;
  }
}

// Savant's search over some of a season's games (the leaderboards are the regular season's only),
// a player's totals under the leaderboards' column names: xwOBA, barrels and hard-hit balls per batted
// ball, whiffs per swing
async function savantSearch(season, gameTypes, playerType) {
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=${gameTypes.map((t) => `${t}%7C`).join('')}&hfSea=${season}%7C` +
    `&player_type=${playerType}&group_by=name&min_pitches=0&min_results=0&min_pas=0&sort_col=pitches&sort_order=desc`;
  const rows = await savant(url);
  if (!rows) return null;
  return new Map(
    [...rows].map(([id, r]) => {
      const swings = num(r.swings);
      return [
        id,
        {
          est_woba: r.xwoba,
          brl_percent: r.barrels_per_bbe_percent,
          ev95percent: r.hardhit_percent,
          whiff_percent: swings ? (100 * (num(r.whiffs) ?? 0)) / swings : null,
        },
      ];
    }),
  );
}

const num = (v) => (v === undefined || v === null || v === '' || v === '.---' || v === '-.--' ? null : Number(v));
const round = (v, d = 3) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const ratio = (a, b, d = 3) => (b ? round(a / b, d) : null);
// "180.1" innings (a third per out) -> 180.333
const innings = (ip) => {
  if (ip === undefined || ip === null) return 0;
  const [whole, thirds] = String(ip).split('.');
  return Number(whole) + (Number(thirds ?? 0) || 0) / 3;
};

// Each team's home park run factor (100 = average; higher is friendlier to hitters), a three-year
// rolling average from Baseball Savant's park factors (embedded in its page), by team id; null when
// the page fails (the teams' park factors are then the last good run's: buildSeason)
async function parkFactors(season) {
  try {
    const url = `https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=year&year=${season}&batSide=&stat=index_wOBA&condition=All&rolling=3`;
    const html = await text(url, (body) => /var data = \[/.test(body));
    const match = html.match(/var data = (\[.*?\]);/s);
    if (!match) return null;
    return new Map(JSON.parse(match[1]).map((row) => [Number(row.main_team_id), Number(row.index_runs)]));
  } catch {
    return null;
  }
}

// (gameType: the Stats API's, P the postseason; none: the regular season)
async function statsFor(season, group, type, gameType) {
  const url = `${API}/stats?stats=${type}&group=${group}&season=${season}&sportId=1&playerPool=all&limit=5000${gameType ? `&gameType=${gameType}` : ''}`;
  const splits = (await json(url)).stats?.[0]?.splits ?? [];
  return new Map(splits.map((s) => [s.player.id, s]));
}

// Fielding by MLBAM id, in the field and on the mound apart (a two-way player's fielding is his work
// at his positions): fielding percentage, (putouts + assists) / chances, with 20+ chances in the field
// (fewer says little) or 10+ as a pitcher (a pitcher sees few: a starter maybe 20-40 a season); and
// range factor, (putouts + assists) per 9 innings in the field, with 50+ innings
const outsOf = (innings) => {
  const [whole, thirds = '0'] = String(innings ?? '0').split('.');
  return Number(whole) * 3 + Number(thirds);
};
async function fieldingSplits(season, gameType) {
  const url = `${API}/stats?stats=season&group=fielding&season=${season}&sportId=1&playerPool=all&limit=5000${gameType ? `&gameType=${gameType}` : ''}`;
  return (await json(url)).stats?.[0]?.splits ?? [];
}
function fieldingOf(splits) {
  const totals = new Map();
  for (const s of splits) {
    const t = totals.get(s.player.id) ?? { made: 0, chances: 0, outs: 0, pMade: 0, pChances: 0 };
    const made = (s.stat.putOuts ?? 0) + (s.stat.assists ?? 0);
    const chances = made + (s.stat.errors ?? 0);
    if (s.position?.abbreviation === 'P') {
      totals.set(s.player.id, { ...t, pMade: t.pMade + made, pChances: t.pChances + chances });
    } else {
      totals.set(s.player.id, { ...t, made: t.made + made, chances: t.chances + chances, outs: t.outs + outsOf(s.stat.innings) });
    }
  }
  return new Map(
    [...totals].map(([id, t]) => [
      id,
      {
        pct: t.chances >= 20 ? Math.round((t.made / t.chances) * 1000) / 1000 : null,
        range: t.outs >= 150 ? Math.round(((t.made * 27) / t.outs) * 100) / 100 : null,
        pitcherPct: t.pChances >= 10 ? Math.round((t.pMade / t.pChances) * 1000) / 1000 : null,
      },
    ]),
  );
}

// A batting or pitching line's rates from its counts (a line summed from two: regular season and playoffs)
function withRates(s) {
  const ab = s.atBats ?? 0;
  const h = s.hits ?? 0;
  const bb = s.baseOnBalls ?? 0;
  const obp = ratio(h + bb + (s.hitByPitch ?? 0), ab + bb + (s.hitByPitch ?? 0) + (s.sacFlies ?? 0));
  const slg = ratio(s.totalBases ?? 0, ab);
  Object.assign(s, { avg: ratio(h, ab), obp, slg, ops: obp !== null && slg !== null ? round(obp + slg) : null });
  if (s.inningsPitched !== undefined) {
    const ip = innings(s.inningsPitched);
    Object.assign(s, { era: ip ? round((9 * (s.earnedRuns ?? 0)) / ip, 2) : null, whip: ip ? round((h + bb) / ip, 2) : null });
  }
  return s;
}
function addStats(a, b) {
  const s = { ...a };
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && k !== 'age') s[k] = (a[k] ?? 0) + v;
  if (a.inningsPitched !== undefined || b.inningsPitched !== undefined) {
    const outs = outsOf(a.inningsPitched) + outsOf(b.inningsPitched);
    s.inningsPitched = `${Math.floor(outs / 3)}.${outs % 3}`;
  }
  return withRates(s);
}
// Two parts' splits (by player or team id) as one: the counts summed, the latest team (the playoffs')
function mergeSplits(a, b) {
  const out = new Map(a);
  for (const [id, split] of b) {
    const prev = out.get(id);
    out.set(id, prev ? { ...prev, team: split.team ?? prev.team, stat: addStats(prev.stat, split.stat) } : split);
  }
  return out;
}

// The season's league constants, fit to its regular-season sabermetrics (for the parts the
// sabermetrics endpoint doesn't cover): wOBA's linear weights (unintentional walk, HBP, single, double,
// triple, home run; least squares over hitters with 100+ PA, which the Stats API's wOBA matches to
// rounding), wRC+ and batting runs per PA as lines in wOBA (PA-weighted: the league scale in an average
// park), and the FIP constant (the median of FIP less its unscaled part)
const wobaParts = (t) => {
  const denom = (t.atBats ?? 0) + (t.baseOnBalls ?? 0) - (t.intentionalWalks ?? 0) + (t.sacFlies ?? 0) + (t.hitByPitch ?? 0);
  const singles = (t.hits ?? 0) - (t.doubles ?? 0) - (t.triples ?? 0) - (t.homeRuns ?? 0);
  return { denom, x: [(t.baseOnBalls ?? 0) - (t.intentionalWalks ?? 0), t.hitByPitch ?? 0, singles, t.doubles ?? 0, t.triples ?? 0, t.homeRuns ?? 0] };
};
const fipRaw = (t) => {
  const ip = innings(t.inningsPitched);
  return ip ? (13 * (t.homeRuns ?? 0) + 3 * ((t.baseOnBalls ?? 0) + (t.hitByPitch ?? 0)) - 2 * (t.strikeOuts ?? 0)) / ip : null;
};
function solve(M) {
  const n = M.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[m][i])) m = k;
    [M[i], M[m]] = [M[m], M[i]];
    if (!M[i][i]) return null;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function line(points) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y, w] of points) {
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  const b = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
  return { a: (sy - b * sx) / sw, b };
}
function leagueConstants({ hitting, pitching, sabH, sabP }) {
  const rows = [];
  for (const [id, split] of hitting) {
    const sab = sabH.get(id)?.stat;
    const pa = split.stat.plateAppearances ?? 0;
    const { denom, x } = wobaParts(split.stat);
    if (!sab || pa < 100 || !denom || num(sab.woba) === null) continue;
    rows.push({ x: x.map((v) => v / denom), woba: num(sab.woba), pa, wrc: num(sab.wRcPlus), bat: num(sab.batting) });
  }
  const fips = [];
  for (const [id, split] of pitching) {
    const fip = num(sabP.get(id)?.stat?.fip);
    const raw = fipRaw(split.stat);
    if (fip !== null && raw !== null && innings(split.stat.inningsPitched) >= 30) fips.push(fip - raw);
  }
  fips.sort((a, b) => a - b);
  let weights = null;
  if (rows.length >= 50) {
    const M = Array.from({ length: 6 }, () => Array(7).fill(0));
    for (const r of rows) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) M[i][j] += r.x[i] * r.x[j];
        M[i][6] += r.x[i] * r.woba;
      }
    }
    weights = solve(M);
  }
  const ok = (r, k) => r[k] !== null && Number.isFinite(r[k]);
  return {
    weights,
    wrcPlus: weights && rows.filter((r) => ok(r, 'wrc')).length >= 50 ? line(rows.filter((r) => ok(r, 'wrc')).map((r) => [r.woba, r.wrc, r.pa])) : null,
    batting: weights && rows.filter((r) => ok(r, 'bat')).length >= 50 ? line(rows.filter((r) => ok(r, 'bat')).map((r) => [r.woba, r.bat / r.pa, r.pa])) : null,
    fip: fips.length >= 20 ? fips[fips.length >> 1] : null,
  };
}

// A part's sabermetrics from its counts and the league constants, in the sabermetrics endpoint's shape
function computedSabermetrics(hitting, pitching, k) {
  const sabH = new Map();
  for (const [id, split] of hitting) {
    const { denom, x } = wobaParts(split.stat);
    if (!k.weights || !denom) continue;
    const woba = x.reduce((sum, v, i) => sum + v * k.weights[i], 0) / denom;
    const pa = split.stat.plateAppearances ?? 0;
    sabH.set(id, {
      stat: {
        woba,
        wRcPlus: k.wrcPlus ? k.wrcPlus.a + k.wrcPlus.b * woba : null,
        batting: k.batting ? (k.batting.a + k.batting.b * woba) * pa : null,
      },
    });
  }
  const sabP = new Map();
  for (const [id, split] of pitching) {
    const raw = fipRaw(split.stat);
    if (raw !== null && k.fip !== null) sabP.set(id, { stat: { fip: raw + k.fip } });
  }
  return { sabH, sabP };
}

// The award winners by player id; out.failed: the badges whose list didn't load (theirs are then the last
// good run's: carryFailed)
async function awardsFor(season) {
  const out = new Map();
  out.failed = new Set();
  for (const [badge, ids] of Object.entries(AWARDS)) {
    for (const id of ids) {
      const list =
        (
          await json(`${API}/awards/${id}/recipients?season=${season}`).catch(() => {
            out.failed.add(badge);
            return {};
          })
        ).awards ?? [];
      for (const a of list) {
        const pid = a.player?.id;
        if (!pid) continue;
        if (!out.has(pid)) out.set(pid, new Set());
        out.get(pid).add(badge);
      }
    }
  }
  return out;
}

// Players on a team's injured list right now (this season only); out.failed: the teams whose roster
// didn't load (their players' injuries are then the last good run's: carryFailed)
async function injuredList() {
  const teams = (await json(`${API}/teams?sportId=1&season=${CURRENT_SEASON}`)).teams ?? [];
  const out = new Map();
  out.failed = new Set();
  await Promise.all(
    teams.map(async (team) => {
      const roster =
        (
          await json(`${API}/teams/${team.id}/roster?rosterType=40Man&season=${CURRENT_SEASON}`).catch(() => {
            out.failed.add(team.id);
            return {};
          })
        ).roster ?? [];
      for (const r of roster) {
        if (/^D\d/.test(r.status?.code ?? '')) out.set(r.person.id, r.status.description);
      }
    }),
  );
  return out;
}

// A Savant source that failed (null) as none, its columns (the rows' stats) noted in failed: carried
// from the last good run (carryFailed)
function orNone(rows, failed, ...keys) {
  if (rows) return rows;
  for (const key of keys) failed.add(key);
  return new Map();
}

// The regular season's sources: the Stats API's stats and sabermetrics, Savant's leaderboards
// (failed: the Statcast columns whose source failed)
async function regularSources(season) {
  const [hitting, pitching, sabH, sabP, fielding] = await Promise.all([
    statsFor(season, 'hitting', 'season'),
    statsFor(season, 'pitching', 'season'),
    statsFor(season, 'hitting', 'sabermetrics'),
    statsFor(season, 'pitching', 'sabermetrics'),
    fieldingSplits(season),
  ]);
  // Statcast (2015 on)
  const statcast = season >= 2015;
  const failed = new Set();
  const [xBat, xPit, scBat, scPit, sprint, pitchCustom] = statcast
    ? await Promise.all([
        savant(`${SAVANT}/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`),
        savant(`${SAVANT}/expected_statistics?type=pitcher&year=${season}&position=&team=&min=1&csv=true`),
        savant(`${SAVANT}/statcast?type=batter&year=${season}&position=&team=&min=1&csv=true`),
        savant(`${SAVANT}/statcast?type=pitcher&year=${season}&position=&team=&min=1&csv=true`),
        savant(`${SAVANT}/sprint_speed?year=${season}&position=&team=&min=0&csv=true`),
        savant(`${SAVANT}/custom?year=${season}&type=pitcher&filter=&min=1&selections=whiff_percent&csv=true`),
      ])
    : [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()];
  // Outs Above Average (Statcast's fielding range, 2016 on; fielders, not catchers)
  const oaa =
    season >= 2016
      ? await savant(`${SAVANT}/outs_above_average?type=Fielder&startYear=${season}&endYear=${season}&split=no&team=&range=year&min=1&pos=&roles=&viz=hide&csv=true`)
      : new Map();
  return {
    hitting,
    pitching,
    sabH,
    sabP,
    fieldingSplits: fielding,
    fielding: fieldingOf(fielding),
    xBat: orNone(xBat, failed, 'xwoba'),
    xPit: orNone(xPit, failed, 'xera', 'xwobaAllowed'),
    scBat: orNone(scBat, failed, 'barrelPct', 'hardHitPct'),
    scPit: orNone(scPit, failed, 'hardHitAllowed', 'barrelAllowed'),
    sprint: orNone(sprint, failed, 'sprintSpeed'),
    pitchCustom: orNone(pitchCustom, failed, 'whiffPct'),
    oaa: orNone(oaa, failed, 'oaa'),
    failed,
  };
}

// The postseason's counts (none yet: null)
async function postCounts(season) {
  const [hitting, pitching, fielding] = await Promise.all([
    statsFor(season, 'hitting', 'season', 'P'),
    statsFor(season, 'pitching', 'season', 'P'),
    fieldingSplits(season, 'P'),
  ]);
  return hitting.size || pitching.size ? { hitting, pitching, fieldingSplits: fielding } : null;
}

// The playoffs' or both parts' sources, in the regular season's shape: the counts, sabermetrics
// computed from them, Savant's search over those games (no sprint speed or OAA: null)
async function partSources(season, part, counts, constants) {
  const { hitting, pitching, fieldingSplits: fielding } = counts;
  const types = part === 'post' ? POST_TYPES : ['R', ...POST_TYPES];
  const [batRows, pitRows] = season >= 2015 ? await Promise.all([savantSearch(season, types, 'batter'), savantSearch(season, types, 'pitcher')]) : [new Map(), new Map()];
  const failed = new Set();
  const bat = orNone(batRows, failed, 'xwoba', 'barrelPct', 'hardHitPct');
  const pit = orNone(pitRows, failed, 'xwobaAllowed', 'whiffPct', 'hardHitAllowed', 'barrelAllowed');
  return {
    failed,
    hitting,
    pitching,
    ...computedSabermetrics(hitting, pitching, constants),
    fielding: fieldingOf(fielding),
    xBat: bat,
    scBat: bat,
    xPit: pit,
    scPit: pit,
    pitchCustom: pit,
    sprint: new Map(),
    oaa: new Map(),
  };
}

async function buildSeason(season) {
  const current = season === CURRENT_SEASON;
  cacheOn = !current && process.env.CACHE !== '0';
  const dir = current ? STATIC : path.join(STATIC, 'seasons', String(season));
  const fileOf = (part) => path.join(dir, part === 'regular' ? 'skill-players.json' : `skill-players.${part}.json`);
  const [regular, awards, injured, parkRows, teams] = await Promise.all([
    regularSources(season),
    awardsFor(season),
    current ? injuredList() : Promise.resolve(new Map()),
    parkFactors(season),
    teamSources(season),
  ]);
  // (Savant's park factors didn't load: the teams' as the last good run had them)
  const parks =
    parkRows ??
    new Map(
      (await previousTab(fileOf('regular'), 'TM')).filter((t) => t.stats?.parkFactor != null).map((t) => [Number(t.gsisId.slice(3)), t.stats.parkFactor]),
    );
  if (!parkRows) console.warn(`${season}: park factors failed, ${parks.size} teams' kept from the last run`);
  const ctx = { season, current, awards, injured, parks, teams };
  const sources = { regular };
  if (PARTS.some((p) => p !== 'regular')) {
    const post = await postCounts(season);
    if (!post) console.log(`${season}: no postseason games yet`);
    else {
      const constants = leagueConstants(regular);
      // (a pitcher keeps his regular-season role: a starter in the bullpen for a playoff game or two is still a starter)
      ctx.roles = new Map([...regular.pitching].map(([id, s]) => [id, (s.stat.gamesStarted ?? 0) >= (s.stat.gamesPlayed ?? 0) / 2]));
      if (PARTS.includes('post')) sources.post = await partSources(season, 'post', post, constants);
      if (PARTS.includes('all')) {
        const both = {
          hitting: mergeSplits(regular.hitting, post.hitting),
          pitching: mergeSplits(regular.pitching, post.pitching),
          fieldingSplits: [...regular.fieldingSplits, ...post.fieldingSplits],
        };
        sources.all = await partSources(season, 'all', both, constants);
      }
    }
  }
  await mkdir(dir, { recursive: true });
  for (const part of PARTS) {
    if (!sources[part]) continue;
    const out = await buildRows(sources[part], part, ctx);
    const file = fileOf(part);
    carryFailed(out, await previousRows(file), sources[part].failed, { season, part, awards, injured, schedule: teams.schedule });
    // (compact: the files are served to the browser as is)
    await writeFile(file, JSON.stringify(out));
    console.log(`${season} ${part}: ${[...TABS, 'TM'].map((t) => `${out[t].length} ${t}`).join(', ')}`);
  }
}

// What a failed source gives, carried from the part's last good file (libs/ranker/scripts/carry-forward)
// into its rows, in place: the Statcast columns whose Savant source failed (failed), the badges of an
// award list that didn't load, the injuries of a team whose roster didn't, and the teams' schedule
// figures (Recent and playoff wins; the playoffs' and both's whole Teams tab, their records summed from
// the schedule). Only from a row of this season's (sameSeason: not the file the rollover left behind)
function carryFailed(out, before, failed, { season, part, awards, injured, schedule }) {
  const players = TABS.flatMap((t) => out[t]);
  const notes = [];
  if (failed?.size) notes.push(`${carryForward(players, before, { stats: [...failed], keep: sameSeason })} rows' ${[...failed].join(', ')}`);
  if (awards.failed.size) {
    const n = carryForward(players, before, {
      keep: sameSeason,
      take: (row, prev) => {
        const add = (prev.awards ?? []).filter((b) => awards.failed.has(b) && !row.awards.includes(b));
        row.awards.push(...add);
        return add.length > 0;
      },
    });
    notes.push(`${n} rows' ${[...awards.failed].join(', ')} awards`);
  }
  if (injured.failed?.size) {
    const teamOf = (row) => Number(row.teamLogo?.split('/').pop().replace('.svg', ''));
    const n = carryForward(players, before, {
      keep: (row, prev) => prev.injured && !row.injured && injured.failed.has(teamOf(prev)),
      fields: ['injured', 'injuryStatus'],
    });
    notes.push(`${n} injuries (${injured.failed.size} rosters failed)`);
  }
  if (!schedule) {
    const teams = before.filter((r) => r.gsisId?.startsWith('TM-'));
    if (part === 'regular') notes.push(`${carryForward(out.TM, teams, { fields: ['lastFive', 'lastFiveVs'], stats: ['playoffWins'], keep: sameSeason })} teams' Recent`);
    else if (teams.length) {
      out.TM = teams;
      notes.push('the Teams tab as it was');
    }
  }
  if (notes.length) console.warn(`${season} ${part}: sources failed, kept from the last run: ${notes.join('; ')}`);
}

// A part's rows, every tab
async function buildRows(src, part, { season, current, awards, injured, parks, teams, roles }) {
  const { hitting, pitching, sabH, sabP, fielding, xBat, xPit, scBat, scPit, sprint, pitchCustom, oaa } = src;
  const statcast = season >= 2015;

  // Everyone with a plate appearance (hitters) or a batter faced (pitchers); the app's Min PA setting
  // narrows it from there
  const MIN_PA = 1;

  const logo = (team) => `assets/MLB_Icons/${team?.id ?? 'mlb'}.svg`;
  const base = (split, prefix) => ({
    id: split.player.id,
    gsisId: `${prefix}-${split.player.id}`,
    name: split.player.fullName,
    teamLogo: logo(split.team),
    teamName: split.team?.name ?? null,
    awards: [...(awards.get(split.player.id) ?? [])],
    ...(injured.has(split.player.id) ? { injured: true, injuryStatus: injured.get(split.player.id) } : {}),
  });
  const sc = (map, id, key, d = 3) => {
    const v = num(map.get(id)?.[key]);
    return v === null ? null : round(v, d);
  };

  const out = Object.fromEntries(TABS.map((t) => [t, []]));

  // Hitters
  for (const [id, split] of hitting) {
    const tab = HITTER_TABS[split.position?.abbreviation];
    const s = split.stat;
    const pa = s.plateAppearances ?? 0;
    if (!tab || pa < MIN_PA) continue;
    const sab = sabH.get(id)?.stat ?? {};
    out[tab].push({
      ...base(split, 'H'),
      games: s.gamesPlayed ?? 0,
      stats: {
        war: round(num(sab.war), 1),
        pa,
        homeRuns: s.homeRuns ?? 0,
        rbi: s.rbi ?? 0,
        runs: s.runs ?? 0,
        stolenBases: s.stolenBases ?? 0,
        hits: s.hits ?? 0,
        avg: num(s.avg),
        obp: num(s.obp),
        slg: num(s.slg),
        bbPct: ratio(s.baseOnBalls ?? 0, pa),
        kPct: ratio(s.strikeOuts ?? 0, pa),
        wrcPlus: round(num(sab.wRcPlus), 0),
        woba: round(num(sab.woba), 3),
        defRuns: round(num(sab.fielding), 1),
        bsr: round(num(sab.baseRunning), 1),
        xwoba: statcast ? sc(xBat, id, 'est_woba') : null,
        barrelPct: statcast ? sc(scBat, id, 'brl_percent', 1) : null,
        hardHitPct: statcast ? sc(scBat, id, 'ev95percent', 1) : null,
        sprintSpeed: statcast ? sc(sprint, id, 'sprint_speed', 1) : null,
        fieldingPct: fielding.get(id)?.pct ?? null,
        rangeFactor: fielding.get(id)?.range ?? null,
        oaa: season >= 2016 ? sc(oaa, id, 'outs_above_average', 0) : null,
      },
    });
  }

  // Pitchers: starters (at least half their games started) and relievers
  for (const [id, split] of pitching) {
    const s = split.stat;
    const g = s.gamesPlayed ?? 0;
    const gs = s.gamesStarted ?? 0;
    const ip = innings(s.inningsPitched);
    const starter = roles?.get(id) ?? gs >= g / 2;
    const bf = s.battersFaced ?? 0;
    if (bf < MIN_PA) continue;
    const sab = sabP.get(id)?.stat ?? {};
    const k = s.strikeOuts ?? 0;
    const bb = s.baseOnBalls ?? 0;
    const stats = {
      war: round(num(sab.war), 1),
      // (batters faced: a pitcher's plate appearances, for the Min PA setting)
      pa: bf,
      gamesStarted: gs,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      winPct: s.wins + s.losses ? round(s.wins / (s.wins + s.losses)) : null,
      saves: s.saves ?? 0,
      holds: s.holds ?? 0,
      ip: round(ip, 3),
      era: num(s.era),
      whip: num(s.whip),
      strikeOuts: k,
      kPct: ratio(k, bf),
      bbPct: ratio(bb, bf),
      kbbPct: ratio(k - bb, bf),
      hr9: ip ? round(((s.homeRuns ?? 0) * 9) / ip, 2) : null,
      fip: round(num(sab.fip), 2),
      xfip: round(num(sab.xfip), 2),
      xera: statcast ? sc(xPit, id, 'xera', 2) : null,
      fieldingPct: fielding.get(id)?.pitcherPct ?? null,
      xwobaAllowed: statcast ? sc(xPit, id, 'est_woba') : null,
      whiffPct: statcast ? sc(pitchCustom, id, 'whiff_percent', 1) : null,
      hardHitAllowed: statcast ? sc(scPit, id, 'ev95percent', 1) : null,
      barrelAllowed: statcast ? sc(scPit, id, 'brl_percent', 1) : null,
    };
    out[starter ? 'SP' : 'RP'].push({ ...base(split, 'P'), games: g, stats });
  }

  // Support grades (the situation around a player, graded across the league):
  // - Lineup (hitters): the rest of his team's lineup, his teammates' batting runs per plate appearance
  //   (without him), curved over every hitter
  // - Defense (pitchers): his team's fielding runs, curved over the teams (none in the playoffs: no
  //   fielding runs there)
  // - Stadium: his home park, curved over the teams: friendlier to hitters grades higher for a hitter,
  //   friendlier to pitchers higher for a pitcher (no park factor for a team: none)
  const teamOf = (unit) => Number(unit.teamLogo.split('/').pop().replace('.svg', ''));
  const teamBat = new Map();
  const teamDef = new Map();
  for (const [id, split] of hitting) {
    const team = split.team?.id;
    if (!team) continue;
    const sab = sabH.get(id)?.stat ?? {};
    const t = teamBat.get(team) ?? { runs: 0, pa: 0 };
    teamBat.set(team, { runs: t.runs + (num(sab.batting) ?? 0), pa: t.pa + (split.stat.plateAppearances ?? 0) });
    if (num(sab.fielding) !== null) teamDef.set(team, (teamDef.get(team) ?? 0) + num(sab.fielding));
  }
  const hitters = TABS.filter((t) => t !== 'SP' && t !== 'RP').flatMap((t) => out[t]);
  const lineupScore = new Map(
    hitters.map((unit) => {
      const t = teamBat.get(teamOf(unit));
      const own = num(sabH.get(unit.id)?.stat?.batting) ?? 0;
      const pa = t ? t.pa - (unit.stats.pa ?? 0) : 0;
      return [unit.gsisId, t && pa > 0 ? ((t.runs - own) / pa) * 600 : NaN];
    }),
  );
  const lineup = curve(lineupScore);
  const defense = curve(teamDef);
  const hitterPark = curve(parks);
  const pitcherPark = curve(new Map([...parks].map(([team, v]) => [team, -v])));
  for (const unit of hitters) {
    unit.stats.lineup = lineup.get(unit.gsisId) ?? null;
    unit.stats.park = hitterPark.get(teamOf(unit)) ?? null;
  }
  for (const unit of [...out.SP, ...out.RP]) {
    unit.stats.defense = defense.get(teamOf(unit)) ?? null;
    unit.stats.park = pitcherPark.get(teamOf(unit)) ?? null;
  }
  // (early in the season, Lineup and Defense start from the team's last season: libs/ranker/scripts/early-season;
  // the Stadium is a three-year park factor already)
  if (current && part === 'regular') console.log(await blendWithLastSeason({ staticDir: STATIC, season, rows: out, keys: ['lineup', 'defense'], fullAt: 40 }));

  // Teams (the app's Teams tab, first): the standings (record, runs scored and allowed), postseason
  // wins, the team's OPS and ERA, its fielding runs, its park, and its wins against what the run
  // differential implies (a Pythagorean expectation, exponent 1.83: close games)
  out.TM = teamRows(teams, part, teamDef, parks, logo);

  for (const tab of [...TABS, 'TM']) out[tab].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// The season's team sources: the standings, the teams' batting and pitching (regular season and
// playoffs), every game
async function teamSources(season) {
  const teamStats = (group, gameType) =>
    json(`${API}/teams/stats?stats=season&group=${group}&season=${season}&sportIds=1${gameType ? `&gameType=${gameType}` : ''}`).then(
      (r) => new Map((r.stats?.[0]?.splits ?? []).map((s) => [s.team.id, s])),
    );
  const [standings, hitting, pitching, postHitting, postPitching, schedule] = await Promise.all([
    json(`${API}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`),
    teamStats('hitting'),
    teamStats('pitching'),
    teamStats('hitting', 'P').catch(() => new Map()),
    teamStats('pitching', 'P').catch(() => new Map()),
    // (every game, the regular season's and the postseason's: postseason wins, and the last five)
    // (null when it fails: the teams' schedule figures are then the last good run's, carryFailed)
    json(`${API}/schedule?sportId=1&season=${season}&gameType=R,${POST_TYPES.join(',')}`).catch(() => null),
  ]);
  return { standings, hitting, pitching, postHitting, postPitching, schedule };
}

function teamRows({ standings, hitting, pitching, postHitting, postPitching, schedule }, part, teamDef, parks, logo) {
  schedule ??= { dates: [] };
  const batting = part === 'regular' ? hitting : part === 'post' ? postHitting : mergeSplits(hitting, postHitting);
  const staff = part === 'regular' ? pitching : part === 'post' ? postPitching : mergeSplits(pitching, postPitching);
  const ops = new Map([...batting].map(([id, s]) => [id, num(s.stat.ops)]));
  // (the full name, "Toronto Blue Jays": the standings have just "Blue Jays")
  const fullName = new Map([...hitting, ...postHitting].map(([id, s]) => [id, s.team.name]));
  const era = new Map([...staff].map(([id, s]) => [id, num(s.stat.era)]));
  const playoffWins = new Map();
  // (each team's finished games, for its last five: [date, 1 a win, 0 a loss])
  const results = new Map();
  // (the playoffs' records, in the standings' shape)
  const postRecords = new Map();
  for (const date of schedule.dates ?? []) {
    for (const game of date.games ?? []) {
      const final = game.status?.abstractGameState === 'Final' && game.status?.detailedState !== 'Postponed';
      const post = game.gameType !== 'R';
      for (const side of ['home', 'away']) {
        const t = game.teams?.[side];
        if (!t) continue;
        const opp = game.teams?.[side === 'home' ? 'away' : 'home'];
        if (t.isWinner && post) playoffWins.set(t.team.id, (playoffWins.get(t.team.id) ?? 0) + 1);
        if (final && post && t.isWinner !== undefined) {
          const r = postRecords.get(t.team.id) ?? { team: t.team, wins: 0, losses: 0, gamesPlayed: 0, runsScored: 0, runsAllowed: 0 };
          postRecords.set(t.team.id, {
            ...r,
            wins: r.wins + (t.isWinner ? 1 : 0),
            losses: r.losses + (t.isWinner ? 0 : 1),
            gamesPlayed: r.gamesPlayed + 1,
            runsScored: r.runsScored + (t.score ?? 0),
            runsAllowed: r.runsAllowed + (opp?.score ?? 0),
          });
        }
        // (whom it came against, "@ Chicago Cubs" away or "vs New York Mets" at home: the Recent dot's hover)
        const otherName = opp?.team?.name;
        const other = otherName ? `${side === 'home' ? 'vs' : '@'} ${otherName}` : null;
        // (the playoffs' Recent: their games only)
        if (final && t.isWinner !== undefined && (post || part !== 'post'))
          (results.get(t.team.id) ?? results.set(t.team.id, []).get(t.team.id)).push([game.gameDate, t.isWinner ? 1 : 0, other]);
      }
    }
  }
  // (its last ten: a baseball team's recent form)
  const lastTen = (id) => (results.get(id) ?? []).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
  const regular = (standings.records ?? []).flatMap((r) => r.teamRecords ?? []);
  const sum = (r) => {
    const p = postRecords.get(r.team.id);
    if (!p) return r;
    const add = (k) => (r[k] ?? 0) + p[k];
    return { ...r, wins: add('wins'), losses: add('losses'), gamesPlayed: (r.gamesPlayed || r.wins + r.losses) + p.gamesPlayed, runsScored: add('runsScored'), runsAllowed: add('runsAllowed') };
  };
  const records = part === 'regular' ? regular : part === 'post' ? [...postRecords.values()] : regular.map(sum);
  const perGame = (t, key) => (t.gamesPlayed ? t[key] / t.gamesPlayed : null);
  const rankBy = (key, dir) => {
    const sorted = [...records].sort((a, b) => dir * (perGame(a, key) - perGame(b, key)));
    return new Map(sorted.map((t, i) => [t.team.id, i + 1]));
  };
  const offRank = rankBy('runsScored', -1);
  const defRank = rankBy('runsAllowed', 1);
  return records.map((t) => {
    const id = t.team.id;
    const gp = t.gamesPlayed || t.wins + t.losses;
    const rs = t.runsScored ?? 0;
    const ra = t.runsAllowed ?? 0;
    const pyth = rs + ra ? rs ** 1.83 / (rs ** 1.83 + ra ** 1.83) : 0.5;
    return {
      id: null,
      gsisId: `TM-${id}`,
      name: fullName.get(id) ?? t.team.name,
      teamLogo: logo(t.team),
      teamName: fullName.get(id) ?? t.team.name,
      games: gp,
      // (its last ten games, newest first: the Recent column)
      lastFive: lastTen(id).map(([, r]) => r),
      lastFiveVs: lastTen(id).map(([, , o]) => o),
      stats: {
        wins: t.wins,
        losses: t.losses,
        winPct: gp ? round(t.wins / gp, 3) : null,
        playoffWins: playoffWins.get(id) ?? 0,
        runDiff: gp ? round((rs - ra) / gp, 2) : null,
        offRank: offRank.get(id) ?? null,
        defRank: defRank.get(id) ?? null,
        ops: ops.get(id) ?? null,
        era: era.get(id) ?? null,
        fieldingRuns: teamDef.has(id) ? round(teamDef.get(id), 1) : null,
        pythDiff: gp ? round(t.wins - gp * pyth, 1) : null,
        parkFactor: parks.get(id) ?? null,
      },
      awards: [],
    };
  });
}

const seasons = process.env.ALL
  ? Array.from({ length: CURRENT_SEASON - FIRST_SEASON }, (_, i) => FIRST_SEASON + i)
  : [Number(process.env.SEASON ?? CURRENT_SEASON)];
for (const season of seasons) await buildSeason(season);
