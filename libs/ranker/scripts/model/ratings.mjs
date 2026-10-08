// The model's view of every team, built by replaying every game in order: a rating (how much better than an
// average team, in the sport's scoring unit) and scoring and allowing rates. Each game is predicted before
// it's learned from, so the replay is its own honest test: the settings (leagues.mjs) are fit by trying a grid
// of them and keeping the ones whose predictions of the games they hadn't seen yet were best.

// The normal distribution's CDF (Abramowitz-Stegun), for turning an expected margin into a chance
export function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// A fresh replay's state: no team known yet
function start(params) {
  return { r: new Map(), o: new Map(), d: new Map(), season: new Map(), avg: params.avg };
}

// A team's numbers going into a game, carried into a new season by revert (the rest of the way to average)
function team(state, id, season, params) {
  if (!state.r.has(id)) {
    state.r.set(id, 0);
    state.o.set(id, 0);
    state.d.set(id, 0);
    state.season.set(id, season);
  }
  if (season && state.season.get(id) !== season) {
    state.r.set(id, state.r.get(id) * params.revert);
    state.o.set(id, state.o.get(id) * params.revert);
    state.d.set(id, state.d.get(id) * params.revert);
    state.season.set(id, season);
  }
  return { r: state.r.get(id), o: state.o.get(id), d: state.d.get(id) };
}

// A game's expectation: the home margin, each team's score and the total
export function expect(state, game, params) {
  const h = team(state, game.home, game.season, params);
  const a = team(state, game.away, game.season, params);
  const edge = game.neutral ? 0 : params.hfa;
  const margin = h.r - a.r + edge;
  const homePts = state.avg + h.o - a.d + edge / 2;
  const awayPts = state.avg + a.o - h.d - edge / 2;
  return { margin, total: homePts + awayPts, homePts, awayPts };
}

// Learn from a final: the ratings move by k of the surprise (capped, so a blowout counts as a big win, not
// a bigger one), the scoring rates by kO of each side's
function learn(state, game, exp, params) {
  const cap = 3 * params.sigma;
  const miss = Math.max(-cap, Math.min(cap, game.hs - game.as - exp.margin));
  state.r.set(game.home, state.r.get(game.home) + params.k * miss);
  state.r.set(game.away, state.r.get(game.away) - params.k * miss);
  const hMiss = game.hs - exp.homePts;
  const aMiss = game.as - exp.awayPts;
  state.o.set(game.home, state.o.get(game.home) + params.kO * hMiss);
  state.d.set(game.away, state.d.get(game.away) - params.kO * hMiss);
  state.o.set(game.away, state.o.get(game.away) + params.kO * aMiss);
  state.d.set(game.home, state.d.get(game.home) - params.kO * aMiss);
  state.avg += 0.002 * ((game.hs + game.as) / 2 - state.avg);
}

// Replay the finals in order: the state after them, and how well each was predicted before it was played
// (after a burn-in: the first part of the history only teaches)
export function replay(games, params, burnIn = 0.3) {
  const state = start(params);
  const finals = games.filter((g) => g.final && g.hs !== null && g.as !== null).sort((a, b) => a.date.localeCompare(b.date));
  const from = Math.floor(finals.length * burnIn);
  let n = 0;
  let marginSq = 0;
  let totalSq = 0;
  let marginAbs = 0;
  let totalAbs = 0;
  let winLoss = 0;
  let winHits = 0;
  finals.forEach((g, i) => {
    const exp = expect(state, g, params);
    if (i >= from) {
      const m = g.hs - g.as - exp.margin;
      const t = g.hs + g.as - exp.total;
      marginSq += m * m;
      totalSq += t * t;
      marginAbs += Math.abs(m);
      totalAbs += Math.abs(t);
      if (g.hs !== g.as) {
        const p = Math.min(0.99, Math.max(0.01, phi(exp.margin / params.sigma)));
        winLoss -= Math.log(g.hs > g.as ? p : 1 - p);
        winHits += (p > 0.5) === g.hs > g.as ? 1 : 0;
      }
      n++;
    }
    learn(state, g, exp, params);
  });
  return {
    state,
    n,
    sigma: n ? Math.sqrt(marginSq / n) : params.sigma,
    sigmaT: n ? Math.sqrt(totalSq / n) : params.sigmaT,
    maeMargin: n ? marginAbs / n : null,
    maeTotal: n ? totalAbs / n : null,
    winLogLoss: n ? winLoss / n : null,
    winHit: n ? winHits / n : null,
  };
}

// The grid's best settings: the ones whose margins and totals were closest to what happened (the normal
// log-likelihood of both, each at the spread the replay found), with their test numbers
export function fit(games, base, startGrid) {
  const grid = Object.fromEntries(Object.entries(startGrid).map(([key, values]) => [key, [...values]]));
  const tried = new Map();
  let best = null;
  // (a best setting at the end of its range: the range grows that way and the search runs again, a few
  // times at most, so the fit isn't held to where the ranges were first guessed)
  for (let round = 0; round < 4; round++) {
    for (const k of grid.k)
      for (const hfa of grid.hfa)
        for (const revert of grid.revert)
          for (const kO of grid.kO) {
            const key = `${k}|${hfa}|${revert}|${kO}`;
            if (tried.has(key)) continue;
            const params = { ...base, k, hfa, revert, kO };
            const r = replay(games, params);
            tried.set(key, true);
            if (!r.n) continue;
            // (the normal log-likelihood per game, margins and totals: lower spread around the truth is better)
            const score = Math.log(r.sigma) + Math.log(r.sigmaT);
            if (!best || score < best.score) best = { score, params: { ...params, sigma: round2(r.sigma, 3), sigmaT: round2(r.sigmaT, 3) }, test: r };
          }
    if (!best) return null;
    let grew = false;
    for (const key of ['k', 'hfa', 'revert', 'kO']) {
      const values = grid[key];
      const at = values.indexOf(best.params[key]);
      if (at === values.length - 1) {
        const next = key === 'revert' ? Math.min(0.98, values[at] + 0.1) : round2(values[at] * 1.4, 4);
        if (next !== values[at]) values.push(next), (grew = true);
      } else if (at === 0 && values[0] > 0) {
        values.unshift(key === 'revert' ? Math.max(0, round2(values[0] - 0.15, 2)) : round2(values[0] * 0.6, 4));
        grew = true;
      }
    }
    if (!grew) break;
  }
  return best;
}

const round2 = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export const round = (v, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
