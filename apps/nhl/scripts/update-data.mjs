// Builds the NHL app's data: every tab's players for a season, from the NHL's stats API (skater and
// goalie totals, hits / blocks / takeaways, faceoffs, bios for the rookie rule, the standings with each
// team's name, record and logo that season, and the league's award records) and MoneyPuck (expected
// goals, on-ice shot and chance shares, Game Score, goals saved above expected, the shot quality a
// goalie faced).
//
// Usage: npm run nhl:update-data                 this season, to src/StaticData/
//        SEASON=2019 npm run nhl:update-data     a finished season, to src/StaticData/seasons/2019/
//        ALL=1 npm run nhl:update-data           every finished season from 2008-09 to last year
//        PART=post,all ...                       only those parts of the season (default: all three)
//
// Each season in three parts, the settings menu's Stats From (libs/ranker/src/engine/data.ts): the
// regular season (skill-players.json), the playoffs (skill-players.post.json) and both together
// (skill-players.all.json), the same tabs, rows and stats. The playoffs come from the same sources (the
// stats API's gameTypeId=3, MoneyPuck's playoffs files, the schedule's playoff games); both is the two
// added up, its rates worked out again from the summed counts (addUp). A season with no playoff games yet
// has neither file (the current one's are removed: the app falls back to the regular season), and a
// player or team with no playoff games isn't in the playoff file.
//
// A season is named for the year it ends in, like the NBA app: 2026 is 2025-26 (the NHL calls it
// 20252026, MoneyPuck 2025).
//
// Writes skill-players.json in the shape the app reads: { C: [...], LW: [...], RW: [...], D: [...],
// G: [...] }, each player { id, gsisId, name, teamLogo, teamName, games, stats, awards, rookie }. id
// (headshots) and gsisId are the NHL player id. Team logos are the NHL's own for that season (an era's
// logo in its file name), saved to src/assets/NHL_Icons/ the first time they're seen.
import { writeFile, mkdir, access, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { curve } from '../../../libs/ranker/scripts/grades.mjs';
import { blendWithLastSeason } from '../../../libs/ranker/scripts/early-season.mjs';
import { coachesFor } from './coaches.mjs';
import { readLogFiles, removeOldFile, writeLogFiles } from './game-log-files.mjs';
import { addVsPosition } from './vs-position.mjs';

const CURRENT_SEASON = 2027;
// MoneyPuck's season files start with 2008-09
const FIRST_SEASON = 2009;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const ICONS = path.join(ROOT, 'src/assets/NHL_Icons');
const STATS = 'https://api.nhle.com/stats/rest/en';
const WEB = 'https://api-web.nhle.com/v1';
const RECORDS = 'https://records.nhl.com/site/api';
const MONEYPUCK = 'https://moneypuck.com/moneypuck/playerData/seasonSummary';
// (a finished season's answers, kept on disk so a rebuild doesn't ask again: gitignored, .cache/)
const CACHE_DIR = path.join(import.meta.dirname, '.cache');

// The parts of a season (Stats From): the game types each counts (2 the regular season, 3 the
// playoffs) and its file
const PARTS = {
  regular: { types: [2], file: 'skill-players.json' },
  post: { types: [3], file: 'skill-players.post.json' },
  all: { types: [2, 3], file: 'skill-players.all.json' },
};

// The NHL's position codes -> the app's tabs
const TABS = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };

// The award records' trophy ids -> the app's badges. The Cup and the conference titles go on every
// row of those teams; the rest on the winner's row.
const PLAYER_AWARDS = { 8: 'hart', 18: 'vezina', 11: 'norris', 4: 'calder', 17: 'selke', 7: 'conn', 13: 'lindsay', 15: 'rocket', 16: 'artross' };
const CUP = 1;
const CONFERENCE_TITLES = [5, 19];

// A polite pace for every source (a few requests a second at most, one slot each even when asked
// together). Each answer is asked once a run (the parts share them); a finished season's (cacheable,
// set per season) are kept in CACHE_DIR too
let nextSlot = 0;
let cacheable = false;
const asked = new Map();
function get(url, as = 'json') {
  if (!asked.has(url)) asked.set(url, cached(url, as, cacheable));
  return asked.get(url);
}
async function cached(url, as, keep) {
  const file = path.join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.json');
  if (keep) {
    try {
      return JSON.parse(await readFile(file, 'utf8')).body;
    } catch {
      // (not asked before)
    }
  }
  const body = await fetchPolitely(url, as);
  if (keep) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ url, body }));
  }
  return body;
}
async function fetchPolitely(url, as) {
  for (let attempt = 1; ; attempt++) {
    const slot = Math.max(nextSlot, Date.now());
    nextSlot = slot + 350;
    if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'sports-ranker data script' } });
      if (res.status === 404) return null;
      // (rate-limited: wait as long as the API asks, then try again)
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 30) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

// Every listed player's game log this season, regular season and playoffs (from April on), newest first:
// { id: [[date, "@ TOR", result, ...the line], ...] } in game-logs/<season>/ (game-log-files.mjs: split so
// a card loads only its share). One at a time at get()'s pace (the API rate-limits faster asking); a
// player whose log already has every game he's played (no new ones since the last run) is kept as it was,
// not asked again: on a game night about a third of them are asked, in the offseason none
async function writeGameLogs(season, skaters, goalies) {
  const root = path.join(STATIC, 'game-logs');
  const before = readLogFiles(root, season);
  const players = [...skaters.map((u) => [u.id, false, u.games]), ...goalies.map((u) => [u.id, true, u.games])];
  const logs = {};
  // (each player's playoff games: the newest of his log, set apart on the card)
  const playoffGames = {};
  const playoffs = new Date().getMonth() >= 3 && new Date().getMonth() <= 5;
  let kept = 0;
  const one = async ([id, goalie, played]) => {
    const known = before.logs[id];
    if (!playoffs && !before.playoffs[id] && played > 0 && known?.length === played) {
      logs[id] = known;
      kept++;
      return;
    }
    const games = [];
    for (const type of playoffs ? [3, 2] : [2]) {
      const body = await get(`${WEB}/player/${id}/game-log/${seasonId(season)}/${type}`).catch(() => null);
      if (type === 3 && body?.gameLog?.length) playoffGames[id] = body.gameLog.length;
      games.push(...(body?.gameLog ?? []));
    }
    // (none came back, the API refusing: his log as it was, rather than none)
    if (!games.length) {
      if (known) logs[id] = known;
      return;
    }
    games.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
    logs[id] = games.map((g) => {
      const date = new Date(`${g.gameDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const vs = `${g.homeRoadFlag === 'H' ? 'vs' : '@'} ${g.opponentAbbrev}`;
      return goalie
        ? [date, vs, g.decision === 'W' ? 'W' : g.decision === 'L' || g.decision === 'O' ? 'L' : '', g.shotsAgainst, g.goalsAgainst, g.savePctg == null ? '-' : g.savePctg.toFixed(3).replace(/^0/, ''), g.toi]
        : [date, vs, '', g.goals, g.assists, g.points, g.plusMinus > 0 ? `+${g.plusMinus}` : g.plusMinus, g.shots, g.pim, g.toi];
    });
  };
  for (const player of players) await one(player);
  const written = writeLogFiles(root, season, logs, playoffGames);
  removeOldFile(path.join(STATIC, 'game-logs.json'));
  console.log(`Game logs: ${Object.keys(logs).length} players (${kept} unchanged, not asked), ${written} files written`);
}

const round = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const seasonId = (season) => `${season - 1}${season}`;

// A MoneyPuck row's expected-goal share with the player on (or off) the ice, from the expected goals
// themselves (MoneyPuck's own share columns are rounded to the percent)
const share = (row, ice) => {
  const f = num(row?.[`${ice}_F_xGoals`]);
  const a = num(row?.[`${ice}_A_xGoals`]);
  return f !== null && a !== null && f + a > 0 ? f / (f + a) : null;
};

// Every row of one of the stats API's reports for a season (type 2 the regular season, 3 the playoffs),
// in one request (its pages aren't in a stable order, so paging skips and repeats rows)
async function report(kind, season, type = 2) {
  const exp = encodeURIComponent(`seasonId=${seasonId(season)} and gameTypeId=${type}`);
  return (await get(`${STATS}/${kind}?limit=-1&cayenneExp=${exp}`))?.data ?? [];
}

// A MoneyPuck season file (skaters, goalies or teams; the regular season's or the playoffs'), parsed:
// rows by situation ("all", "5on5")
async function moneypuck(kind, season, type = 2) {
  const text = await get(`${MONEYPUCK}/${season - 1}/${type === 3 ? 'playoffs' : 'regular'}/${kind}.csv`, 'text');
  if (!text) return [];
  const [head, ...lines] = text.trim().split('\n');
  const keys = head.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
}

// A part's rows of a report or a MoneyPuck file: one game type's as they come, both added up
const partReport = async (kind, season, part) => addUp(await Promise.all(PARTS[part].types.map((type) => report(kind, season, type))), (r) => r.playerId ?? r.teamId);
const partMoneypuck = async (kind, season, part) =>
  addUp(await Promise.all(PARTS[part].types.map((type) => moneypuck(kind, season, type))), (r) => `${r.playerId ?? r.team}/${r.situation}`);

// Rates worked out again from the summed counts (a rate is never averaged): the stats API's and
// MoneyPuck's, where a row has them; any other rate in a summed row is left null
const RATES = {
  shootingPct: (r) => r.goals / r.shots,
  faceoffWinPct: (r) => r.totalFaceoffWins / r.totalFaceoffs,
  savePct: (r) => r.saves / r.shotsAgainst,
  goalsAgainstAverage: (r) => (r.goalsAgainst * 3600) / r.timeOnIce,
  pointPct: (r) => (2 * r.wins + (r.otLosses ?? 0)) / (2 * r.gamesPlayed),
  powerPlayPct: (r) => r.powerPlayGoalsFor / r.ppOpportunities,
  penaltyKillPct: (r) => 1 - r.ppGoalsAgainst / r.timesShorthanded,
  onIce_corsiPercentage: (r) => r.OnIce_F_shotAttempts / (r.OnIce_F_shotAttempts + r.OnIce_A_shotAttempts),
  offIce_corsiPercentage: (r) => r.OffIce_F_shotAttempts / (r.OffIce_F_shotAttempts + r.OffIce_A_shotAttempts),
  onIce_xGoalsPercentage: (r) => r.OnIce_F_xGoals / (r.OnIce_F_xGoals + r.OnIce_A_xGoals),
  offIce_xGoalsPercentage: (r) => r.OffIce_F_xGoals / (r.OffIce_F_xGoals + r.OffIce_A_xGoals),
  corsiPercentage: (r) => r.shotAttemptsFor / (r.shotAttemptsFor + r.shotAttemptsAgainst),
  xGoalsPercentage: (r) => r.xGoalsFor / (r.xGoalsFor + r.xGoalsAgainst),
};
const IDS = new Set(['playerId', 'teamId', 'seasonId', 'season']);
const IS_RATE = /(Pct|Pctg|Percentage|Per60|Average)$/;
const isNumber = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v));
// One list as it is; two (the regular season's and the playoffs') added up by key: counts summed, a
// per-game figure weighted by games (exact: the total over the games), a rate from RATES, the team
// list in order ("TOR,BOS"), any other text the playoffs'
function addUp(lists, keyOf) {
  if (lists.length === 1) return lists[0];
  const rows = new Map();
  const gp = (r) => Number(r.gamesPlayed ?? r.games_played ?? 0);
  // (a row in only one list is kept as it came)
  const summed = new Set();
  for (const row of lists.flat()) {
    const key = keyOf(row);
    const sum = rows.get(key);
    if (!sum) {
      rows.set(key, Object.fromEntries(Object.entries(row).map(([k, v]) => [k, isNumber(v) && !IDS.has(k) ? Number(v) : v])));
      continue;
    }
    summed.add(sum);
    const games = [gp(sum), gp(row)];
    for (const [k, v] of Object.entries(row)) {
      const was = sum[k];
      if (IDS.has(k)) sum[k] = was ?? v;
      else if (k === 'teamAbbrevs') sum[k] = [...new Set([was, v].filter(Boolean).flatMap((t) => t.split(',')))].join(',');
      else if (isNumber(v) || isNumber(was)) {
        const [a, b] = [isNumber(was) ? Number(was) : null, isNumber(v) ? Number(v) : null];
        if (k.endsWith('PerGame')) sum[k] = games[0] + games[1] ? ((a ?? 0) * games[0] + (b ?? 0) * games[1]) / (games[0] + games[1]) : null;
        else sum[k] = a === null && b === null ? null : (a ?? 0) + (b ?? 0);
      } else sum[k] = v ?? was;
    }
  }
  for (const row of summed) {
    for (const k of Object.keys(row)) {
      if (!IS_RATE.test(k)) continue;
      const v = RATES[k]?.(row);
      row[k] = Number.isFinite(v) ? v : null;
    }
  }
  return [...rows.values()];
}

// The standings at the end of a season: each team's name, record and logo that season
async function standings(season) {
  const seasons = (await get(`${WEB}/standings-season`)).seasons;
  const end = seasons.find((s) => s.id === Number(seasonId(season)))?.standingsEnd;
  const table = end ? (await get(`${WEB}/standings/${end}`))?.standings ?? [] : [];
  return new Map(
    table.map((t) => [
      t.teamAbbrev.default,
      {
        name: t.teamName.default,
        logo: t.teamLogoDark ?? t.teamLogo,
        wins: t.wins,
        losses: t.losses,
        otLosses: t.otLosses,
        gp: t.gamesPlayed,
        pointPct: t.pointPctg,
      },
    ]),
  );
}

// A team's logo, saved locally the first time: "https://.../ATL_19992000-20102011_dark.svg" ->
// assets/NHL_Icons/ATL_19992000-20102011.svg
async function logoFile(url, code) {
  const file = url ? url.split('?')[0].split('/').pop().replace(/_(dark|light)\.svg$/, '.svg') : `${code}.svg`;
  const dest = path.join(ICONS, file);
  try {
    await access(dest);
  } catch {
    const svg = url ? await get(url, 'text') : null;
    if (svg) {
      await mkdir(ICONS, { recursive: true });
      await writeFile(dest, svg);
    }
  }
  return `assets/NHL_Icons/${file}`;
}

// Calder Trophy eligibility (the NHL's rookie rule): no more than 25 games in any earlier season, not
// 6+ games in each of two earlier seasons, and 26 or younger on September 15 of the season. Earlier
// seasons come from the stats API back to the player's first.
async function rookies(season, bios, kind) {
  const prior = new Map();
  for (let back = 1; back <= 4; back++) {
    for (const row of await report(`${kind}/summary`, season - back)) {
      const gp = prior.get(row.playerId) ?? [];
      gp.push(row.gamesPlayed);
      prior.set(row.playerId, gp);
    }
  }
  const cutoff = new Date(`${season - 1}-09-15`);
  const out = new Set();
  for (const bio of bios) {
    const first = Number(String(bio.firstSeasonForGameType ?? '').slice(4));
    if (!first) continue;
    // (a first season more than four years back means more than this window can see: not a rookie)
    if (first < season - 4) continue;
    const gp = prior.get(bio.playerId) ?? [];
    const age = bio.birthDate ? (cutoff - new Date(bio.birthDate)) / (365.25 * 864e5) : 0;
    if (gp.some((g) => g > 25) || gp.filter((g) => g >= 6).length >= 2 || age > 26) continue;
    out.add(bio.playerId);
  }
  return out;
}

// A season's part (PARTS): the regular season, the playoffs or both. Who won what, the rookies, the
// teams' names and logos and the head coaches' stints are the season's either way; the games counted
// are the part's
async function buildSeason(season, part = 'regular') {
  const current = season === CURRENT_SEASON;
  const dir = current ? STATIC : path.join(STATIC, 'seasons', String(season));
  const file = path.join(dir, PARTS[part].file);
  // (no playoff games yet: no playoffs or both, and the current season's left from last year removed)
  if (part !== 'regular' && !(await report('skater/summary', season, 3)).length) {
    if (current) await rm(file, { force: true });
    console.log(`${season} ${part}: no playoff games yet, no ${PARTS[part].file}`);
    return;
  }
  const [skaters, realtime, faceoffs, skaterBios, goalies, goalieBios, teams, awardRows, teamList] = await Promise.all([
    partReport('skater/summary', season, part),
    partReport('skater/realtime', season, part),
    partReport('skater/faceoffwins', season, part),
    report('skater/bios', season),
    partReport('goalie/summary', season, part),
    report('goalie/bios', season),
    standings(season),
    get(`${RECORDS}/award-details?cayenneExp=${encodeURIComponent(`seasonId=${seasonId(season)}`)}`),
    get(`${STATS}/team`),
  ]);
  const [mpSkaters, mpGoalies] = [await partMoneypuck('skaters', season, part), await partMoneypuck('goalies', season, part)];
  // (the head coaches' team expected goals, and last season's skaters for their Coaching Lift: the
  // regular season's, what the roster was before these games)
  const [mpTeams, priorSkaters] = [await partMoneypuck('teams', season, part), await moneypuck('skaters', season - 1)];
  const skaterRookies = await rookies(season, skaterBios, 'skater');
  const goalieRookies = await rookies(season, goalieBios, 'goalie');

  const triCode = new Map((teamList?.data ?? []).map((t) => [t.id, t.triCode]));
  // (each team's record over the part's games: the final standings for the regular season, the
  // stats API's team totals otherwise: in the playoffs an overtime loss is a loss)
  const records =
    part === 'regular'
      ? teams
      : new Map(
          (await partReport('team/summary', season, part)).map((t) => [
            triCode.get(t.teamId),
            { wins: t.wins, losses: t.losses, otLosses: t.otLosses ?? 0, gp: t.gamesPlayed, pointPct: t.pointPct },
          ]),
        );
  const hits = new Map(realtime.map((r) => [r.playerId, r]));
  const draws = new Map(faceoffs.map((r) => [r.playerId, r]));
  const mp = (rows, situation) => new Map(rows.filter((r) => r.situation === situation).map((r) => [Number(r.playerId), r]));
  const mpAll = mp(mpSkaters, 'all');
  const mp5 = mp(mpSkaters, '5on5');
  const mpGoalie = mp(mpGoalies, 'all');

  // Awards: the player trophies by player id, the Cup and conference titles by team
  const playerAwards = new Map();
  const teamAwards = new Map();
  for (const a of awardRows?.data ?? []) {
    if (a.status !== 'WINNER') continue;
    const badge = PLAYER_AWARDS[a.trophyId];
    if (badge && a.playerId) playerAwards.set(a.playerId, [...(playerAwards.get(a.playerId) ?? []), badge]);
    const team = triCode.get(a.teamId);
    // (once a team: the records list the Cup once for each of its players)
    const badges = teamAwards.get(team) ?? [];
    if (team && a.trophyId === CUP && !badges.includes('cup')) teamAwards.set(team, [...badges, 'cup']);
    if (team && CONFERENCE_TITLES.includes(a.trophyId) && !badges.includes('conf')) teamAwards.set(team, [...badges, 'conf']);
  }

  // A row's team: the last of a traded player's teams
  const logos = new Map();
  for (const [code, t] of teams) logos.set(code, await logoFile(t.logo, code));
  const teamOf = async (abbrevs) => {
    const code = String(abbrevs ?? '').split(',').pop().trim();
    if (code && !logos.has(code)) logos.set(code, await logoFile(null, code));
    const t = records.get(code);
    return {
      code,
      logo: logos.get(code) ?? 'assets/NHL_Icons/NHL.svg',
      name: teams.get(code)?.name ?? null,
      // (his last team's record over the part's games: W-L-OTL, ranked on points percentage)
      record: t ? { wins: t.wins, losses: t.losses, ties: t.otLosses, winPct: round(t.pointPct) } : { wins: null, losses: null, ties: null, winPct: null },
    };
  };
  const awardsFor = (id, code) => [...(teamAwards.get(code) ?? []), ...(playerAwards.get(id) ?? [])];

  const out = { C: [], LW: [], RW: [], D: [], G: [] };
  for (const row of skaters) {
    const tab = TABS[row.positionCode];
    if (!tab || tab === 'G' || !row.gamesPlayed) continue;
    const team = await teamOf(row.teamAbbrevs);
    const rt = hits.get(row.playerId) ?? {};
    const all = mpAll.get(row.playerId);
    const even = mp5.get(row.playerId);
    const ixg = num(all?.I_F_xGoals);
    out[tab].push({
      id: row.playerId,
      gsisId: String(row.playerId),
      name: row.skaterFullName,
      teamLogo: team.logo,
      teamName: team.name,
      games: row.gamesPlayed,
      rookie: skaterRookies.has(row.playerId),
      _offIce: share(even, 'OffIce'),
      _team: team.code,
      stats: {
        ...team.record,
        toi: round(row.timeOnIcePerGame / 60, 2),
        goals: row.goals,
        assists: row.assists,
        points: row.points,
        plusMinus: row.plusMinus,
        ppPoints: row.ppPoints,
        shPoints: row.shPoints,
        gwg: row.gameWinningGoals,
        shots: row.shots,
        shootingPct: row.shots >= 20 ? round(row.shootingPct) : null,
        pim: row.penaltyMinutes,
        hits: rt.hits ?? null,
        blocks: rt.blockedShots ?? null,
        takeaways: rt.takeaways ?? null,
        giveaways: rt.giveaways ?? null,
        // (a winger's handful of draws says little: 50+ faceoffs)
        faceoffPct: (draws.get(row.playerId)?.totalFaceoffs ?? 0) >= 50 ? round(draws.get(row.playerId).faceoffWinPct) : null,
        // (the draws he took, won or lost: the sample behind it, for the card's faceoff minimum; not a column)
        faceoffs: draws.get(row.playerId)?.totalFaceoffs ?? 0,
        gameScore: round(num(all?.gameScore), 1),
        ixg: round(ixg, 1),
        goalsAboveX: ixg === null ? null : round(row.goals - ixg, 1),
        hdShots: num(all?.I_F_highDangerShots),
        xgfPct: round(share(even, 'OnIce')),
        cfPct: round(num(even?.onIce_corsiPercentage)),
        // (on-ice expected-goal share above the team's without him, in points)
        xgfRel: share(even, 'OnIce') !== null && share(even, 'OffIce') !== null ? round((share(even, 'OnIce') - share(even, 'OffIce')) * 100, 1) : null,
      },
      awards: awardsFor(row.playerId, team.code),
    });
  }
  for (const row of goalies) {
    if (!row.gamesPlayed) continue;
    const team = await teamOf(row.teamAbbrevs);
    const m = mpGoalie.get(row.playerId);
    const xga = num(m?.xGoals);
    const ga = num(m?.goals);
    const hd = num(m?.highDangerShots);
    const minutes = num(m?.icetime) ? num(m.icetime) / 60 : null;
    out.G.push({
      id: row.playerId,
      gsisId: String(row.playerId),
      name: row.goalieFullName,
      teamLogo: team.logo,
      teamName: team.name,
      games: row.gamesPlayed,
      rookie: goalieRookies.has(row.playerId),
      _team: team.code,
      // (the shot quality he faced: expected goals against per 60 minutes, for his Defense grade)
      _faced: xga !== null && minutes ? (xga * 60) / minutes : null,
      stats: {
        gamesStarted: row.gamesStarted,
        wins: row.wins,
        losses: row.losses,
        ties: row.otLosses ?? 0,
        // (points percentage of his decisions, as the standings count it: 2 for a win, 1 for an OT loss)
        winPct: row.wins + row.losses + (row.otLosses ?? 0) ? round((2 * row.wins + (row.otLosses ?? 0)) / (2 * (row.wins + row.losses + (row.otLosses ?? 0)))) : null,
        savePct: row.shotsAgainst >= 50 ? round(row.savePct) : null,
        gaa: round(row.goalsAgainstAverage, 2),
        shutouts: row.shutouts,
        saves: row.saves,
        gsax: xga !== null && ga !== null ? round(xga - ga, 1) : null,
        gsaxPer60: xga !== null && ga !== null && minutes >= 300 ? round(((xga - ga) * 60) / minutes, 2) : null,
        hdSavePct: hd >= 20 ? round(1 - num(m.highDangerGoals) / hd) : null,
        xgaPer60: xga !== null && minutes >= 300 ? round((xga * 60) / minutes, 2) : null,
      },
      awards: awardsFor(row.playerId, team.code),
    });
  }

  // Support grades (the situation around a player, graded across the league):
  // - Linemates (skaters): his team's expected-goal share at 5-on-5 with him off the ice, curved over
  //   every skater
  // - Defense (goalies): the shot quality he faced, expected goals against per 60, lower is better,
  //   curved over the goalies
  const skaterRows = ['C', 'LW', 'RW', 'D'].flatMap((tab) => out[tab]);
  const linemates = curve(new Map(skaterRows.map((u) => [u.gsisId, u._offIce ?? NaN])));
  for (const u of skaterRows) {
    u.stats.linemates = linemates.get(u.gsisId) ?? null;
    delete u._offIce;
  }
  const defense = curve(new Map(out.G.filter((g) => g.games >= 5).map((g) => [g.gsisId, g._faced === null ? NaN : -g._faced])));
  for (const g of out.G) {
    g.stats.defense = defense.get(g.gsisId) ?? null;
    delete g._faced;
  }

  // Head coaches (coaches.mjs), and every player's Coaching grade: his team's Coaching Lift, curved
  // over the teams
  const coached = await coachesFor({
    season,
    part,
    get,
    web: WEB,
    records: RECORDS,
    report: (kind) => partReport(kind, season, part),
    teams,
    logos,
    teamAwards,
    mpSkaters,
    priorSkaters,
    mpTeams,
    share,
  });
  const coaching = curve(coached.lift);
  for (const u of [...skaterRows, ...out.G]) {
    u.stats.coaching = coaching.get(u._team) ?? null;
    delete u._team;
  }
  // (each team's last seven games, newest first, from its season schedule: the Teams tab's Recent; the
  // regular season's and the playoffs' (the playoffs' alone for the playoffs), 1 a win, 0 a loss, 0.5 a tie
  // (before shootouts); and which went to overtime or a shootout, "OT" or "SO" (a lighter square on the
  // site, the same result))
  const recentTypes = part === 'post' ? [3] : [2, 3];
  const lastSeven = new Map();
  for (const tri of new Set(coached.rows.map((c) => c._team).filter(Boolean))) {
    const games = (await get(`${WEB}/club-schedule-season/${tri}/${seasonId(season)}`).catch(() => null))?.games ?? [];
    const last = games
      .filter((g) => recentTypes.includes(g.gameType) && (g.gameState === 'OFF' || g.gameState === 'FINAL'))
      .sort((x, y) => y.gameDate.localeCompare(x.gameDate) || y.id - x.id)
      .slice(0, 7)
      .map((g) => (g.homeTeam.abbrev === tri ? [g.homeTeam, g.awayTeam, 'vs', g] : [g.awayTeam, g.homeTeam, '@', g]));
    lastSeven.set(tri, {
      results: last.map(([mine, theirs]) => (mine.score > theirs.score ? 1 : mine.score === theirs.score ? 0.5 : 0)),
      ot: last.map(([, , , g]) => (['OT', 'SO'].includes(g.gameOutcome?.lastPeriodType) ? g.gameOutcome.lastPeriodType : null)),
      // (whom each came against, "@ Toronto Maple Leafs" away or "vs Boston Bruins" at home)
      vs: last.map(([, theirs, where]) => `${where} ${[theirs.placeName?.default, theirs.commonName?.default].filter(Boolean).join(' ') || theirs.abbrev}`),
    });
  }
  for (const c of coached.rows) {
    const recent = lastSeven.get(c._team);
    if (recent?.results.length) {
      Object.assign(c, { teamLastFive: recent.results, teamLastFiveVs: recent.vs });
      if (recent.ot.some(Boolean)) c.teamLastFiveOt = recent.ot;
    }
    delete c._team;
  }
  out.HC = coached.rows;
  console.log(coached.log);
  // (early in the season, Linemates, Defense and Coaching start from the team's last season: libs/ranker/scripts/early-season)
  if (current && part === 'regular') console.log(await blendWithLastSeason({ staticDir: STATIC, season, rows: out, keys: ['linemates', 'defense', 'coaching'], fullAt: 20 }));

  for (const tab of Object.keys(out)) out[tab].sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(dir, { recursive: true });
  // (compact: the files are served to the browser as is)
  await writeFile(file, JSON.stringify(out));
  // (this season's game logs, for the card's Game Log tab: the NHL's API doesn't let the site ask it)
  if (current && part === 'regular') await writeGameLogs(season, skaterRows, out.G);
  // (each team against forwards and defensemen, from the season's game logs: vs-position.mjs; on its coaches' rows)
  addVsPosition(dir, path.join(STATIC, 'game-logs'), season, [part]);
  const champion = [...teamAwards].find(([, a]) => a.includes('cup'))?.[0] ?? '?';
  const rookieCount = [...skaterRows, ...out.G].filter((u) => u.rookie).length;
  console.log(
    `${season} ${part}: ${Object.keys(out).map((tab) => `${out[tab].length} ${tab}`).join(', ')} (${mpAll.size ? 'MoneyPuck' : 'no MoneyPuck'}; ${rookieCount} rookies; Cup ${champion})`,
  );
}

// Newest first, each season's parts in turn (PART=post,all: only those)
const seasons = process.env.ALL
  ? Array.from({ length: CURRENT_SEASON - FIRST_SEASON }, (_, i) => CURRENT_SEASON - 1 - i)
  : [Number(process.env.SEASON ?? CURRENT_SEASON)];
const parts = process.env.PART ? process.env.PART.split(',').map((p) => p.trim()) : Object.keys(PARTS);
for (const p of parts) if (!PARTS[p]) throw new Error(`PART: ${p}? (${Object.keys(PARTS).join(', ')})`);
const started = Date.now();
for (const season of seasons) {
  cacheable = season < CURRENT_SEASON;
  for (const part of parts) await buildSeason(season, part);
}
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
