// Builds the NHL app's data: every tab's players for a season, from the NHL's stats API (skater and
// goalie totals, hits / blocks / takeaways, faceoffs, bios for the rookie rule, the standings with each
// team's name, record and logo that season, and the league's award records) and MoneyPuck (expected
// goals, on-ice shot and chance shares, Game Score, goals saved above expected, the shot quality a
// goalie faced).
//
// Usage: npm run nhl:update-data                 this season, to src/StaticData/
//        SEASON=2019 npm run nhl:update-data     a finished season, to src/StaticData/seasons/2019/
//        ALL=1 npm run nhl:update-data           every finished season from 2008-09 to last year
//
// A season is named for the year it ends in, like the NBA app: 2026 is 2025-26 (the NHL calls it
// 20252026, MoneyPuck 2025).
//
// Writes skill-players.json in the shape the app reads: { C: [...], LW: [...], RW: [...], D: [...],
// G: [...] }, each player { id, gsisId, name, teamLogo, teamName, games, stats, awards, rookie }. id
// (headshots) and gsisId are the NHL player id. Team logos are the NHL's own for that season (an era's
// logo in its file name), saved to src/assets/NHL_Icons/ the first time they're seen.
import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { curve } from '../../../libs/ranker/scripts/grades.mjs';

const CURRENT_SEASON = 2026;
// MoneyPuck's season files start with 2008-09
const FIRST_SEASON = 2009;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const ICONS = path.join(ROOT, 'src/assets/NHL_Icons');
const STATS = 'https://api.nhle.com/stats/rest/en';
const WEB = 'https://api-web.nhle.com/v1';
const RECORDS = 'https://records.nhl.com/site/api';
const MONEYPUCK = 'https://moneypuck.com/moneypuck/playerData/seasonSummary';

// The NHL's position codes -> the app's tabs
const TABS = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };

// The award records' trophy ids -> the app's badges. The Cup and the conference titles go on every
// row of those teams; the rest on the winner's row.
const PLAYER_AWARDS = { 8: 'hart', 18: 'vezina', 11: 'norris', 4: 'calder', 17: 'selke', 7: 'conn', 13: 'lindsay', 15: 'rocket', 16: 'artross' };
const CUP = 1;
const CONFERENCE_TITLES = [5, 19];

// A polite pace for every source (a few requests a second at most)
let lastRequest = 0;
async function get(url, as = 'json') {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 350 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'sports-ranker data script' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
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

// Every row of one of the stats API's reports for a season (regular season), in one request (its
// pages aren't in a stable order, so paging skips and repeats rows)
async function report(kind, season) {
  const exp = encodeURIComponent(`seasonId=${seasonId(season)} and gameTypeId=2`);
  return (await get(`${STATS}/${kind}?limit=-1&cayenneExp=${exp}`))?.data ?? [];
}

// A MoneyPuck season file (skaters, goalies or teams), parsed: rows by situation ("all", "5on5")
async function moneypuck(kind, season) {
  const text = await get(`${MONEYPUCK}/${season - 1}/regular/${kind}.csv`, 'text');
  if (!text) return [];
  const [head, ...lines] = text.trim().split('\n');
  const keys = head.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
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

async function buildSeason(season) {
  const current = season === CURRENT_SEASON;
  const [skaters, realtime, faceoffs, skaterBios, goalies, goalieBios, teams, awardRows, teamList] = await Promise.all([
    report('skater/summary', season),
    report('skater/realtime', season),
    report('skater/faceoffwins', season),
    report('skater/bios', season),
    report('goalie/summary', season),
    report('goalie/bios', season),
    standings(season),
    get(`${RECORDS}/award-details?cayenneExp=${encodeURIComponent(`seasonId=${seasonId(season)}`)}`),
    get(`${STATS}/team`),
  ]);
  const [mpSkaters, mpGoalies] = [await moneypuck('skaters', season), await moneypuck('goalies', season)];
  const skaterRookies = await rookies(season, skaterBios, 'skater');
  const goalieRookies = await rookies(season, goalieBios, 'goalie');

  const triCode = new Map((teamList?.data ?? []).map((t) => [t.id, t.triCode]));
  const hits = new Map(realtime.map((r) => [r.playerId, r]));
  const draws = new Map(faceoffs.map((r) => [r.playerId, r.totalFaceoffs ?? 0]));
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
    if (team && a.trophyId === CUP) teamAwards.set(team, [...(teamAwards.get(team) ?? []), 'cup']);
    if (team && CONFERENCE_TITLES.includes(a.trophyId)) teamAwards.set(team, [...(teamAwards.get(team) ?? []), 'conf']);
  }

  // A row's team: the last of a traded player's teams
  const logos = new Map();
  for (const [code, t] of teams) logos.set(code, await logoFile(t.logo, code));
  const teamOf = async (abbrevs) => {
    const code = String(abbrevs ?? '').split(',').pop().trim();
    if (code && !logos.has(code)) logos.set(code, await logoFile(null, code));
    const t = teams.get(code);
    return {
      code,
      logo: logos.get(code) ?? 'assets/NHL_Icons/NHL.svg',
      name: t?.name ?? null,
      // (his last team's record: W-L-OTL, ranked on points percentage)
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
        faceoffPct: row.faceoffWinPct !== null && (draws.get(row.playerId) ?? 0) >= 50 ? round(row.faceoffWinPct) : null,
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

  for (const tab of Object.keys(out)) out[tab].sort((a, b) => a.name.localeCompare(b.name));
  const dir = current ? STATIC : path.join(STATIC, 'seasons', String(season));
  await mkdir(dir, { recursive: true });
  // (compact: the files are served to the browser as is)
  await writeFile(path.join(dir, 'skill-players.json'), JSON.stringify(out));
  const champion = [...teamAwards].find(([, a]) => a.includes('cup'))?.[0] ?? '?';
  const rookieCount = [...skaterRows, ...out.G].filter((u) => u.rookie).length;
  console.log(
    `${season}: ${Object.keys(out).map((tab) => `${out[tab].length} ${tab}`).join(', ')} (${mpAll.size ? 'MoneyPuck' : 'no MoneyPuck'}; ${rookieCount} rookies; Cup ${champion})`,
  );
}

// Newest first
const seasons = process.env.ALL
  ? Array.from({ length: CURRENT_SEASON - FIRST_SEASON }, (_, i) => CURRENT_SEASON - 1 - i)
  : [Number(process.env.SEASON ?? CURRENT_SEASON)];
for (const season of seasons) await buildSeason(season);
