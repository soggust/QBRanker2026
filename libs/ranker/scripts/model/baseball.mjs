// MLB's second round of context: the air (its density from the temperature, dew point and pressure at the
// park: thin air carries a ball; Open-Meteo's archive for the past, its forecast for a coming game; outdoors
// only), the bullpen (each team's top three relievers by saves and holds this season, and how many pitches
// they've thrown in the three days before: a tired closer and setup men late), and what the plate umpire's
// zone did to the starters (their strikeouts against their own rates to date: officials.mjs weighs it).
//
// Kept in the context's facts (.cache/model/context-<sport>.json): each game's air ([temperature, dew point, pressure]), and pen (each season's
// relievers' appearances by team: [month and day, pitches, saves and holds]).

import { term } from './terms.mjs';
import { airDensity, forecastAir, get, isoDay, mlbPitching, pool, weatherHistory } from './sources.mjs';


export const BASEBALL_TERMS = [
  term('airThin', 'weather', 't', 'Thin air', 'to the total per 1% thinner air than average (warm, humid, high up; outdoors)'),
  term('penTired', 'starters', 'm', 'Tired bullpen', "per 30 pitches more the other side's top three relievers threw in the last three days, less its own"),
  term('penTiredT', 'starters', 't', 'Tired bullpens (total)', "to the total per 30 pitches both sides' top three relievers threw in the last three days"),
];

// (sea-level air at 70F and half humidity, about: the average the thinness is measured from)
const AIR = 1.18;

// (part: air or bullpens)
export async function gatherBaseball(history, upcoming, facts, live, part) {
  facts.pen ??= {};
  facts.penAt ??= {};
  const today = isoDay(Date.now());
  const current = Math.max(...history.map((g) => g.season));

  // (the air at each outdoor final's first pitch: one ask of the archive per park; a final the archive
  // hasn't reached yet is asked again next run)
  const byPark = new Map();
  for (const g of history) {
    const f = facts.games?.[g.id];
    if (part !== 'air' || !g.final || !f?.at || f.air || (f.w && f.w[2]) || Date.parse(g.date) > Date.now() - 6 * 864e5) continue;
    byPark.set(f.v ?? f.at.join(), [...(byPark.get(f.v ?? f.at.join()) ?? []), g]);
  }
  await pool([...byPark.values()], 2, async (games) => {
    const days = games.map((g) => g.date.slice(0, 10)).sort();
    const at = await weatherHistory(facts.games[games[0].id].at, days[0], days.at(-1));
    if (!at) return;
    for (const g of games) {
      const w = at(g.date);
      const f = facts.games[g.id];
      if (w) f.air = [f.w ? f.w[0] : Math.round(w.temp), Math.round(w.dew), Math.round(w.pressure)];
    }
  });
  await pool(part === 'air' ? upcoming : [], 3, async ({ game }) => {
    const l = live.get(game.id);
    if (!l?.at || (l.w && l.w[2]) || (!l.w && l.roof && l.roof !== 'Open')) return;
    const a = await forecastAir(l.at, game.date);
    if (a) l.air = [l.w ? l.w[0] : Math.round(a.temp), Math.round(a.dew), Math.round(a.pressure)];
  });

  // (the bullpens: each season's relievers with saves or holds, their game logs; this season's asked again
  // once a day there's been a game since)
  const seasons = part === 'bullpens' ? [...new Set(history.map((g) => g.season))] : [];
  for (const season of seasons) {
    const stale = !facts.pen[season] || (season === current && facts.penAt[season] < today && history.some((g) => g.final && g.season === season && g.date.slice(0, 10) >= facts.penAt[season]));
    if (!stale) continue;
    const board = await get(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&sportId=1&season=${season}&playerPool=All&limit=3000`);
    const ids = (board?.stats?.[0]?.splits ?? []).filter((s) => (s.stat.saves ?? 0) + (s.stat.holds ?? 0) >= 2).map((s) => String(s.player.id));
    if (!ids.length) continue;
    const logs = await mlbPitching([...new Set(ids)], season, 'gameLog');
    const pen = {};
    for (const [id, { splits }] of logs) {
      for (const s of splits) {
        const team = facts.mlbTeams?.[s.team?.id];
        if (!team || !s.date || (s.stat.gamesStarted ?? 0) > 0) continue;
        const t = (pen[team] ??= {});
        (t[id] ??= []).push([Number(s.date.slice(5).replace('-', '')), s.stat.numberOfPitches ?? 0, (s.stat.saves ?? 0) + (s.stat.holds ?? 0)]);
      }
    }
    facts.pen[season] = pen;
    facts.penAt[season] = today;
    console.log(`mlb: bullpens for ${season} (${logs.size} relievers)`);
  }
}

// MLB's second-round terms for each game, and what officials.mjs needs of the starters (their strikeouts)
export function baseballOf(facts, live) {
  const day = (g) => Number(g.date.slice(5, 10).replace('-', ''));
  // (a team's top three relievers by saves and holds before the day, and their pitches in the three before it)
  const tired = (abbr, season, d) => {
    const team = facts.pen?.[season]?.[abbr];
    if (!team) return null;
    const date = (md) => Date.UTC(season, Math.floor(md / 100) - 1, md % 100);
    const today = date(d);
    const top = Object.values(team)
      .map((apps) => ({ apps, rank: apps.filter((a) => a[0] < d).reduce((s, a) => s + a[2], 0) }))
      .filter((r) => r.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 3);
    return top.reduce((s, r) => s + r.apps.filter((a) => a[0] < d && today - date(a[0]) <= 3 * 864e5).reduce((x, a) => x + a[1], 0), 0);
  };
  // (a starter's strikeouts an out to date, this season's and half of last, and on the day itself)
  const lgK = (() => {
    const all = Object.values(facts.pitchers ?? {}).flatMap((p) => Object.values(p.logs ?? {}).flat());
    const k = all.reduce((s, r) => s + r[4], 0);
    const outs = all.reduce((s, r) => s + r[1], 0);
    return outs ? k / outs : 0.33;
  })();
  const rate = (id, season, d8) => {
    const p = facts.pitchers?.[id];
    if (!p) return null;
    const cur = (p.logs?.[season] ?? []).filter((r) => r[0] < d8);
    const prev = p.logs?.[season - 1] ?? [];
    const k = cur.reduce((s, r) => s + r[4], 0) + 0.5 * prev.reduce((s, r) => s + r[4], 0);
    const outs = cur.reduce((s, r) => s + r[1], 0) + 0.5 * prev.reduce((s, r) => s + r[1], 0);
    return (k + 120 * lgK) / (outs + 120);
  };
  const onDay = (id, season, d8) => (facts.pitchers?.[id]?.logs?.[season] ?? []).find((r) => r[0] === d8) ?? null;
  const d8 = (g) => Number(g.date.slice(0, 10).replace(/-/g, ''));
  const starters = (g) => (g.final ? facts.games?.[g.id] : live.get(g.id)) ?? {};
  const extra = {
    // (the starters' strikeouts a 9 innings over average, both)
    kProfile: (g) => {
      const { hp, ap } = starters(g);
      const r = [hp, ap].map((id) => (id ? rate(id, g.season, d8(g)) : null)).filter((x) => x !== null);
      return r.reduce((s, x) => s + (x - lgK) * 27, 0);
    },
    // (on the day: the starters' strikeouts over what their rates would give in the outs they got, a 9 innings)
    zone: (g) => {
      const { hp, ap } = starters(g);
      let over = 0;
      let outs = 0;
      for (const id of [hp, ap]) {
        const line = id && onDay(id, g.season, d8(g));
        const r = id && rate(id, g.season, d8(g));
        if (!line || !r || line[1] < 9) continue;
        over += line[4] - line[1] * r;
        outs += line[1];
      }
      return outs ? (27 * over) / outs : null;
    },
  };
  return {
    extra,
    of: (g) => {
      const f = g.final ? facts.games?.[g.id] : live.get(g.id);
      const air = f?.air;
      const rho = air ? airDensity(air[0], air[1], air[2]) : null;
      const th = tired(g.homeAbbr, g.season, day(g));
      const ta = tired(g.awayAbbr, g.season, day(g));
      const r3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
      return {
        terms: { airThin: rho ? ((AIR - rho) / AIR) * 100 : 0, penTired: th !== null && ta !== null ? (ta - th) / 30 : 0, penTiredT: th !== null && ta !== null ? (ta + th) / 30 - 2 : 0 },
        info: { air: rho ? r3(rho) : null, bullpenPitches: [th, ta] },
      };
    },
  };
}
