// Matchups for the props (project.mjs): who a player is on his own team, and what the defense he faces does,
// each worked out from the player logs (playerlogs.mjs) before the game, season to date, last season's at half
// weight:
//
//   role     the NFL: a team's WR1, WR2, WR3 (its wide receivers by their share of its targets), TE1 (its top
//            tight end by targets), RB1 (its top back by carries); the rest WR4+, TE2+, RB2+. The NBA: a team's
//            five with the most minutes a game are its starters (S), the rest its bench (B)
//   funnel   the NFL: how much more (or less) a defense's opponents pass against it than they do on their own
//            (their pass share of runs and passes, against their season's so far), pulled toward 0 by 4 games'
//            worth: a pass funnel (over 0) means more passing against it, a run funnel (under 0) more running
//   pace     the NFL: its opponents' plays (runs and passes) against their own usual, pulled toward even by 4
//            games
//   targets  the NFL: the share of the targets it allows to wide receivers, tight ends and backs, against the
//            league's, pulled toward the league's by 60 targets
//
// The terms each of these feeds, and their sizes, are fitted in project.mjs and kept only where the held-out
// games are better with them.

const POS = (pos) => (pos === 'WR' ? 'WR' : pos === 'TE' ? 'TE' : pos === 'RB' || pos === 'FB' ? 'RB' : pos === 'QB' ? 'QB' : null);

// (a tally carried into a new season at half)
const decay = (t, season) => {
  if (t.season === season) return t;
  const half = t.season === season - 1 ? 0.5 : 0;
  const out = { season };
  // (a team's players' positions carry over as they are)
  for (const [k, v] of Object.entries(t)) if (k !== 'season') out[k] = k === 'pos' ? v : typeof v === 'number' ? v * half : v instanceof Map ? new Map([...v].map(([a, b]) => [a, b * half])) : v;
  return out;
};

// The NFL's matchups: every row given its role, its defense's funnel, pace and target share for its position
// (row.role, row.funnel, row.pace, row.tgt), each from the games before it; and the same for a coming game
// (live: a player's id, team, opponent, position and the season)
export function nflMatchups(rows) {
  const games = new Map();
  for (const r of rows) {
    if (!r.team || !r.opp || !r.game) continue;
    const key = `${r.game}|${r.team}`;
    const g = games.get(key) ?? { key, date: r.date, season: r.season, team: r.team, opp: r.opp, att: 0, car: 0, tgt: { WR: 0, TE: 0, RB: 0 }, rows: [] };
    g.att += r.s.passAtt ?? 0;
    g.car += r.s.rushAtt ?? 0;
    const p = POS(r.pos);
    if (p && p !== 'QB') g.tgt[p] += r.s.targets ?? 0;
    g.rows.push(r);
    games.set(key, g);
  }
  const list = [...games.values()].sort((a, b) => a.date.localeCompare(b.date));
  const off = new Map();
  const def = new Map();
  const team = new Map();
  const lg = { pass: 0.57, plays: 62, share: { WR: 0.6, TE: 0.2, RB: 0.2 }, n: 0 };
  const offOf = (id, season) => decay(off.get(id) ?? { season, att: 0, car: 0, n: 0 }, season);
  const defOf = (id, season) => decay(def.get(id) ?? { season, funnel: 0, pace: 0, n: 0, WR: 0, TE: 0, RB: 0, all: 0 }, season);
  const teamOf = (id, season) => decay(team.get(id) ?? { season, tgt: new Map(), car: new Map(), min: new Map(), n: 0 }, season);
  // (the defense's numbers before a game)
  const defense = (id, season, pos) => {
    const d = defOf(id, season);
    const share = pos && pos !== 'QB' ? (d[pos] + 60 * lg.share[pos]) / (d.all + 60) / lg.share[pos] : 1;
    return { funnel: d.funnel / (d.n + 4), pace: 1 + d.pace / (d.n + 4), tgt: share };
  };
  // (a player's role on his team before a game: his place among its players at his position, by targets (by
  // carries for a back))
  const roleOf = (pid, teamId, season, pos) => {
    const p = POS(pos);
    if (!p || p === 'QB') return null;
    const t = teamOf(teamId, season);
    const by = p === 'RB' ? t.car : t.tgt;
    const mine = [...by.entries()].filter(([id]) => t.pos?.get(id) === p).sort((a, b) => b[1] - a[1]);
    const at = mine.findIndex(([id]) => id === pid);
    if (at < 0) return p === 'WR' ? 'WR4+' : `${p}2+`;
    if (p === 'WR') return at < 3 ? `WR${at + 1}` : 'WR4+';
    return at === 0 ? `${p}1` : `${p}2+`;
  };
  let i = 0;
  while (i < list.length) {
    const day = list[i].date.slice(0, 10);
    let j = i;
    while (j < list.length && list[j].date.slice(0, 10) === day) j++;
    const batch = list.slice(i, j);
    // (the day's rows, from what was known before it)
    for (const g of batch) {
      for (const r of g.rows) {
        const d = defense(g.opp, g.season, POS(r.pos));
        r.role = roleOf(r.pid, g.team, g.season, r.pos);
        r.funnel = d.funnel;
        r.pace = d.pace;
        r.tgt = d.tgt;
      }
    }
    // (then learned from)
    for (const g of batch) {
      const o = offOf(g.team, g.season);
      const plays = g.att + g.car;
      if (plays > 20) {
        const norm = (o.att + 3 * lg.pass * lg.plays) / (o.att + o.car + 3 * lg.plays);
        const normPlays = (o.att + o.car + 3 * lg.plays) / (o.n + 3);
        const d = defOf(g.opp, g.season);
        d.funnel += g.att / plays - norm;
        d.pace += plays / normPlays - 1;
        d.n++;
        for (const p of ['WR', 'TE', 'RB']) d[p] += g.tgt[p];
        d.all += g.tgt.WR + g.tgt.TE + g.tgt.RB;
        def.set(g.opp, d);
        o.att += g.att;
        o.car += g.car;
        o.n++;
        off.set(g.team, o);
        lg.n++;
        const w = 1 / Math.min(lg.n, 2000);
        lg.pass += (g.att / plays - lg.pass) * w;
        lg.plays += (plays - lg.plays) * w;
        const all = g.tgt.WR + g.tgt.TE + g.tgt.RB;
        if (all) for (const p of ['WR', 'TE', 'RB']) lg.share[p] += (g.tgt[p] / all - lg.share[p]) * w;
      }
      const t = teamOf(g.team, g.season);
      t.pos ??= new Map();
      for (const r of g.rows) {
        const p = POS(r.pos);
        if (!p) continue;
        t.pos.set(r.pid, p);
        t.tgt.set(r.pid, (t.tgt.get(r.pid) ?? 0) + (r.s.targets ?? 0));
        t.car.set(r.pid, (t.car.get(r.pid) ?? 0) + (r.s.rushAtt ?? 0));
      }
      t.n++;
      team.set(g.team, t);
    }
    i = j;
  }
  return {
    live: (pid, teamId, oppId, pos, season) => ({ role: roleOf(pid, teamId, season, pos), ...defense(oppId, season, POS(pos)) }),
  };
}

// The NBA's roles: each team's five with the most minutes a game so far (three games or more) its starters
// (S), the rest its bench (B); and the same for a coming game
export function nbaMatchups(rows) {
  const team = new Map();
  const roleOf = (pid, teamId, season) => {
    const t = team.get(teamId);
    if (!t || t.season !== season) return null;
    const avg = [...t.p.entries()].filter(([, x]) => x.n >= 3).map(([id, x]) => [id, x.min / x.n]).sort((a, b) => b[1] - a[1]);
    const at = avg.findIndex(([id]) => id === pid);
    return at < 0 ? 'B' : at < 5 ? 'S' : 'B';
  };
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i].date.slice(0, 10);
    let j = i;
    while (j < sorted.length && sorted[j].date.slice(0, 10) === day) j++;
    for (const r of sorted.slice(i, j)) r.role = roleOf(r.pid, r.team, r.season);
    for (const r of sorted.slice(i, j)) {
      let t = team.get(r.team);
      if (!t || t.season !== r.season) t = { season: r.season, p: new Map() };
      const x = t.p.get(r.pid) ?? { n: 0, min: 0 };
      x.n++;
      x.min += r.s.min ?? 0;
      t.p.set(r.pid, x);
      team.set(r.team, t);
    }
    i = j;
  }
  return { live: (pid, teamId, oppId, pos, season) => ({ role: roleOf(pid, teamId, season), funnel: 0, pace: 1, tgt: 1 }) };
}

