// The NHL's second round of context: expected goals (MoneyPuck, game by game) split into the team's play (its
// expected goals for and against a game, season to date with last season's at half weight) and its
// goaltending (goals saved above expected, the starter's own against his team's usual, his share of each
// game's by the shots he faced); and last change (the home coach matches lines: how much each team leans on
// its top three scorers for its goals, season to date, which the home side gets to shelter and the road
// side gets exposed).
//
// Kept in context.json: each game's xg ([home expected for, home expected against]).

import { moneypuckGames, pool } from './sources.mjs';

const term = (key, group, on, label, unit) => ({ key, group, on, label, unit });

export const HOCKEY_TERMS = [
  term('xgEdge', 'strength', 'm', 'Expected goals', 'per expected goal a game better (for less against) this season'),
  term('xgT', 'strength', 't', 'Expected goals (total)', "to the total per expected goal a game of both teams' for and against over average"),
  term('goalieX', 'starters', 'm', 'Goalie GSAx', 'per goal a game its starter saves above expected over its usual, against the other side'),
  term('lastChange', 'matchups', 'm', 'Last change', "per 10 points of both teams' share of goals from their top three scorers over average"),
];

// (MoneyPuck's team codes, where they differ from ESPN's)
const MP = { TB: 'TBL', NJ: 'NJD', LA: 'LAK', SJ: 'SJS' };

// Each final's expected goals, from MoneyPuck (a season's teams asked once it has finals without them)
export async function gatherHockey(history, facts) {
  const current = Math.max(...history.map((g) => g.season));
  // (a past season's final MoneyPuck has no match for is tried once: xg null)
  const need = history.filter((g) => g.final && facts.games?.[g.id] && !facts.games[g.id].xg && !(g.season < current && 'xg' in facts.games[g.id]));
  if (!need.length) return;
  const abbrs = [...new Set(history.flatMap((g) => [g.homeAbbr]))];
  // (ESPN's season 2026 is MoneyPuck's 2025: the year it starts)
  const asks = [...new Set(need.map((g) => g.season))].flatMap((season) => abbrs.flatMap((abbr) => ['regular', 'playoffs'].map((part) => ({ season, abbr, part }))));
  const got = await pool(asks, 2, async ({ season, abbr, part }) => ({ season, abbr, rows: await moneypuckGames(MP[abbr] ?? abbr, season - 1, part, season < current) }));
  const byKey = new Map();
  for (const x of got) for (const r of x?.rows ?? []) if (r.home) byKey.set(`${x.abbr}|${r.date}`, r);
  let n = 0;
  for (const g of need) {
    const f = facts.games[g.id];
    if (!f) continue;
    // (MoneyPuck's date is the local day: the day before ESPN's UTC one for a night game)
    const day = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
    const r = byKey.get(`${g.homeAbbr}|${day(Date.parse(g.date) - 6 * 36e5)}`) ?? byKey.get(`${g.homeAbbr}|${day(Date.parse(g.date))}`);
    if (r && Number.isFinite(r.xgf)) (f.xg = [Math.round(r.xgf * 100) / 100, Math.round(r.xga * 100) / 100]), n++;
    else if (g.season < current && got.some((x) => x?.season === g.season && x.abbr === g.homeAbbr && x.rows)) f.xg = null;
  }
  console.log(`nhl: expected goals for ${n} of ${need.length} finals`);
}

// The NHL's second-round terms for each game, in date order
export function hockeyOf(facts, live) {
  const teams = new Map();
  const goalies = new Map();
  const recent = new Map();
  const scorers = new Map();
  let lg = { xg: 2.9, share: 0.4, n: 0 };
  const team = (id, season) => {
    const t = teams.get(id);
    if (!t) return { edge: 0, sum: 0 };
    const w = t.season === season ? 1 : 0.5;
    const n = w * t.n + 10;
    return { edge: (w * (t.xgf - t.xga)) / n, sum: (w * (t.xgf + t.xga) + 10 * 2 * lg.xg) / n - 2 * lg.xg };
  };
  const gsax = (id, season) => {
    const s = goalies.get(id);
    if (!s) return 0;
    const w = s.season === season ? 1 : 0.5;
    return (w * s.x) / (w * s.n + 15);
  };
  const share = (id, season) => {
    const s = scorers.get(id);
    if (!s || s.season !== season || s.goals < 10) return lg.share;
    const top = [...s.by.values()].sort((a, b) => b - a).slice(0, 3).reduce((x, y) => x + y, 0);
    return (top + 20 * lg.share) / (s.goals + 20);
  };
  return (g) => {
    const f = facts.games?.[g.id];
    const l = live.get(g.id);
    const starter = (where) => (g.final ? (f?.[where]?.[0]?.[0] ?? null) : (l?.[where === 'h' ? 'home' : 'away']?.id ?? null));
    const vsUsual = (id, teamId) => {
      if (!id) return 0;
      const usual = recent.get(teamId) ?? [];
      const norm = usual.length ? usual.reduce((s, x) => s + gsax(x, g.season), 0) / usual.length : gsax(id, g.season);
      return gsax(id, g.season) - norm;
    };
    const h = team(g.home, g.season);
    const a = team(g.away, g.season);
    const gh = vsUsual(starter('h'), g.home);
    const ga = vsUsual(starter('a'), g.away);
    const sh = share(g.home, g.season);
    const sa = share(g.away, g.season);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      terms: { xgEdge: h.edge - a.edge, xgT: h.sum + a.sum, goalieX: gh - ga, lastChange: (sh + sa - 2 * lg.share) * 10 },
      info: { xg: [r3(h.edge), r3(a.edge)], gsaxVsUsual: [r3(gh), r3(ga)], topThree: [r3(sh), r3(sa)] },
      learn: () => {
        if (!f) return;
        if (f.xg) {
          const [xgf, xga] = f.xg;
          for (const [id, xf, xa, ga, where] of [
            [g.home, xgf, xga, g.as, 'h'],
            [g.away, xga, xgf, g.hs, 'a'],
          ]) {
            const t = teams.get(id);
            const keep = !t ? 0 : t.season === g.season ? 1 : 0.5;
            teams.set(id, { season: g.season, n: (t?.n ?? 0) * keep + 1, xgf: (t?.xgf ?? 0) * keep + xf, xga: (t?.xga ?? 0) * keep + xa });
            // (the game's goals saved above expected, shared among its goalies by the shots each faced)
            const list = f[where] ?? [];
            const shots = list.reduce((s, x) => s + x[1], 0) || 1;
            for (const [gid, sa] of list) {
              const s = goalies.get(gid);
              const k = !s ? 0 : s.season === g.season ? 1 : 0.5;
              goalies.set(gid, { season: g.season, n: (s?.n ?? 0) * k + sa / shots, x: (s?.x ?? 0) * k + ((xa - ga) * sa) / shots });
            }
            lg.n++;
            lg.xg += (xf - lg.xg) / Math.min(lg.n, 2000);
          }
        }
        for (const [id, where] of [
          [g.home, 'h'],
          [g.away, 'a'],
        ]) {
          const first = f[where]?.[0]?.[0];
          if (first) recent.set(id, [...(recent.get(id) ?? []), first].slice(-10));
          if (!f[`${where}g`]) continue;
          const s = scorers.get(id);
          const cur = s && s.season === g.season ? s : { season: g.season, goals: 0, by: new Map() };
          for (const [pid, n] of f[`${where}g`]) {
            cur.goals += n;
            cur.by.set(pid, (cur.by.get(pid) ?? 0) + n);
          }
          scorers.set(id, cur);
          if (cur.goals >= 20) lg.share += (share(id, g.season) - lg.share) / 500;
        }
      },
    };
  };
}
