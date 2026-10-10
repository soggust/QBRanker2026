// Matchups for the props (project.mjs): who a player is on his own team, and what the defense he faces does,
// each worked out from the player logs (playerlogs.mjs) before the game, season to date, last season's at half
// weight:
//
//   role     the NFL: a team's WR1, WR2, WR3 (its wide receivers by their share of its targets), TE1 (its top
//            tight end by targets), RB1 (its top back by carries); the rest WR4+, TE2+, RB2+. The NBA: a team's
//            five with the most minutes a game are its starters (S), the rest its bench (B)
//   funnel   the NFL: how much more (or less) a defense's opponents pass against it than they do on their own
//            (passFunnel below: their pass rate over expected against it, nflverse's xpass, in neutral
//            situations, less their own so far; the plain pass share where a game has no xpass), pulled
//            toward 0 by 4 games' worth: a pass funnel (over 0) means more passing against it, a run funnel
//            (under 0) more running
//   pace     the NFL: its opponents' plays (runs and passes) against their own usual, pulled toward even by 4
//            games
//   targets  the NFL: the share of the targets it allows to wide receivers, tight ends and backs, against the
//            league's, pulled toward the league's by 60 targets
//   vacated  the NFL: the work a player's position group is missing: its regulars who aren't playing (not in the
//            game's logs; at bet time, out or doubtful on the injury report), their recent work (a back's carries
//            and targets, a receiver's or tight end's targets, a game's worth, recent games counting most) over
//            the recent work of those who are. A back stepping in for a hurt starter gets the starter's share to
//            share out; a player gone a while fades out of it (his recent work fading game by game he misses), by
//            when the ones taking his place have it in their own numbers
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

// The NFL defenses' pass funnel, the props' and the game totals' (football.mjs funnelT) alike, learned a game
// at a time in date order. A game's side, from the play-by-play (context.mjs's plays, football.mjs): its runs
// and passes (pass, plays) and, in neutral situations (win chance 20-80%, outside the last two minutes of a
// half) where nflverse has its chance of a pass (xpass, 2006 on), how many (xn) and their passes less xpass
// summed (over). Its pass rate over expected (over / xn) against the offense's own so far (pulled toward the
// league's by 100 such plays: about three games), weighted by its share of 25 such plays (a blowout counts
// for less); without them (no xpass, or no play-by-play: the props' player logs), its pass share against the
// offense's own so far, as before. Season to date, last season's at half weight; of(defense, season): pulled
// toward 0 by 4 games' worth.
export function passFunnel() {
  const off = new Map();
  const def = new Map();
  const lg = { pass: 0.57, plays: 62, proe: 0, n: 0 };
  const decay = (x, season, fresh) => {
    if (!x) return fresh;
    if (x.season === season) return x;
    const half = x.season === season - 1 ? 0.5 : 0;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'season' ? season : v * half]));
  };
  return {
    of(id, season) {
      const d = decay(def.get(id), season, null);
      return d ? d.funnel / (d.n + 4) : 0;
    },
    learn(team, opp, season, { pass, plays, over = 0, xn = 0 }) {
      if (!(plays > 20)) return;
      const o = decay(off.get(team), season, { season, pass: 0, plays: 0, over: 0, xn: 0 });
      const d = decay(def.get(opp), season, { season, funnel: 0, n: 0 });
      if (xn >= 5) {
        const w = Math.min(1, xn / 25);
        const usual = (o.over + 100 * lg.proe) / (o.xn + 100);
        d.funnel += w * (over / xn - usual);
        d.n += w;
        o.over += over;
        o.xn += xn;
        lg.proe += ((over / xn) - lg.proe) / Math.min(++lg.n, 500);
      } else {
        const usual = (o.pass + 3 * lg.pass * lg.plays) / (o.plays + 3 * lg.plays);
        d.funnel += pass / plays - usual;
        d.n++;
      }
      o.pass += pass;
      o.plays += plays;
      lg.pass += (pass / plays - lg.pass) / 500;
      lg.plays += (plays - lg.plays) / 500;
      off.set(team, o);
      def.set(opp, d);
    },
  };
}

// (a game's side from the context's plays (football.mjs: each game's [.., home passes, home runs, away
// passes, away runs, home over, home xn, away over, away xn]): null where it has none)
export function sideOfPlays(p, home) {
  if (!p || p.length < 9) return null;
  const [pass, run] = home ? [p[5], p[6]] : [p[7], p[8]];
  const [over, xn] = p.length >= 13 ? (home ? [p[9], p[10]] : [p[11], p[12]]) : [0, 0];
  return { pass, plays: pass + run, over, xn };
}

// The NFL's matchups: every row given its role, its defense's funnel, pace and target share for its position
// (row.role, row.funnel, row.pace, row.tgt), each from the games before it; and the same for a coming game
// (live: a player's id, team, opponent, position and the season). plays: the context's play-by-play facts by
// game (football.mjs: facts.plays), for the funnel over expected; without a game's, its player logs' pass share
export function nflMatchups(rows, pbp = null) {
  const games = new Map();
  for (const r of rows) {
    if (!r.team || !r.opp || !r.game) continue;
    const key = `${r.game}|${r.team}`;
    const g = games.get(key) ?? { key, game: r.game, home: r.home, date: r.date, season: r.season, team: r.team, opp: r.opp, att: 0, car: 0, tgt: { WR: 0, TE: 0, RB: 0 }, rows: [] };
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
  const defOf = (id, season) => decay(def.get(id) ?? { season, pace: 0, n: 0, WR: 0, TE: 0, RB: 0, all: 0 }, season);
  const funnel = passFunnel();
  const teamOf = (id, season) => decay(team.get(id) ?? { season, tgt: new Map(), car: new Map(), min: new Map(), n: 0 }, season);
  // (each team's players' recent work a game, recent games counting most: their position and its level, faded
  // game by game they miss; a new season starts it over at half)
  const work = new Map();
  const workOf = (id, season) => {
    let w = work.get(id);
    if (!w || w.season !== season) {
      const last = w && w.season === season - 1 ? w : null;
      w = { season, p: new Map(last ? [...last.p].map(([k, v]) => [k, { pos: v.pos, v: v.v * 0.5 }]) : []) };
      work.set(id, w);
    }
    return w;
  };
  const WORK_RATE = 0.35;
  const touches = (r, p) => (p === 'RB' ? (r.s.rushAtt ?? 0) + (r.s.targets ?? 0) : (r.s.targets ?? 0));
  // (the work missing from a player's position group, his cut of it over his own work: the absent regulars'
  // recent work shared among the present players by their recent work to the power g, for g of 1 (in proportion),
  // 0.5 and 0 (equally: the next man up's cut as big as the starter's); present: who's playing (a set of player
  // ids), or everyone but out (a set) at bet time)
  const SPLITS = [1, 0.5, 0];
  const NONE = SPLITS.map(() => 0);
  const vacated = (teamId, season, pid, pos, isMissing) => {
    const p = POS(pos);
    if (!p || p === 'QB') return NONE;
    const w = workOf(teamId, season);
    let gone = 0;
    const here = [];
    for (const [id, x] of w.p) {
      if (x.pos !== p || x.v < 0.5) continue;
      if (isMissing(id)) {
        if (x.v >= 1.5) gone += x.v;
      } else if (String(id) !== String(pid)) here.push(x.v);
    }
    if (!gone) return NONE;
    const own = Math.max(w.p.get(pid)?.v ?? 0, 0.5);
    return SPLITS.map((g) => {
      const all = here.reduce((t, v) => t + Math.pow(v, g), Math.pow(own, g));
      return Math.round(Math.min(3, (gone * Math.pow(own, g)) / all / Math.max(own, 1)) * 1000) / 1000;
    });
  };
  // (the defense's numbers before a game)
  const defense = (id, season, pos) => {
    const d = defOf(id, season);
    const share = pos && pos !== 'QB' ? (d[pos] + 60 * lg.share[pos]) / (d.all + 60) / lg.share[pos] : 1;
    return { funnel: funnel.of(id, season), pace: 1 + d.pace / (d.n + 4), tgt: share };
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
      const playing = new Set(g.rows.map((r) => r.pid));
      for (const r of g.rows) {
        const d = defense(g.opp, g.season, POS(r.pos));
        r.role = roleOf(r.pid, g.team, g.season, r.pos);
        r.funnel = d.funnel;
        r.pace = d.pace;
        r.tgt = d.tgt;
        r.vacs = vacated(g.team, g.season, r.pid, r.pos, (id) => !playing.has(id));
        r.vac = Math.max(...r.vacs);
      }
    }
    // (then learned from)
    for (const g of batch) {
      const o = offOf(g.team, g.season);
      const plays = g.att + g.car;
      if (plays > 20) {
        const normPlays = (o.att + o.car + 3 * lg.plays) / (o.n + 3);
        const d = defOf(g.opp, g.season);
        // (the funnel: from the game's play-by-play where the context has it, else its logs' pass share)
        funnel.learn(g.team, g.opp, g.season, sideOfPlays(pbp?.[g.game], g.home) ?? { pass: g.att, plays });
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
      // (the recent work: the ones who played, their game's; the ones who didn't, fading)
      const w = workOf(g.team, g.season);
      const played = new Set();
      for (const r of g.rows) {
        const p = POS(r.pos);
        if (!p || p === 'QB') continue;
        played.add(r.pid);
        const x = w.p.get(r.pid) ?? { pos: p, v: touches(r, p) };
        x.pos = p;
        x.v += (touches(r, p) - x.v) * WORK_RATE;
        w.p.set(r.pid, x);
      }
      for (const [id, x] of w.p) if (!played.has(id)) x.v *= 1 - WORK_RATE;
    }
    i = j;
  }
  return {
    // (out: the team's players out for the coming game, by id: the work they leave)
    live: (pid, teamId, oppId, pos, season, out = new Set()) => ({
      role: roleOf(pid, teamId, season, pos),
      ...defense(oppId, season, POS(pos)),
      ...((vacs) => ({ vacs, vac: Math.max(...vacs) }))(out.size ? vacated(teamId, season, pid, pos, (id) => out.has(String(id))) : vacated(teamId, season, pid, pos, () => false)),
    }),
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

