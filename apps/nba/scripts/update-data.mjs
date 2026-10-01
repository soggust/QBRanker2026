// Builds the NBA app's data: every tab's players (and head coaches) for a season, from
// Basketball-Reference (totals, advanced stats, play-by-play on/off, positions and award voting, team
// ratings, coaches, Coach of the Year, the Finals) and ESPN (player ids for headshots, and the injury
// report for this season).
//
// Usage: npm run nba:update-data                 this season, to src/StaticData/
//        SEASON=2019 npm run nba:update-data     a finished season, to src/StaticData/seasons/2019/
//        ALL=1 npm run nba:update-data           every finished season from 2001 to last year
//
// A season is named for the year it ends in, like Basketball-Reference and ESPN do: 2025 is 2024-25.
//
// Writes skill-players.json in the shape the app reads: { PG: [...], SG: [...], SF: [...], PF: [...],
// C: [...], HC: [...] }, each player { id, gsisId, name, teamLogo, teamName, games, stats, awards,
// injured?, injuryStatus? }. gsisId is the Basketball-Reference id ("jamesle01", a coach's
// "kerrst01c"); id is ESPN's (headshots; none for coaches).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { curve } from '../../../libs/ranker/scripts/grades.mjs';

const CURRENT_SEASON = 2026;
const FIRST_SEASON = 2001;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const BBREF = 'https://www.basketball-reference.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const TABS = ['PG', 'SG', 'SF', 'PF', 'C'];
// Head coaches: every coach with at least this many games that season (interim coaches included)
const MIN_COACH_GAMES = 1;
// Everyone who got into a game (a minute or more); the app's Min Games setting narrows it from there
const MIN_MINUTES = 1;

// Basketball-Reference's team codes -> the franchise's code today (its icon: assets/NBA_Icons/<code>.svg)
const FRANCHISE = { NJN: 'BRK', SEA: 'OKC', VAN: 'MEM', CHH: 'CHO', CHA: 'CHO', NOH: 'NOP', NOK: 'NOP' };
const franchise = (code) => FRANCHISE[code] ?? code;

// Awards that show as badges: Basketball-Reference's award codes (a winner's voting finish is "-1")
const WINNER_AWARDS = { 'MVP-1': 'mvp', 'DPOY-1': 'dpoy', 'ROY-1': 'roy', '6MOY-1': 'smoy', 'MIP-1': 'mip', 'CPOY-1': 'cpoy' };
const TEAM_AWARDS = { NBA1: 'nba1', NBA2: 'nba2', NBA3: 'nba3', DEF1: 'def1', DEF2: 'def2', AS: 'as' };

// Basketball-Reference asks for no more than 20 requests a minute
let lastRequest = 0;
async function page(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 3200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404) return '';
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 20000 * attempt));
    }
  }
}

async function json(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

// A Basketball-Reference table's rows (some tables sit inside HTML comments; the text is the same),
// each { stat: text, ..., _id: the player's or team's code, _partial: a traded player's one-team row }
function table(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const body = html.slice(start, end);
  const rows = [];
  for (const [, attrs, cells] of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    if (!/data-stat=/.test(cells) || /class="[^"]*\bthead\b/.test(attrs)) continue;
    const row = { _partial: /partial_table/.test(attrs) };
    for (const [, stat, inner] of cells.matchAll(/<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)) row[stat] = decode(inner);
    // (team links are single-quoted on some pages)
    row._id = cells.match(/data-append-csv="([^"]+)"/)?.[1] ?? cells.match(/href=['"]\/teams\/([A-Z]{3})\//)?.[1] ?? null;
    // (a coach's row: his id, from the link to his page)
    row._coach = cells.match(/\/coaches\/([a-z0-9]+)\.html/)?.[1] ?? null;
    if (row.name_display === 'League Average') continue;
    rows.push(row);
  }
  return rows;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
// ".473" -> 47.3 (percentage points)
const pct = (v) => (num(v) === null ? null : round(num(v) * 100, 1));

// ESPN's athletes for a season (id and name), for headshots: name -> id
const norm = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
const espnIds = new Map();
async function espnAthletes(season) {
  const out = new Map();
  try {
    const data = await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?season=${season}&seasontype=2&limit=1000`);
    for (const a of data.athletes ?? []) {
      const key = norm(a.athlete.displayName);
      out.set(key, Number(a.athlete.id));
      espnIds.set(key, Number(a.athlete.id));
    }
  } catch {
    // (no ESPN list for the season: players keep any id found in another season)
  }
  return out;
}

// This season's injury report: ESPN athlete id -> status ("Out", "Day-To-Day"...)
async function injuries() {
  const out = new Map();
  try {
    const data = await json('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries');
    for (const team of data.injuries ?? []) {
      for (const i of team.injuries ?? []) {
        const id = Number(i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ?? i.athlete?.id);
        if (id) out.set(id, i.status ?? 'Injured');
      }
    }
  } catch {
    // (no report: nobody is marked)
  }
  return out;
}

async function buildSeason(season) {
  const current = season === CURRENT_SEASON;
  const totals = table(await page(`${BBREF}/leagues/NBA_${season}_totals.html`), 'totals_stats');
  const advanced = table(await page(`${BBREF}/leagues/NBA_${season}_advanced.html`), 'advanced');
  const pbp = table(await page(`${BBREF}/leagues/NBA_${season}_play-by-play.html`), 'pbp_stats');
  const league = await page(`${BBREF}/leagues/NBA_${season}.html`);
  const playoffs = await page(`${BBREF}/playoffs/NBA_${season}.html`);
  const coachRows = table(await page(`${BBREF}/leagues/NBA_${season}_coaches.html`), 'NBA_coaches');
  const coy = (await page(`${BBREF}/awards/awards_${season}.html`))
    .split('id="coy"')[1]
    ?.match(/\/coaches\/([a-z0-9]+)\.html/)?.[1];
  // Last season's Box Plus/Minus (the roster's talent coming in, for the coaching lift below)
  const priorAdvanced = table(await page(`${BBREF}/leagues/NBA_${season - 1}_advanced.html`), 'advanced');
  const espn = await espnAthletes(season);
  const injured = current ? await injuries() : new Map();

  // Teams: name, record, pace (possessions per 48 minutes), ratings (points per 100 possessions) and
  // the wins their point differential implies
  const teams = new Map();
  for (const row of table(league, 'advanced-team')) {
    if (!row._id) continue;
    teams.set(row._id, {
      name: row.team?.replace(/\*$/, '').trim(),
      wins: num(row.wins),
      losses: num(row.losses),
      pace: num(row.pace),
      ortg: num(row.off_rtg),
      drtg: num(row.def_rtg),
      net: num(String(row.net_rtg ?? '').replace('+', '')),
      pythWins: num(row.wins_pyth),
    });
  }
  // The Finals: the champion and the runner-up (their conference's champion)
  // (the series table's first row: "<a href='/teams/NYK/2026.html'>...</a> over <a href='/teams/SAS/...")
  const finals = playoffs.match(/<strong>Finals<\/strong>[\s\S]*?\/teams\/([A-Z]{3})\/\d+\.html['"]>[^<]*<\/a>\s*over\s*<a href=['"]\/teams\/([A-Z]{3})\//);
  const [champion, runnerUp] = finals ? [finals[1], finals[2]] : [null, null];

  // A player's whole season (a traded player's combined row) and his last team
  const byId = (rows) => {
    const whole = new Map();
    const lastTeam = new Map();
    for (const row of rows) {
      if (!row._id) continue;
      if (row._partial) {
        lastTeam.set(row._id, row.team_name_abbr);
        continue;
      }
      if (!whole.has(row._id)) whole.set(row._id, row);
    }
    return { whole, lastTeam };
  };
  const t = byId(totals);
  const adv = byId(advanced).whole;
  const onOff = byId(pbp).whole;

  // Supporting cast: each team's minutes and minutes-weighted Box Plus/Minus, from every player's
  // rows for that team (a traded player counts for each of his teams)
  const castByTeam = new Map();
  for (const row of advanced) {
    const code = row.team_name_abbr;
    if (!row._id || !code || /\dTM|TOT/.test(code)) continue;
    const mp = num(row.mp) ?? 0;
    const c = castByTeam.get(code) ?? { mp: 0, bpm: 0 };
    castByTeam.set(code, { mp: c.mp + mp, bpm: c.bpm + mp * (num(row.bpm) ?? 0) });
  }
  const ownRow = new Map();
  for (const row of advanced) if (row._id && !/\dTM|TOT/.test(row.team_name_abbr)) ownRow.set(`${row._id}/${row.team_name_abbr}`, row);

  // Coaching lift: how much better the team played than its roster's talent coming in. The talent is
  // last season's Box Plus/Minus of the players the team used, weighted by their minutes for it this
  // season (a newcomer to the league counts as a replacement-level -2); five of them on the floor,
  // regressed a quarter of the way to average (last season doesn't carry over in full), predict a
  // net rating. The lift is the team's net rating minus that.
  const priorBpm = new Map();
  for (const row of priorAdvanced) {
    if (!row._id || row._partial) continue;
    if (!priorBpm.has(row._id)) priorBpm.set(row._id, { bpm: num(row.bpm) ?? 0, mp: num(row.mp) ?? 0 });
  }
  const talent = new Map();
  for (const row of advanced) {
    const code = row.team_name_abbr;
    if (!row._id || !code || /\dTM|TOT/.test(code)) continue;
    const mp = num(row.mp) ?? 0;
    const prior = priorBpm.get(row._id);
    // (a short prior season says little: blend toward replacement level under 500 minutes)
    const known = prior ? Math.min(1, prior.mp / 500) : 0;
    const bpm = prior ? known * prior.bpm + (1 - known) * -2 : -2;
    const tt = talent.get(code) ?? { mp: 0, bpm: 0 };
    talent.set(code, { mp: tt.mp + mp, bpm: tt.bpm + mp * bpm });
  }
  const lift = new Map();
  for (const [code, team] of teams) {
    const tt = talent.get(code);
    if (!tt?.mp || team.net === null || !priorAdvanced.length) continue;
    lift.set(code, Math.round((team.net - 5 * 0.75 * (tt.bpm / tt.mp)) * 10) / 10);
  }

  // Each team's league rank in offensive rating (highest first) and defensive rating (lowest first)
  const rankBy = (key, dir) => {
    const ranked = [...teams].filter(([, t]) => t[key] !== null).sort((a, b) => dir * (a[1][key] - b[1][key]));
    return new Map(ranked.map(([code], i) => [code, i + 1]));
  };
  const offRank = rankBy('ortg', -1);
  const defRank = rankBy('drtg', 1);

  // Head coaches: one row per coach and team (an interim coach has his own games and record; the
  // team's ratings are its whole season's)
  const coaches = [];
  for (const row of coachRows) {
    const code = row.team;
    const coachId = row._coach;
    const g = num(row.cur_g) ?? 0;
    if (!coachId || !code || g < MIN_COACH_GAMES) continue;
    const team = teams.get(code);
    const wins = num(row.cur_w) ?? 0;
    const losses = num(row.cur_l) ?? 0;
    const awards = [];
    if (coachId === coy) awards.push('coy');
    if (code === champion) awards.push('champ');
    if (code === runnerUp) awards.push('finals');
    coaches.push({
      id: null,
      gsisId: coachId,
      name: row.coach,
      teamLogo: `assets/NBA_Icons/${franchise(code)}.svg`,
      teamName: team?.name ?? null,
      games: g,
      _team: code,
      stats: {
        wins,
        losses,
        winPct: wins + losses ? round(wins / (wins + losses), 3) : null,
        playoffWins: num(row.cur_w_p) ?? 0,
        netRtg: team?.net ?? null,
        ortg: team?.ortg ?? null,
        drtg: team?.drtg ?? null,
        offRank: offRank.get(code) ?? null,
        defRank: defRank.get(code) ?? null,
        pace: team?.pace ?? null,
        lift: lift.get(code) ?? null,
        // (his share of the team's wins over what its point differential implies)
        pythDiff: team && team.pythWins !== null && team.wins + team.losses ? round(((team.wins - team.pythWins) * g) / (team.wins + team.losses), 1) : null,
      },
      awards,
    });
  }
  const out = Object.fromEntries(TABS.map((tab) => [tab, []]));
  for (const [id, row] of t.whole) {
    const mp = num(row.mp) ?? 0;
    if (mp < MIN_MINUTES) continue;
    // Tab: the listed position ("SG-PG" -> SG)
    const tab = TABS.find((p) => p === String(row.pos).split('-')[0]);
    if (!tab) continue;
    const a = adv.get(id) ?? {};
    const p = onOff.get(id) ?? {};
    const code = /\dTM|TOT/.test(row.team_name_abbr) ? t.lastTeam.get(id) : row.team_name_abbr;
    const team = teams.get(code);
    const espnId = espn.get(norm(row.name_display)) ?? espnIds.get(norm(row.name_display)) ?? null;
    const awards = new Set();
    for (const token of String(row.awards ?? '').split(',').map((s) => s.trim())) {
      if (WINNER_AWARDS[token]) awards.add(WINNER_AWARDS[token]);
      if (TEAM_AWARDS[token]) awards.add(TEAM_AWARDS[token]);
    }
    // (on a team that reached the Finals: every row from that team gets the cup)
    if (code && code === champion) awards.add('champ');
    if (code && code === runnerUp) awards.add('finals');
    // Supporting cast: his last team's other players' minutes-weighted BPM (without him)
    const own = ownRow.get(`${id}/${code}`);
    const cast = castByTeam.get(code);
    const ownMp = num(own?.mp) ?? 0;
    const castScore = cast && cast.mp - ownMp > 0 ? (cast.bpm - ownMp * (num(own?.bpm) ?? 0)) / (cast.mp - ownMp) : null;

    const g = num(row.games) ?? 0;
    out[tab].push({
      id: espnId,
      gsisId: id,
      name: row.name_display.replace(/\*$/, ''),
      teamLogo: `assets/NBA_Icons/${franchise(code ?? 'NBA')}.svg`,
      teamName: team?.name ?? null,
      games: g,
      _team: code,
      _cast: castScore,
      stats: {
        minutes: mp,
        gamesStarted: num(row.games_started),
        points: num(row.pts),
        rebounds: num(row.trb),
        assists: num(row.ast),
        steals: num(row.stl),
        blocks: num(row.blk),
        turnovers: num(row.tov),
        threes: num(row.fg3),
        fgPct: pct(row.fg_pct),
        fg3Pct: num(row.fg3a) >= 25 ? pct(row.fg3_pct) : null,
        ftPct: num(row.fta) >= 20 ? pct(row.ft_pct) : null,
        per: num(a.per),
        tsPct: pct(a.ts_pct),
        usgPct: num(a.usg_pct),
        astPct: num(a.ast_pct),
        tovPct: num(a.tov_pct),
        trbPct: num(a.trb_pct),
        stlPct: num(a.stl_pct),
        blkPct: num(a.blk_pct),
        ws: num(a.ws),
        ws48: num(a.ws_per_48),
        bpm: num(a.bpm),
        dbpm: num(a.dbpm),
        vorp: num(a.vorp),
        onOff: num(String(p.plus_minus_net ?? '').replace('+', '')),
        // His team's record (a traded player: his last team's)
        wins: team?.wins ?? null,
        losses: team?.losses ?? null,
        winPct: team && team.wins + team.losses ? round(team.wins / (team.wins + team.losses), 3) : null,
      },
      awards: [...awards],
      ...(espnId && injured.has(espnId) ? { injured: true, injuryStatus: injured.get(espnId) } : {}),
    });
  }

  // Support grades (the situation around a player, graded across the league):
  // - Teammates: the rest of his team's quality, their minutes-weighted Box Plus/Minus without him,
  //   curved over every player
  // - Coaching: his team's coaching lift (above), curved over the teams
  const everyone = TABS.flatMap((tab) => out[tab]);
  const cast = curve(new Map(everyone.map((u) => [u.gsisId, u._cast ?? NaN])));
  const coaching = curve(lift);
  for (const unit of everyone) {
    unit.stats.teammates = cast.get(unit.gsisId) ?? null;
    unit.stats.coaching = coaching.get(unit._team) ?? null;
    delete unit._cast;
    delete unit._team;
  }
  for (const c of coaches) delete c._team;
  out.HC = coaches;

  for (const tab of [...TABS, 'HC']) out[tab].sort((a, b) => a.name.localeCompare(b.name));
  const dir = current ? STATIC : path.join(STATIC, 'seasons', String(season));
  await mkdir(dir, { recursive: true });
  // (compact: the files are served to the browser as is)
  await writeFile(path.join(dir, 'skill-players.json'), JSON.stringify(out));
  const photos = everyone.filter((u) => u.id).length;
  console.log(`${season}: ${[...TABS, 'HC'].map((tab) => `${out[tab].length} ${tab}`).join(', ')} (${photos}/${everyone.length} with ESPN ids; champion ${champion ?? '?'} over ${runnerUp ?? '?'})`);
}

// Newest first, so a player's ESPN id from a later season can fill in an older one
const seasons = process.env.ALL
  ? Array.from({ length: CURRENT_SEASON - FIRST_SEASON }, (_, i) => CURRENT_SEASON - 1 - i)
  : [Number(process.env.SEASON ?? CURRENT_SEASON)];
for (const season of seasons) await buildSeason(season);
