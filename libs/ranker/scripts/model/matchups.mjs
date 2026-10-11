// Matchups for the props (project.mjs): who a player is on his own team, and what the defense he faces does,
// each worked out from the player logs (playerlogs.mjs) before the game, season to date, last season's at half
// weight:
//
//   role     the NFL: a team's WR1, WR2, WR3 (its wide receivers by their share of its targets), TE1 (its top
//            tight end by targets), RB1 (its top back by carries); the rest WR4+, TE2+, RB2+. The NBA: a team's
//            five with the most minutes a game among the ones playing are its starters (S), the rest its bench
//            (B): a starter out, the next man up starts (in the history, the ones in the game's box score; at
//            bet time, the ones not out or doubtful on the injury report)
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
//            game's logs; at bet time, out or doubtful on the injury report or no longer on the team's roster,
//            and a questionable one at half), their recent work (a back's carries
//            and targets, a receiver's or tight end's targets, a game's worth, recent games counting most) over
//            the recent work of those who are. A back stepping in for a hurt starter gets the starter's share to
//            share out; a player gone a while fades out of it (his recent work fading game by game he misses), by
//            when the ones taking his place have it in their own numbers. The NBA's the same over the whole
//            team, two ways (teamWork below): by minutes, and by usage (field goals tried, 0.44 of free throws
//            tried, and assists: a scorer's shots go to the other scorers, more than his minutes say); the NHL's
//            by position (forwards, defensemen), by time on ice and by power-play time (a top unit's man out, the
//            next one up gets his power play)
//   power    the NHL: a skater's power-play time a game (recent games counting most) and the power plays his
//   play     team can expect: its opponent's penalties a game over the league's (season to date, last season's
//            at half, pulled toward the league's by 10 games); the referees' lean is the context's (props.mjs CTX.pp)
//   lineup   MLB batters: whether he started (his place in the game's posted lineup: the history's from StatsAPI's
//            lineups; a game without them, two plate appearances or more), and his place in the order now
//            against his usual (a leadoff man gets the most trips to the plate: PA_BY_SLOT); the platoon edge on
//            the other side's probable starter now (a lefty batter against a righty, a switch hitter always)
//            against how often he's had it (pulled toward his side's usual by 10 games)
//   leash    MLB starters: his pitches in his last two starts against his usual a start (this season's, last
//            season's at half, pulled toward 90 by 5 starts), and his days since he last pitched (a start off a
//            long layoff, his first back from the injured list most likely, is skipped at bet time: props.mjs)
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
  // 0.5 and 0 (equally: the next man up's cut as big as the starter's); missOf(id): how surely a teammate is
  // missing, 0 to 1: in the history, 1 for one not in the game's logs, 0 for one in them; at bet time, 1 for
  // one out, doubtful or on IR, or no longer on the team's roster (traded, released: gone from its games as he
  // is in the history's), a half for one questionable (in the work missing at half, and here at half))
  const SPLITS = [1, 0.5, 0];
  const NONE = SPLITS.map(() => 0);
  const vacated = (teamId, season, pid, pos, missOf) => {
    const p = POS(pos);
    if (!p || p === 'QB') return NONE;
    const w = workOf(teamId, season);
    let gone = 0;
    const here = [];
    for (const [id, x] of w.p) {
      if (x.pos !== p || x.v < 0.5 || String(id) === String(pid)) continue;
      const m = Math.min(1, Math.max(0, Number(missOf(id)) || 0));
      if (m > 0 && x.v >= 1.5) gone += m * x.v;
      if (m < 1) here.push([x.v, 1 - m]);
    }
    if (!gone) return NONE;
    const own = Math.max(w.p.get(pid)?.v ?? 0, 0.5);
    return SPLITS.map((g) => {
      const all = here.reduce((t, [v, k]) => t + k * Math.pow(v, g), Math.pow(own, g));
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
        r.vacs = vacated(g.team, g.season, r.pid, r.pos, (id) => (playing.has(id) ? 0 : 1));
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
    // (missing: how surely each of the team's players is missing the coming game, by id (a function, 0 to 1),
    // or a set of the ones out: the work they leave)
    live: (pid, teamId, oppId, pos, season, missing = null) => {
      const missOf = typeof missing === 'function' ? missing : missing instanceof Set ? (id) => (missing.has(String(id)) ? 1 : 0) : () => 0;
      const vacs = vacated(teamId, season, pid, pos, missOf);
      return { role: roleOf(pid, teamId, season, pos), ...defense(oppId, season, POS(pos)), vacs, vac: Math.max(...vacs) };
    },
    // (a team's regulars at a position group now: the ones whose recent work counts in the work missing when
    // they're out (matchups' vacated), by id)
    regulars: (teamId, season, pos) => {
      const p = POS(pos);
      if (!p || p === 'QB') return [];
      return [...workOf(teamId, season).p].filter(([, x]) => x.pos === p && x.v >= 1.5).map(([id, x]) => ({ id: String(id), v: Math.round(x.v * 10) / 10 }));
    },
  };
}

// (a day's rows at a time, in date order: each day's projected from what was known before it, then learned)
function byDay(rows, fn) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i].date.slice(0, 10);
    let j = i;
    while (j < sorted.length && sorted[j].date.slice(0, 10) === day) j++;
    fn(sorted.slice(i, j));
    i = j;
  }
}

// A team's players' recent work, the NFL's vacated (above) for other sports: each player's work a game in one
// or more measures (recent games counting most: rate a game; faded game by game he misses; a new season starts
// it over at half), within his group (groupOf his position: null, none). vacated: his cut of the work his
// group's regulars (regular[m] a game or more) who are missing leave, over his own (floor[m] at least: a
// fringe player's cut isn't blown up by his tiny own), shared among the ones playing by their work to the power
// 1, 0.5 and 0 (SPLITS), each measure's three in turn: [m0 in proportion, m0 flatter, m0 equally, m1 ...].
// A measure a row doesn't have (undefined: a line kept before it was) leaves his number in it as it was
export function teamWork({ groupOf, measures, regular, floor, rate = 0.35 }) {
  const SPLITS = [1, 0.5, 0];
  const NONE = measures.flatMap(() => SPLITS.map(() => 0));
  const work = new Map();
  const workOf = (team, season) => {
    let w = work.get(team);
    if (!w || w.season !== season) {
      const last = w && w.season === season - 1 ? w : null;
      w = { season, p: new Map(last ? [...last.p].map(([k, x]) => [k, { g: x.g, v: x.v.map((v) => (v === null ? null : v * 0.5)) }]) : []) };
      work.set(team, w);
    }
    return w;
  };
  const vacated = (team, season, pid, pos, missOf) => {
    const grp = groupOf(pos);
    if (grp === null || grp === undefined) return NONE;
    const w = workOf(team, season);
    const out = [];
    measures.forEach((_, m) => {
      let gone = 0;
      const here = [];
      for (const [id, x] of w.p) {
        const v = x.v[m] ?? 0;
        if (x.g !== grp || v < floor[m] / 2 || String(id) === String(pid)) continue;
        const miss = Math.min(1, Math.max(0, Number(missOf(id)) || 0));
        if (miss > 0 && v >= regular[m]) gone += miss * v;
        if (miss < 1) here.push([v, 1 - miss]);
      }
      if (!gone) return out.push(...SPLITS.map(() => 0));
      const own = Math.max(w.p.get(pid)?.v[m] ?? 0, floor[m] / 2);
      for (const g of SPLITS) {
        const all = here.reduce((t, [v, k]) => t + k * Math.pow(v, g), Math.pow(own, g));
        out.push(Math.round(Math.min(3, (gone * Math.pow(own, g)) / all / Math.max(own, floor[m])) * 1000) / 1000);
      }
    });
    return out;
  };
  // (a game's rows for one team learned: the ones who played, their game's; the ones who didn't, fading)
  const learn = (team, season, rows) => {
    const w = workOf(team, season);
    const played = new Set();
    for (const r of rows) {
      const grp = groupOf(r.pos);
      if (grp === null || grp === undefined) continue;
      played.add(r.pid);
      const now = measures.map((f) => f(r));
      const x = w.p.get(r.pid) ?? { g: grp, v: now.map((v) => (Number.isFinite(v) ? v : null)) };
      x.g = grp;
      x.v = x.v.map((v, m) => (!Number.isFinite(now[m]) ? v : v === null ? now[m] : v + (now[m] - v) * rate));
      w.p.set(r.pid, x);
    }
    for (const [id, x] of w.p) {
      if (played.has(id)) x.out = 0;
      else (x.v = x.v.map((v) => (v === null ? null : v * (1 - rate)))), (x.out = (x.out ?? 0) + 1);
    }
  };
  // (who counts as missing, by what was known before the game: one missing (missOf, 0 to 1) who's a core
  // player (his first measure core(group) a game or more), or who missed the team's game before too. A fringe
  // regular's one game out is most often a healthy scratch or a coach's decision, which no injury report
  // carries: counted in the history, it would hold work missing that a live price never can, the term leaning
  // every projection down. The same rule for the history (missOf: not in the box score) and a coming game
  // (missOf: out by the injury report, off the roster), so the two read alike)
  const gate = (team, season, missOf, core) => {
    const w = workOf(team, season);
    return (id) => {
      const m = Number(missOf(id)) || 0;
      if (m <= 0) return 0;
      const x = w.p.get(id);
      return !x || (x.v[0] ?? 0) >= core(x.g) || (x.out ?? 0) >= 1 ? m : 0;
    };
  };
  const histMiss = (team, season, playing, core) => gate(team, season, (id) => (playing.has(id) ? 0 : 1), core);
  return { vacated, learn, gate, histMiss, none: NONE };
}

// (the core players whose one game out counts at once (teamWork gate, the history's and a coming game's alike):
// the NBA's 24 minutes a game or more, the NHL's forwards' 14 minutes on ice, defensemen's 18; a regular under
// it, from his second game out in a row)
export const NBA_CORE = 24;
export const NHL_CORE = { F: 14, D: 18 };

// (a coming game's teammates missing, as a function of id (0 to 1) from a function, a set or nothing)
const missFn = (missing) => (typeof missing === 'function' ? missing : missing instanceof Set ? (id) => (missing.has(String(id)) ? 1 : 0) : () => 0);

// (an NBA player's usage a game: field goals tried, 0.44 of free throws tried, and assists; a line kept before
// the shots were, its points' worth of them (0.87 tries a point, about the league's))
export const nbaUsage = (r) => (Number.isFinite(r.s.fga) ? r.s.fga + 0.44 * (r.s.fta ?? 0) : 0.87 * (r.s.pts ?? 0)) + (r.s.ast ?? 0);

// The NBA's roles: each team's five with the most minutes a game so far (three games or more) among the ones
// playing its starters (S), the rest its bench (B); and the work missing (teamWork: by minutes, by usage, the
// whole team one group; a core player out counts at once, a regular from his second game out in a row:
// teamWork gate). The same for a coming game (live: missing, the teammates out by the injury report, none of
// them a starter)
export function nbaMatchups(rows) {
  const team = new Map();
  const work = teamWork({ groupOf: () => 'all', measures: [(r) => r.s.min, nbaUsage], regular: [15, 8], floor: [10, 6] });
  const roleOf = (pid, teamId, season, out = () => false) => {
    const t = team.get(teamId);
    if (!t || t.season !== season) return null;
    const avg = [...t.p.entries()].filter(([id, x]) => x.n >= 3 && (String(id) === String(pid) || !out(id))).map(([id, x]) => [id, x.min / x.n]).sort((a, b) => b[1] - a[1]);
    const at = avg.findIndex(([id]) => id === pid);
    return at < 0 ? 'B' : at < 5 ? 'S' : 'B';
  };
  byDay(rows, (batch) => {
    const games = new Map();
    for (const r of batch) {
      const key = `${r.game}|${r.team}`;
      games.set(key, [...(games.get(key) ?? []), r]);
    }
    for (const list of games.values()) {
      const playing = new Set(list.map((r) => r.pid));
      const out = (id) => !playing.has(id);
      const miss = work.histMiss(list[0].team, list[0].season, playing, () => NBA_CORE);
      for (const r of list) {
        r.role = roleOf(r.pid, r.team, r.season, out);
        r.vacs = work.vacated(r.team, r.season, r.pid, r.pos, miss);
        r.vac = Math.max(...r.vacs);
      }
    }
    for (const list of games.values()) {
      const r0 = list[0];
      work.learn(r0.team, r0.season, list);
      for (const r of list) {
        let t = team.get(r.team);
        if (!t || t.season !== r.season) t = { season: r.season, p: new Map() };
        const x = t.p.get(r.pid) ?? { n: 0, min: 0 };
        x.n++;
        x.min += r.s.min ?? 0;
        t.p.set(r.pid, x);
        team.set(r.team, t);
      }
    }
  });
  return {
    live: (pid, teamId, oppId, pos, season, missing = null) => {
      const missOf = missFn(missing);
      const vacs = work.vacated(teamId, season, pid, pos, work.gate(teamId, season, missOf, () => NBA_CORE));
      return { role: roleOf(pid, teamId, season, (id) => missOf(id) >= 1), funnel: 0, pace: 1, tgt: 1, vacs, vac: Math.max(...vacs) };
    },
  };
}

// The NHL's: the work missing (teamWork: by time on ice and by power-play time, forwards and defensemen apart;
// a core skater out counts at once, a regular from his second game out in a row: teamWork gate) and the power
// play (a skater's power-play minutes a game, recent games counting most; his opponent's penalties a game over
// the league's per team, from the context's box facts: facts.games[id].w, each side's power plays first). The
// same for a coming game
export function nhlMatchups(rows, facts = null) {
  const grp = (pos) => (pos === 'F' || pos === 'D' ? pos : null);
  const work = teamWork({ groupOf: grp, measures: [(r) => r.s.toi, (r) => r.s.pptoi], regular: [10, 1], floor: [8, 0.5] });
  const pp = new Map();
  const pens = new Map();
  const lg = { pp: 3, n: 0 };
  const RATE = 0.35;
  // (a team's penalties a game (its opponents' power plays) over the league's per team, pulled by 10 games)
  const pensOf = (id, season) => {
    const t = pens.get(id);
    const w = !t ? 0 : t.season === season ? 1 : t.season === season - 1 ? 0.5 : 0;
    return w ? (w * t.sum + 10 * lg.pp) / (w * t.n + 10) - lg.pp : 0;
  };
  const ppOf = (pid) => pp.get(pid) ?? null;
  const stamp = (r) => {
    r.ppTime = ppOf(r.pid);
    r.ppOpp = pensOf(r.opp, r.season);
    r.ppAvg = lg.pp;
  };
  byDay(rows, (batch) => {
    const games = new Map();
    for (const r of batch) {
      const key = `${r.game}|${r.team}`;
      games.set(key, [...(games.get(key) ?? []), r]);
    }
    for (const list of games.values()) {
      const playing = new Set(list.map((r) => r.pid));
      const miss = work.histMiss(list[0].team, list[0].season, playing, (g) => NHL_CORE[g] ?? 0);
      for (const r of list) {
        stamp(r);
        r.vacs = work.vacated(r.team, r.season, r.pid, r.pos, miss);
        r.vac = Math.max(...r.vacs);
      }
    }
    // (then learned: each side's work and power-play time, each team's penalties once a game)
    const seen = new Set();
    for (const list of games.values()) {
      const r0 = list[0];
      work.learn(r0.team, r0.season, list);
      for (const r of list) {
        if (r.pos === 'G' || !Number.isFinite(r.s.pptoi)) continue;
        const was = pp.get(r.pid);
        pp.set(r.pid, was === undefined || was === null ? r.s.pptoi : was + (r.s.pptoi - was) * RATE);
      }
      const w = facts?.games?.[r0.game]?.w;
      if (seen.has(r0.game) || !Array.isArray(w) || w.length < 2) continue;
      seen.add(r0.game);
      const home = r0.home ? r0.team : r0.opp;
      const away = r0.home ? r0.opp : r0.team;
      // (w: [home's power plays, away's, ...]: the away side's penalties are the home side's power plays)
      for (const [id, n] of [
        [away, w[0]],
        [home, w[1]],
      ]) {
        const t = pens.get(id);
        const keep = !t ? null : t.season === r0.season ? t : t.season === r0.season - 1 ? { season: r0.season, sum: t.sum * 0.5, n: t.n * 0.5 } : null;
        pens.set(id, { season: r0.season, sum: (keep?.sum ?? 0) + n, n: (keep?.n ?? 0) + 1 });
        lg.n++;
        lg.pp += (n - lg.pp) / Math.min(lg.n, 1000);
      }
    }
  });
  return {
    live: (pid, teamId, oppId, pos, season, missing = null) => {
      const vacs = work.vacated(teamId, season, pid, pos, work.gate(teamId, season, missFn(missing), (g) => NHL_CORE[g] ?? 0));
      return { role: null, funnel: 0, pace: 1, tgt: 1, vacs, vac: Math.max(...vacs), ppTime: ppOf(pid), ppOpp: pensOf(oppId, season), ppAvg: lg.pp };
    },
  };
}

// (MLB's plate appearances a start by batting-order slot, 1 to 9, about the league's (2025-26's starts, early
// exits and all))
export const PA_BY_SLOT = [4.49, 4.4, 4.3, 4.2, 4.06, 3.91, 3.77, 3.61, 3.44];
// (at a fractional slot: his usual)
export const paAt = (slot) => {
  const s = Math.min(9, Math.max(1, slot));
  const lo = Math.floor(s);
  return lo >= 9 ? PA_BY_SLOT[8] : PA_BY_SLOT[lo - 1] + (PA_BY_SLOT[lo] - PA_BY_SLOT[lo - 1]) * (s - lo);
};
// (how often a batter of each side has the platoon edge on the starter he faces, about: most starters throw right)
const EDGE_PRIOR = { L: 0.72, R: 0.28, S: 1 };
// (a date as StatsAPI's logs keep it: the US Eastern day as yyyymmdd)
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const d8Of = (date) => Number(ET.format(new Date(date)).replace(/-/g, ''));
const daysBetween = (a, b) => Math.round((Date.UTC(Math.floor(b / 1e4), (Math.floor(b / 100) % 100) - 1, b % 100) - Date.UTC(Math.floor(a / 1e4), (Math.floor(a / 100) % 100) - 1, a % 100)) / 864e5);

// A starting pitcher's leash and rest before a game (day: yyyymmdd, US Eastern), from his StatsAPI game logs
// (facts.pitchers[id].logs: [date, outs, ..., pitches, batters faced, games started]): his pitches in his last
// two starts this season over his usual a start (this season's and half of last season's, pulled toward 90 by
// 5 starts), as a log (0 without two starts' counts); his days since he last pitched this season (null: none
// yet), and as a term, (days - 5) / 5, from -0.6 to 1
export function pitcherBefore(logs, season, day) {
  const cur = (logs?.[season] ?? []).filter((r) => r[0] < day);
  const prev = logs?.[season - 1] ?? [];
  const starts = (list) => list.filter((r) => Number.isFinite(r[8]) && r[8] > 0 && (r[10] === null || r[10] === undefined || r[10] >= 1));
  const sc = starts(cur);
  const sp = starts(prev);
  const sum = (list) => list.reduce((t, r) => t + r[8], 0);
  const usual = (sum(sc) + 0.5 * sum(sp) + 5 * 90) / (sc.length + 0.5 * sp.length + 5);
  const last2 = sc.slice(-2);
  const leash = last2.length === 2 ? Math.log(sum(last2) / 2 / usual) : 0;
  const lastDay = cur.length ? cur[cur.length - 1][0] : null;
  const restDays = lastDay === null ? null : daysBetween(lastDay, day);
  return { leash: Math.round(leash * 1000) / 1000, restDays, rest: restDays === null ? 0 : (Math.min(restDays, 10) - 5) / 5, debut: !cur.length, pitches: last2.map((r) => r[8]) };
}

// MLB's: each batter's start, slot and platoon edge, and each starter's leash and rest, from the context's facts
// (facts.games[id].lo: the lineups in order; hp, ap: the probable starters; facts.hands: how each bats and
// throws; facts.pitchers: the starters' logs), each from before the game. The same for a coming game (live's
// extra: the game's live facts (its posted lineups, its probables), whether he's home)
export function mlbMatchups(rows, facts = null) {
  const hist = new Map();
  const handOf = (id) => facts?.hands?.[id] ?? null;
  const edgeOf = (bats, throws) => (!bats || !throws ? null : bats === 'S' || bats !== throws ? 1 : 0);
  const shifts = (pid, slot, edge) => {
    const h = hist.get(pid) ?? { slotSum: 0, slotN: 0, edgeSum: 0, edgeN: 0 };
    const bats = handOf(String(pid).replace(/^mlb:/, ''))?.[0] ?? null;
    const prior = EDGE_PRIOR[bats] ?? 0.5;
    const usualEdge = (h.edgeSum + 10 * prior) / (h.edgeN + 10);
    return {
      slotShift: slot && h.slotN >= 3 ? Math.round(Math.log(paAt(slot) / paAt(h.slotSum / h.slotN)) * 1000) / 1000 : 0,
      platoonShift: edge === null ? 0 : Math.round((edge - usualEdge) * 1000) / 1000,
    };
  };
  const batter = (pid, home, lineups, sp) => {
    const id = String(pid).replace(/^mlb:/, '');
    const order = lineups?.[home ? 0 : 1];
    const known = Array.isArray(order) && order.length > 0;
    const slot = known ? order.map(String).indexOf(id) + 1 : 0;
    const edge = edgeOf(handOf(id)?.[0] ?? null, sp ? (handOf(sp)?.[1] ?? null) : null);
    return { start: known ? slot > 0 : null, slot: slot || null, edge };
  };
  byDay(rows, (batch) => {
    for (const r of batch) {
      const f = r.game ? facts?.games?.[r.game] : null;
      if (r.pos === 'B') {
        const b = batter(r.pid, r.home, f?.lo, f ? f[r.home ? 'ap' : 'hp'] : null);
        Object.assign(r, { start: b.start, slot: b.slot, edgeNow: b.edge }, shifts(r.pid, b.slot, b.edge));
      } else if (r.pos === 'SP') {
        const p = pitcherBefore(facts?.pitchers?.[String(r.pid).replace(/^mlb:/, '')]?.logs, r.season, d8Of(r.date));
        Object.assign(r, { leash: p.leash, rest: p.rest, restDays: p.restDays });
      }
    }
    for (const r of batch) {
      if (r.pos !== 'B' || r.start === false) continue;
      const h = hist.get(r.pid) ?? { slotSum: 0, slotN: 0, edgeSum: 0, edgeN: 0 };
      if (r.slot) (h.slotSum += r.slot), h.slotN++;
      if (r.edgeNow !== null && r.edgeNow !== undefined) (h.edgeSum += r.edgeNow), h.edgeN++;
      hist.set(r.pid, h);
    }
  });
  return {
    // (extra: { live: the game's live facts, game, home, pitcher: whether the prop is a pitcher's (a two-way
    // player's position can't tell) })
    live: (pid, teamId, oppId, pos, season, missing = null, extra = {}) => {
      const l = extra.live ?? {};
      if (extra.pitcher ?? pos === 'SP') {
        const p = pitcherBefore(facts?.pitchers?.[String(pid).replace(/^mlb:/, '')]?.logs, season, d8Of(extra.game?.date ?? Date.now()));
        return { role: null, leash: p.leash, rest: p.rest, restDays: p.restDays, debut: p.debut, pitches: p.pitches };
      }
      const b = batter(pid, extra.home, l.lineups, l[extra.home ? 'ap' : 'hp'] ?? null);
      return { role: null, start: b.start, slot: b.slot, edgeNow: b.edge, ...shifts(pid, b.slot, b.edge) };
    },
  };
}
