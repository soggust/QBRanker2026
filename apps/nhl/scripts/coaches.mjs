// NHL head coaches for the Head Coaches tab and every player's Coaching grade (update-data.mjs).
//
// Who coached: each game's head coach, from the NHL's game center (its right rail names both
// benches). A team's season is checked at its first and latest game; when they differ, a binary search
// finds the game the new coach took over (a firing mid-season), about 7 lookups. What's found is kept
// in coaches-cache.json, so a night's update only checks the games since.
//
// Each coach's own games: his record (W-L-OTL, ranked on points percentage), goal differential per game,
// and his points over what his goals for and against imply (close games, overtime and shootouts: a
// Pythagorean expectation, exponent 2, for the 2 points of a game, plus the league's rate of extra
// points from games that go past regulation, so it averages out at zero). The coach who finished the season gets its playoff wins, Cup
// and conference title.
//
// The team's season (every coach it had shares it, like the NBA's): its 5-on-5 expected-goal share
// (MoneyPuck), power play and penalty kill, its league ranks in goals for and against per game, and
// the Coaching Lift: its 5-on-5 expected-goal share over what its skaters predicted. The prediction is
// last season's on-ice expected-goal share of the skaters the team used, weighted by their 5-on-5 ice
// time this season (a skater new to the league, or with little ice time last season, leans toward a
// replacement-level 47%), regressed a quarter of the way to average (last season doesn't carry over
// in full). In points: +3 is a team playing three points of expected-goal share above its roster.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE = path.join(import.meta.dirname, 'coaches-cache.json');
const JACK_ADAMS = 2;
const REPLACEMENT = 0.47;
// (5-on-5 seconds of ice time last season that make a skater's share count in full: 500 minutes)
const KNOWN_ICE = 500 * 60;
// MoneyPuck's older team codes -> the NHL's
const MP_CODES = { 'S.J': 'SJS', 'T.B': 'TBL', 'L.A': 'LAK', 'N.J': 'NJD' };

const slug = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-|-$/g, '');

// The coach rows, and each team's Coaching Lift (for the players' grades)
export async function coachesFor({ season, current, get, web, records, report, teams, logos, teamAwards, mpSkaters, priorSkaters, mpTeams, share }) {
  let cache = {};
  try {
    cache = JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {
    // (a first run: every team-season is looked up)
  }
  const sid = `${season - 1}${season}`;
  const codes = [...teams.keys()];
  // MoneyPuck's code for a team -> the NHL's that season (Arizona was Phoenix until 2014)
  const mpCode = (code) => {
    const c = MP_CODES[code] ?? code;
    if (c === 'ARI' && !teams.has('ARI') && teams.has('PHX')) return 'PHX';
    return c;
  };

  // Each team's games and coaches
  const stints = new Map();
  const playoffWins = new Map();
  let lookups = 0;
  for (const code of codes) {
    const schedule = (await get(`${web}/club-schedule-season/${code}/${sid}`))?.games ?? [];
    const done = (g) => g.gameState === 'OFF' || g.gameState === 'FINAL';
    const games = schedule.filter((g) => g.gameType === 2 && done(g));
    const playoffs = schedule.filter((g) => g.gameType === 3 && done(g));
    if (!games.length) continue;
    const coachAt = async (i) => {
      const g = games[i];
      lookups++;
      const rail = await get(`${web}/gamecenter/${g.id}/right-rail`);
      const side = g.homeTeam.abbrev === code ? 'homeTeam' : 'awayTeam';
      return rail?.gameInfo?.[side]?.headCoach?.default ?? null;
    };
    const key = `${season}/${code}`;
    const known = cache[key]?.n <= games.length ? cache[key] : null;
    const entry = known ?? { n: 0, stints: [] };
    if (!entry.n) {
      entry.stints = [{ coach: await coachAt(0), from: 0 }];
      entry.n = 1;
    }
    // (extend to the latest game; a coach change in between is found by halving the gap)
    while (entry.n < games.length) {
      const last = games.length - 1;
      const sitting = entry.stints.at(-1).coach;
      const latest = await coachAt(last);
      if (latest === sitting) {
        entry.n = games.length;
        break;
      }
      let lo = entry.n - 1;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if ((await coachAt(mid)) === sitting) lo = mid;
        else hi = mid;
      }
      entry.stints.push({ coach: await coachAt(hi), from: hi });
      entry.n = hi + 1;
    }
    cache[key] = entry;
    stints.set(code, { games, list: entry.stints });
    const won = playoffs.filter((g) => {
      const us = g.homeTeam.abbrev === code ? g.homeTeam : g.awayTeam;
      const them = g.homeTeam.abbrev === code ? g.awayTeam : g.homeTeam;
      return us.score > them.score;
    }).length;
    playoffWins.set(code, won);
  }
  await writeFile(CACHE, JSON.stringify(cache));

  // The team's season: special teams and goals per game (the stats API), 5-on-5 expected-goal share
  const summary = await report('team/summary', season);
  const teamIds = new Map(((await get('https://api.nhle.com/stats/rest/en/team'))?.data ?? []).map((t) => [t.id, t.triCode]));
  const season5 = new Map();
  for (const row of summary) {
    const code = teamIds.get(row.teamId);
    if (code) season5.set(code, { pp: row.powerPlayPct, pk: row.penaltyKillPct, gf: row.goalsForPerGame, ga: row.goalsAgainstPerGame });
  }
  const xgf = new Map();
  // (and for the Teams tab: 5-on-5 shot-attempt share and PDO, its shooting plus save percentage, the
  // classic luck number, 100 is average; and its goalies' goals saved above expected, every situation)
  const team5 = new Map();
  for (const row of mpTeams.filter((r) => r.situation === '5on5')) {
    const f = Number(row.xGoalsFor);
    const a = Number(row.xGoalsAgainst);
    if (f + a > 0) xgf.set(mpCode(row.team), f / (f + a));
    const sogF = Number(row.shotsOnGoalFor);
    const sogA = Number(row.shotsOnGoalAgainst);
    team5.set(mpCode(row.team), {
      cfPct: Number(row.corsiPercentage) || null,
      pdo: sogF && sogA ? Math.round((Number(row.goalsFor) / sogF + 1 - Number(row.goalsAgainst) / sogA) * 1000) / 10 : null,
    });
  }
  const gsax = new Map();
  for (const row of mpTeams.filter((r) => r.situation === 'all')) {
    gsax.set(mpCode(row.team), Math.round((Number(row.xGoalsAgainst) - Number(row.goalsAgainst)) * 10) / 10);
  }
  const rankBy = (key, dir) => {
    const ranked = [...season5].filter(([, t]) => t[key] !== null && t[key] !== undefined).sort((a, b) => dir * (a[1][key] - b[1][key]));
    return new Map(ranked.map(([code], i) => [code, i + 1]));
  };
  const offRank = rankBy('gf', -1);
  const defRank = rankBy('ga', 1);

  // The Coaching Lift
  const prior = new Map();
  for (const row of priorSkaters.filter((r) => r.situation === '5on5')) {
    const s = share(row, 'OnIce');
    if (s !== null) prior.set(Number(row.playerId), { share: s, ice: Number(row.icetime) || 0 });
  }
  const talent = new Map();
  for (const row of mpSkaters.filter((r) => r.situation === '5on5')) {
    const ice = Number(row.icetime) || 0;
    if (!ice) continue;
    const before = prior.get(Number(row.playerId));
    const weight = before ? Math.min(1, before.ice / KNOWN_ICE) : 0;
    const expected = before ? weight * before.share + (1 - weight) * REPLACEMENT : REPLACEMENT;
    const code = mpCode(row.team);
    const t = talent.get(code) ?? { ice: 0, sum: 0 };
    talent.set(code, { ice: t.ice + ice, sum: t.sum + ice * expected });
  }
  const lift = new Map();
  if (prior.size) {
    for (const [code, t] of talent) {
      const actual = xgf.get(code);
      if (actual === undefined || !t.ice) continue;
      const predicted = 0.5 + 0.75 * (t.sum / t.ice - 0.5);
      lift.set(code, Math.round((actual - predicted) * 1000) / 10);
    }
  }

  // The Jack Adams winner (name and team)
  const awards = (await get(`${records}/award-details?cayenneExp=${encodeURIComponent(`seasonId=${sid} and trophyId=${JACK_ADAMS}`)}`))?.data ?? [];
  const adams = awards.find((a) => a.status === 'WINNER');
  const adamsTeam = adams ? teamIds.get(adams.teamId) : null;

  // The league's extra points per game from overtime losses (a game past regulation hands out 3)
  let leagueGames = 0;
  let leagueOtl = 0;
  for (const { games } of stints.values()) {
    leagueGames += games.length;
    leagueOtl += games.filter((g) => g.gameOutcome?.lastPeriodType === 'OT' || g.gameOutcome?.lastPeriodType === 'SO').length / 2;
  }
  const otRate = leagueGames ? (2 * leagueOtl) / leagueGames : 0;

  // The rows: one per coach and team
  const rows = [];
  const ids = new Set();
  for (const [code, { games, list }] of stints) {
    list.forEach((stint, i) => {
      if (!stint.coach) return;
      const mine = games.slice(stint.from, list[i + 1]?.from ?? games.length);
      const last = i === list.length - 1;
      // (every stint, however short: the Teams tab adds a team's up; the Head Coaches tab's Min Games
      // setting hides the shortest)
      let w = 0;
      let l = 0;
      let otl = 0;
      let gf = 0;
      let ga = 0;
      for (const g of mine) {
        const us = g.homeTeam.abbrev === code ? g.homeTeam : g.awayTeam;
        const them = g.homeTeam.abbrev === code ? g.awayTeam : g.homeTeam;
        gf += us.score;
        ga += them.score;
        if (us.score > them.score) w++;
        else if (g.gameOutcome?.lastPeriodType === 'OT' || g.gameOutcome?.lastPeriodType === 'SO') otl++;
        else l++;
      }
      const gp = mine.length;
      const pyth = gf + ga ? gf ** 2 / (gf ** 2 + ga ** 2) : 0.5;
      const t = season5.get(code);
      const finished = last;
      let gsisId = slug(stint.coach);
      if (ids.has(gsisId)) gsisId += `-${code.toLowerCase()}`;
      ids.add(gsisId);
      rows.push({
        id: null,
        gsisId,
        name: stint.coach,
        teamLogo: logos.get(code) ?? 'assets/NHL_Icons/NHL.svg',
        teamName: teams.get(code)?.name ?? null,
        games: gp,
        _team: code,
        stats: {
          wins: w,
          losses: l,
          ties: otl,
          winPct: Math.round(((2 * w + otl) / (2 * gp)) * 1000) / 1000,
          playoffWins: finished ? (playoffWins.get(code) ?? 0) : 0,
          goalDiff: Math.round(((gf - ga) / gp) * 100) / 100,
          ptsOver: Math.round((2 * w + otl - gp * (2 * pyth + otRate / 2)) * 10) / 10,
          xgfPct: xgf.has(code) ? Math.round(xgf.get(code) * 1000) / 1000 : null,
          ppPct: t?.pp === null || t?.pp === undefined ? null : Math.round(t.pp * 1000) / 1000,
          pkPct: t?.pk === null || t?.pk === undefined ? null : Math.round(t.pk * 1000) / 1000,
          offRank: offRank.get(code) ?? null,
          defRank: defRank.get(code) ?? null,
          lift: lift.get(code) ?? null,
          // (the Teams tab's: not columns here)
          cfPct: team5.get(code)?.cfPct ?? null,
          pdo: team5.get(code)?.pdo ?? null,
          gsaxTeam: gsax.get(code) ?? null,
        },
        awards: [
          ...(adams && adamsTeam === code && slug(adams.fullName) === slug(stint.coach) ? ['coy'] : []),
          ...(finished ? (teamAwards.get(code) ?? []) : []),
        ],
      });
    });
  }
  return { rows, lift, log: `${rows.length} head coaches (${lookups} coach lookups${prior.size ? '' : '; no prior season: no Coaching Lift'})` };
}
