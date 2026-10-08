// The officials: each game's crew (the NBA's three referees and the NHL's two, from ESPN's summaries; the
// NFL's referee, from nflverse; MLB's home-plate umpire, from StatsAPI) and each official's leanings, built
// from the games he worked before the one at hand: how far totals ran over what the two teams usually
// score, how far the home side did better than the teams' own margins, and his whistle (the NBA's free
// throws, the NHL's power plays, the NFL's flags, MLB's strikeouts by the starting pitchers). Each leaning is
// pulled toward average by 40 made-up games of it (a new official counts as average), and a crew's is its
// officials' average. Crews are posted late (the NFL midweek, the NBA and NHL the morning of, MLB the day
// of): a coming game without one has these at 0.

import { summary } from './espn.mjs';
import { pool } from './sources.mjs';

const term = (key, on, label, unit) => ({ key, group: 'officials', on, label, unit });
const WHISTLE = {
  nfl: 'per flag a game more than average its referee calls',
  nba: 'per free throw a game more than average its referees award',
  nhl: 'per power play a game more than average its referees award',
  mlb: "per strikeout a 9 innings more than average its plate umpire's zone gives the starters",
};

export const OFFICIAL_TERMS = Object.fromEntries(
  ['nfl', 'nba', 'nhl', 'mlb'].map((sport) => [
    sport,
    [
      term('refTotal', 't', sport === 'mlb' ? 'Plate umpire (total)' : 'Officials (total)', 'per point (run, goal) a game its crew has run over what the teams usually score'),
      term('refHome', 'm', sport === 'mlb' ? 'Plate umpire (home lean)' : 'Officials (home lean)', "per point (run, goal) a game the home side has beaten the teams' own margins with this crew"),
      term('refWhistle', 't', sport === 'mlb' ? 'Plate umpire (zone)' : 'Officials (whistle)', WHISTLE[sport]),
      ...(sport === 'mlb' ? [term('refZoneX', 't', 'Umpire zone x strikeout pitchers', "per strikeout a 9 innings of his zone's lean times the starters' strikeouts over average")] : []),
    ],
  ]),
);

// (a game's referees by name, from its summary: the NBA's three, the NHL's two, not the linesmen)
export function refereesOf(body) {
  return (body?.gameInfo?.officials ?? []).filter((o) => /referee/i.test(o.position?.name ?? 'Referee')).map((o) => o.displayName ?? o.fullName);
}

// The coming NBA and NHL games' crews, from their summaries (posted the morning of)
export async function gatherOfficials(sport, cfg, upcoming, live) {
  if (sport !== 'nba' && sport !== 'nhl') return;
  await pool(upcoming, 4, async ({ game }) => {
    const refs = refereesOf(await summary(cfg.league, game.id));
    if (refs.length) live.get(game.id).refs = refs;
  });
}

// A game's crew and whistle by sport: [names or ids], and the game's whistle count (null before it's played)
function crewOf(sport, g, facts, live) {
  const l = live.get(g.id);
  if (sport === 'nba' || sport === 'nhl') {
    const f = facts.games?.[g.id];
    const crew = g.final ? (f?.r ?? []) : (l?.refs ?? []);
    const whistle = g.final && f?.w ? (sport === 'nba' ? f.w[0] + f.w[1] : f.w[0] + f.w[1]) : null;
    return { crew, whistle };
  }
  if (sport === 'nfl') {
    const row = facts.nfl?.get(g.id);
    const ref = row?.referee || null;
    const flags = facts.plays?.[g.id]?.[4];
    return { crew: ref ? [ref] : [], whistle: g.final && Number.isFinite(flags) ? flags : null };
  }
  const f = g.final ? facts.games?.[g.id] : l;
  return { crew: f?.u ? [String(f.u)] : [], whistle: null };
}

// The officials' terms for each game, in date order (learn: once it's final, what it taught about its crew)
export function officialsOf(sport, facts, live, extra) {
  const K = 40;
  const refs = new Map();
  const teams = new Map();
  const lg = { total: null, margin: 0, whistle: null, n: 0 };
  // (a team's average this season, pulled toward the league's by 10 games of it)
  const mean = (team, key) => {
    const t = teams.get(team);
    return (t[key] + 10 * (key === 'total' ? lg.total : 0)) / (t.n + 10);
  };
  const lean = (name, key) => {
    const r = refs.get(name);
    return r ? r[key] / (r.n + K) : 0;
  };
  return (g) => {
    const { crew, whistle } = crewOf(sport, g, facts, live);
    const names = crew.map((c) => (sport === 'mlb' ? (facts.umps?.[c] ?? c) : c));
    // (what the teams usually score and win by this season, pulled toward the league's by 10 games)
    for (const id of [g.home, g.away]) {
      const t = teams.get(id);
      if (!t || t.season !== g.season) teams.set(id, { season: g.season, n: 0, total: 0, margin: 0 });
    }
    const usualTotal = lg.total === null ? null : (mean(g.home, 'total') + mean(g.away, 'total')) / 2;
    const usualMargin = (mean(g.home, 'margin') - mean(g.away, 'margin')) / 2;
    const avg = (key) => (crew.length ? crew.reduce((s, c) => s + lean(c, key), 0) / crew.length : 0);
    const zone = sport === 'mlb' ? avg('zone') : 0;
    const terms = {
      refTotal: avg('total'),
      refHome: avg('home'),
      refWhistle: sport === 'mlb' ? zone : avg('whistle'),
      ...(sport === 'mlb' ? { refZoneX: zone * (extra?.kProfile?.(g) ?? 0) } : {}),
    };
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      terms,
      info: crew.length ? { crew: names, total: r3(terms.refTotal), home: r3(terms.refHome), whistle: r3(terms.refWhistle) } : { crew: null },
      learn: () => {
        if (!g.final || g.hs === null) return;
        const total = g.hs + g.as;
        const margin = g.hs - g.as;
        const zoneDev = sport === 'mlb' ? extra?.zone?.(g) : null;
        for (const c of crew) {
          const r = refs.get(c) ?? { n: 0, total: 0, home: 0, whistle: 0, zone: 0 };
          r.n++;
          if (usualTotal !== null) r.total += total - usualTotal;
          r.home += margin - usualMargin - lg.margin;
          if (whistle !== null && lg.whistle !== null) r.whistle += whistle - lg.whistle;
          if (zoneDev !== null && zoneDev !== undefined) r.zone += zoneDev;
          refs.set(c, r);
        }
        lg.n++;
        lg.total = lg.total === null ? total : lg.total + (total - lg.total) / Math.min(lg.n, 500);
        lg.margin += (margin - lg.margin) / Math.min(lg.n, 500);
        if (whistle !== null) lg.whistle = lg.whistle === null ? whistle : lg.whistle + (whistle - lg.whistle) / Math.min(lg.n, 500);
        for (const [id, m] of [
          [g.home, margin],
          [g.away, -margin],
        ]) {
          const t = teams.get(id);
          t.n++;
          t.total += total;
          t.margin += m;
        }
      },
    };
  };
}
