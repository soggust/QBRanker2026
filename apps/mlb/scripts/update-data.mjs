// Builds the MLB app's data: every tab's players for a season, from the MLB Stats API (standard and
// sabermetric stats, WAR back to 2000, awards, the injured list) and Baseball Savant (Statcast: expected
// stats, barrels, hard-hit rate, sprint speed, whiffs; 2015 on, so those columns hide for earlier years).
//
// Usage: npm run mlb:update-data                 this season, to src/StaticData/
//        SEASON=2019 npm run mlb:update-data     a finished season, to src/StaticData/seasons/2019/
//        ALL=1 npm run mlb:update-data           every finished season from 2000 to last year
//
// Writes skill-players.json in the shape the app reads: { C: [...], 1B: [...], ..., SP: [...], RP: [...] },
// each player { id, gsisId, name, teamLogo, teamName, games, stats, awards, injured?, injuryStatus? }.
// gsisId is "H-<id>" for hitters and "P-<id>" for pitchers (a two-way player is on both sides).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const CURRENT_SEASON = 2026;
const FIRST_SEASON = 2000;
const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const API = 'https://statsapi.mlb.com/api/v1';
const SAVANT = 'https://baseballsavant.mlb.com/leaderboard';

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

// A Savant leaderboard CSV as rows keyed by column, by MLBAM id (missing or empty: none)
async function savant(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return new Map();
    const text = (await res.text()).replace(/^﻿/, '');
    const lines = text.trim().split('\n');
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
    return new Map();
  }
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
// rolling average from Baseball Savant's park factors (embedded in its page), by team id
async function parkFactors(season) {
  try {
    const url = `https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=year&year=${season}&batSide=&stat=index_wOBA&condition=All&rolling=3`;
    const html = await (await fetch(url)).text();
    const match = html.match(/var data = (\[.*?\]);/s);
    if (!match) return new Map();
    return new Map(JSON.parse(match[1]).map((row) => [Number(row.main_team_id), Number(row.index_runs)]));
  } catch {
    return new Map();
  }
}

// Grades on a curve (0 = F ... 12 = A+) from scores (higher = better), like the NFL app's support grades
function curve(scores) {
  const ranked = [...scores].filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map(([key], rank) => [key, Math.round(12 * (1 - rank / last) * 10) / 10]));
}

async function statsFor(season, group, type) {
  const url = `${API}/stats?stats=${type}&group=${group}&season=${season}&sportId=1&playerPool=all&limit=5000`;
  const splits = (await json(url)).stats?.[0]?.splits ?? [];
  return new Map(splits.map((s) => [s.player.id, s]));
}

async function awardsFor(season) {
  const out = new Map();
  for (const [badge, ids] of Object.entries(AWARDS)) {
    for (const id of ids) {
      const list = (await json(`${API}/awards/${id}/recipients?season=${season}`).catch(() => ({}))).awards ?? [];
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

// Players on a team's injured list right now (this season only)
async function injuredList() {
  const teams = (await json(`${API}/teams?sportId=1&season=${CURRENT_SEASON}`)).teams ?? [];
  const out = new Map();
  for (const team of teams) {
    const roster = (await json(`${API}/teams/${team.id}/roster?rosterType=40Man&season=${CURRENT_SEASON}`).catch(() => ({}))).roster ?? [];
    for (const r of roster) {
      if (/^D\d/.test(r.status?.code ?? '')) out.set(r.person.id, r.status.description);
    }
  }
  return out;
}

async function buildSeason(season) {
  const current = season === CURRENT_SEASON;
  const [hitting, pitching, sabH, sabP, awards, injured] = await Promise.all([
    statsFor(season, 'hitting', 'season'),
    statsFor(season, 'pitching', 'season'),
    statsFor(season, 'hitting', 'sabermetrics'),
    statsFor(season, 'pitching', 'sabermetrics'),
    awardsFor(season),
    current ? injuredList() : Promise.resolve(new Map()),
  ]);
  const parks = await parkFactors(season);
  // Statcast (2015 on)
  const statcast = season >= 2015;
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
      },
    });
  }

  // Pitchers: starters (at least half their games started) and relievers
  for (const [id, split] of pitching) {
    const s = split.stat;
    const g = s.gamesPlayed ?? 0;
    const gs = s.gamesStarted ?? 0;
    const ip = innings(s.inningsPitched);
    const starter = gs >= g / 2;
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
  // - Defense (pitchers): his team's fielding runs, curved over the teams
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
    teamDef.set(team, (teamDef.get(team) ?? 0) + (num(sab.fielding) ?? 0));
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

  for (const tab of TABS) out[tab].sort((a, b) => a.name.localeCompare(b.name));
  const dir = current ? STATIC : path.join(STATIC, 'seasons', String(season));
  await mkdir(dir, { recursive: true });
  // (compact: the files are served to the browser as is)
  await writeFile(path.join(dir, 'skill-players.json'), JSON.stringify(out));
  console.log(`${season}: ${TABS.map((t) => `${out[t].length} ${t}`).join(', ')}`);
}

const seasons = process.env.ALL
  ? Array.from({ length: CURRENT_SEASON - FIRST_SEASON }, (_, i) => FIRST_SEASON + i)
  : [Number(process.env.SEASON ?? CURRENT_SEASON)];
for (const season of seasons) await buildSeason(season);
