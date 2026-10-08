// The ranker's own team numbers as context terms: each sport's team stats from the site's season archive
// (apps/<sport>/src/StaticData/seasons/<year>/units/TM.json, and the NFL's line and weapons grades and its
// defenses' pressure), the season BEFORE the game's only: those files are whole seasons, so a game in the
// season they cover would be learning from games played after it. The ratings carry last season's scores
// into this one already; these say whether the better-measured numbers behind them (EPA, expected goals,
// net rating, OPS and ERA) add anything, and the replay fits how much.
//
// A season the archive doesn't have yet (the season just finished, before the yearly rollover writes it)
// leaves these at 0 for that season's games.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { term } from './terms.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const archive = (sport, season, file) => path.join(ROOT, 'apps', sport, 'src/StaticData/seasons', String(season), file);
const readJson = (file) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
};

const ranked = (key, on, label, unit) => term(key, 'ranker', on, label, unit);

export const RANKER_TERMS = {
  nfl: [
    ranked('rkNet', 'm', "Last season's EPA", 'per 0.1 EPA a play better (offense less defense) last season'),
    ranked('rkLine', 'm', "Last season's line grade", "per 5 points better offensive line grade (the ranker's) last season"),
    ranked('rkWeapons', 'm', "Last season's weapons grade", "per 5 points better weapons grade (the ranker's) last season"),
    ranked('rkRush', 'm', "Last season's pass rush", 'per 10 points more pressure on the passer last season'),
    ranked('rkScoreT', 't', "Last season's EPA (total)", "to the total per 0.1 EPA a play of both offenses and both defenses' allowed"),
  ],
  nba: [
    ranked('rkNet', 'm', "Last season's net rating", 'per 5 points of net rating better last season'),
    ranked('rkPaceT', 't', "Last season's pace (total)", 'to the total per 5 possessions a game more for both sides'),
    ranked('rkRtgT', 't', "Last season's ratings (total)", "to the total per 5 points of both offenses' and defenses' ratings over average"),
  ],
  nhl: [
    ranked('rkXg', 'm', "Last season's expected goals", 'per 5 points more of the expected-goals share last season'),
    ranked('rkGsax', 'm', "Last season's goaltending", 'per 10 goals saved above expected more last season'),
    ranked('rkPdo', 'm', "Last season's PDO (luck)", 'per point more of shooting plus save percentage last season'),
  ],
  mlb: [
    ranked('rkOps', 'm', "Last season's OPS", 'per .100 better OPS last season'),
    ranked('rkEra', 'm', "Last season's ERA", 'per run lower ERA last season'),
    ranked('rkField', 'm', "Last season's fielding", 'per 10 fielding runs more last season'),
    ranked('rkOpsT', 't', "Last season's OPS (total)", "to the total per .100 of both sides' OPS over average"),
    ranked('rkEraT', 't', "Last season's ERA (total)", "to the total per run of both sides' ERA over average"),
    ranked('rkPark', 't', "Last season's park factor", "to the total per 10 points of the home park's run factor over 100"),
  ],
};

// (old names for teams that kept their ESPN id)
const ALIASES = { Redskins: 'Commanders', 'Football Team': 'Commanders', Indians: 'Guardians', Bucs: 'Buccaneers' };

// A name (full, nickname, or place) as one of ESPN's teams' ids; null when it matches none or several
export function idOf(teams, name) {
  if (!name) return null;
  const n = name.trim();
  const nick = Object.entries(ALIASES).find(([old]) => n.endsWith(old))?.[1];
  const hit =
    teams.find((t) => t.name === n) ??
    teams.find((t) => t.nick === n || t.nick === nick) ??
    teams.find((t) => n.endsWith(` ${t.nick}`)) ??
    (() => {
      const places = teams.filter((t) => n.startsWith(`${t.place} `) || n === t.place);
      return places.length === 1 ? places[0] : null;
    })();
  return hit?.id ?? null;
}

// One season's team numbers by ESPN id (null when the archive hasn't the season), and the league's averages
function season(sport, year, teams) {
  const tm = readJson(archive(sport, year, 'units/TM.json'));
  if (!Array.isArray(tm) || !tm.length) return null;
  const out = new Map();
  for (const t of tm) {
    const id = idOf(teams, t.teamName ?? t.name);
    if (id) out.set(id, { ...t.stats });
  }
  if (sport === 'nfl') {
    const grades = readJson(archive(sport, year, 'data-grades.json'))?.teams ?? {};
    for (const [name, g] of Object.entries(grades)) {
      const id = idOf(teams, name);
      if (id && out.has(id)) Object.assign(out.get(id), { oline: g.oline, weapons: g.weapons });
    }
    for (const d of readJson(archive(sport, year, 'units/DEF.json')) ?? []) {
      const id = idOf(teams, d.name);
      if (id && out.has(id)) out.get(id).pressure = d.stats?.pressureRate;
    }
  }
  const mean = (k) => {
    const v = [...out.values()].map((s) => s[k]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  return { teams: out, mean };
}

// A function of a game giving its ranker terms (from the season before its own) and what they came from
export function rankerOf(sport, teams) {
  const seasons = new Map();
  const get = (year) => {
    if (!seasons.has(year)) seasons.set(year, teams.length ? season(sport, year, teams) : null);
    return seasons.get(year);
  };
  return (g) => {
    const s = get(g.season - 1);
    const h = s?.teams.get(g.home);
    const a = s?.teams.get(g.away);
    if (!h || !a) return null;
    const d = (k, f = 1) => (Number.isFinite(h[k]) && Number.isFinite(a[k]) ? (h[k] - a[k]) * f : 0);
    const both = (k, f = 1) => (Number.isFinite(h[k]) && Number.isFinite(a[k]) ? (h[k] + a[k] - 2 * s.mean(k)) * f : 0);
    const terms =
      sport === 'nfl'
        ? { rkNet: d('netEpa', 10), rkLine: d('oline', 1 / 5), rkWeapons: d('weapons', 1 / 5), rkRush: d('pressure', 10), rkScoreT: both('offEpa', 10) + both('defEpaAllowed', 10) }
        : sport === 'nba'
          ? { rkNet: d('netRtg', 1 / 5), rkPaceT: both('pace', 1 / 5), rkRtgT: (both('ortg') + both('drtg')) / 5 }
          : sport === 'nhl'
            ? { rkXg: d('xgfPct', 20), rkGsax: d('gsaxTeam', 1 / 10), rkPdo: d('pdo') }
            : {
                rkOps: d('ops', 10),
                rkEra: -d('era'),
                rkField: d('fieldingRuns', 1 / 10),
                rkOpsT: both('ops', 10),
                rkEraT: both('era'),
                rkPark: !g.neutral && Number.isFinite(h.parkFactor) ? (h.parkFactor - 100) / 10 : 0,
              };
    const round = (v) => Math.round(v * 1000) / 1000;
    return { terms, info: Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, round(v)])) };
  };
}
