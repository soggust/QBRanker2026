// A player's projection for one stat in one game, and the spread around it, fit on his history (props.mjs
// bets on it). Replayed in date order like the ratings: each game is projected from the games before it only
// (a whole day's games projected before any of them is learned from), then learned from.
//
//   rate     his average this season, pulled by K games toward his own longer run: last season's average with
//            the seasons before at half weight (10 games or more of it), else the average of the players at his
//            position a book posts props for (each team's top few by usage: eligible), not of everyone: a prop
//            player pulled toward a backup's numbers would sit under his line
//   recent   his last five this season, weighted w against the rate
//   opponent how far the other side's allowed this stat to his position over the players' own rates, to the
//            power a (1: in full); and where the stat has roles (a player's place on his own team before the
//            game: an NFL team's WR1, WR2, WR3, TE1, RB1; an NBA team's starters and bench), how far it's
//            allowed his role, pulled toward its position number by roleK games' worth (fitted; Infinity: the
//            role left out, kept only if the held-out games are better with it)
//   script   his team's expected score from the game model (the ratings and context) over the average, to the
//            power b: a game the model sees as high scoring or a blowout moves volume (the opponent's for a
//            goalie's saves or a pitcher's outs)
//   matchup  the NFL defense's funnel (its opponents' pass share against it over their own, matchups.mjs): a
//            volume term, exp(fun x funnel) for a passing or receiving stat, exp(-fun x funnel) for a rushing one;
//            its pace (its opponents' plays over their usual) to the power pc; the share of targets it allows to
//            his position over the league's, to the power tg (a receiving stat)
//   context  one term per stat where the model has it: wind on NFL passing, a backup quarterback throwing to
//            NFL receivers, teammates out (production missing) for an NBA player's usage; size c
//   scale    the eligible players' total over their total projection on the fit window: what's left of a lean
//            once the rest is fit, taken out
//
// The count's spread: a negative binomial around the projection, its dispersion r fit too (lower: wider).
// Each setting is fit one at a time (twice round) on the middle of the history (30% to 70% of it by date: the
// first 30% only teaches); the last 30% is never used to fit and is where the projections are checked. Then
// the chance of going over a line is recalibrated (logistic: cal = [shift, stretch] on its log-odds), fit on
// the same middle window at lines at each player's median so far: a spread's shape that runs too skewed or
// too tight (yards are) is straightened out.

// (the log of the gamma function, Lanczos)
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// A negative binomial's log chance of k at mean mu and dispersion r
export function nbLog(k, mu, r) {
  return lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(r / (r + mu)) + k * Math.log(mu / (r + mu));
}

// The chance of more than line (a half-point line: over it) at mean mu and dispersion r
export function nbOver(line, mu, r) {
  const top = Math.floor(line);
  if (top < 0) return 1;
  let p = Math.pow(r / (r + mu), r);
  let cdf = p;
  for (let k = 0; k < top; k++) {
    p *= ((k + r) / (k + 1)) * (mu / (r + mu));
    cdf += p;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

// A stat's model under one set of settings: project a row from what's been learned, learn a day's rows
export function makeModel(stat, params, env) {
  const players = new Map();
  const opps = new Map();
  const roles = new Map();
  const pos = new Map();
  const val = (row) => Math.max(0, Math.round(row.s[stat.key]));
  const posKey = (row) => stat.posGroup?.(row.pos) ?? row.pos;
  const half = (x, season) => (x.season === season ? 1 : x.season === season - 1 ? 0.5 : 0);
  // (the eligible players' average at his position: the prior for a player with no longer run of his own)
  const pool = (row) => {
    const p = pos.get(posKey(row));
    return p && p.n >= 20 ? p.sum / p.n : (env.mean ?? 1);
  };
  const parts = (row) => {
    const pl = players.get(row.pid);
    if (!pl) return null;
    const cur = pl.season === row.season ? pl.cur : { n: 0, sum: 0, recent: [] };
    const prev = pl.season === row.season ? pl.prev : pl.season === row.season - 1 ? pl.cur : { n: 0, sum: 0 };
    // (the seasons before last, as seen from this one)
    const older =
      pl.season === row.season ? pl.career
      : pl.season === row.season - 1 ? { n: pl.career.n + pl.prev.n, sum: pl.career.sum + pl.prev.sum }
      : { n: pl.career.n + pl.prev.n + pl.cur.n, sum: pl.career.sum + pl.prev.sum + pl.cur.sum };
    if (cur.n + prev.n < 2) return null;
    const longN = prev.n + 0.5 * older.n;
    const prior = longN >= 10 ? (prev.sum + 0.5 * older.sum) / longN : pool(row);
    const rate = (cur.sum + params.K * prior) / (cur.n + params.K);
    const recent = cur.recent.length >= 3 ? cur.recent.reduce((s, x) => s + x, 0) / cur.recent.length : rate;
    const base = (1 - params.w) * rate + params.w * recent;
    // (what the opponent's allowed his position against what those players usually do: a ratio of sums, this
    // season's and half of last, pulled toward even by 8 games' worth)
    // (a table's sums for this season, last season's at half weight)
    const sums = (o) => {
      const ow = half(o, row.season);
      const pw = o.season === row.season ? 0.5 : 0;
      return { got: ow * o.got + pw * o.prevGot, usual: ow * o.usual + pw * o.prevUsual, n: ow * o.n + pw * o.prevN };
    };
    const o = opps.get(`${row.opp}|${posKey(row)}`);
    let opp = 1;
    if (o) {
      const { got, usual, n } = sums(o);
      const per = n ? usual / n : base;
      opp = (got + 8 * per) / (usual + 8 * per);
    }
    // (his role's: the same against players in his role, pulled toward the position's by roleK games of it)
    const posOpp = opp;
    let roleOpp = null;
    if (row.role && Number.isFinite(params.roleK)) {
      const x = roles.get(`${row.opp}|${row.role}`);
      if (x) {
        const { got, usual, n } = sums(x);
        const per = n ? usual / n : base;
        roleOpp = (got + params.roleK * per * posOpp) / (usual + params.roleK * per);
        opp = roleOpp;
      }
    }
    const script = env.script?.(row) ?? 1;
    const ctx = env.ctx?.(row) ?? 0;
    // (the defense's funnel, pace and target split: 1 where the stat or the row has none)
    const dir = stat.volume === 'rush' ? -1 : stat.volume ? 1 : 0;
    const funnelF = dir && params.fun ? Math.exp(params.fun * dir * (row.funnel ?? 0)) : 1;
    const paceF = stat.volume && params.pc ? Math.pow(row.pace ?? 1, params.pc) : 1;
    const tgtF = stat.targets && params.tg ? Math.pow(row.tgt ?? 1, params.tg) : 1;
    const mu = Math.max(0.05, (params.scale ?? 1) * base * Math.pow(opp, params.a) * Math.pow(script, params.b) * Math.exp(params.c * ctx) * funnelF * paceF * tgtF);
    return { mu, rate, recent, base, opp, posOpp, roleOpp, role: row.role ?? null, funnel: row.funnel ?? null, funnelF, paceF, tgtF, script, ctx, prior, games: cur.n, prevGames: prev.n };
  };
  return {
    project: parts,
    // (every defense's number against a role this season, the league's order: for the reasoning's "#2")
    roleTable(role, season) {
      const out = [];
      for (const [key, x] of roles) {
        const [opp, r] = key.split('|');
        if (r !== role || x.season !== season || x.n < 3) continue;
        out.push({ opp, factor: x.got / Math.max(1e-9, x.usual), n: x.n });
      }
      return out.sort((a, b) => a.factor - b.factor);
    },
    // (a day's rows learned together, after all of them were projected)
    learn(rows) {
      for (const row of rows) {
        const v = val(row);
        const pl = players.get(row.pid);
        const before = parts(row);
        if (before) {
          // (the opponent's tables: by position, and by role where the row has one)
          const tally = (table, key) => {
            let o = table.get(key);
            if (!o || o.season !== row.season) {
              const last = o && o.season === row.season - 1 ? o : null;
              o = { season: row.season, n: 0, got: 0, usual: 0, prevN: last?.n ?? 0, prevGot: last?.got ?? 0, prevUsual: last?.usual ?? 0 };
            }
            o.n++;
            o.got += v;
            o.usual += before.base;
            table.set(key, o);
          };
          tally(opps, `${row.opp}|${posKey(row)}`);
          if (row.role) tally(roles, `${row.opp}|${row.role}`);
        }
        // (his seasons: this one, last, and the ones before it (career))
        let p = pl;
        const add = (a, b) => ({ n: a.n + b.n, sum: a.sum + b.sum });
        if (!p) p = { season: row.season, cur: { n: 0, sum: 0, recent: [] }, prev: { n: 0, sum: 0 }, career: { n: 0, sum: 0 } };
        else if (p.season !== row.season) {
          const consecutive = p.season === row.season - 1;
          const before = add(p.career, p.prev);
          p = {
            season: row.season,
            cur: { n: 0, sum: 0, recent: [] },
            prev: consecutive ? { n: p.cur.n, sum: p.cur.sum } : { n: 0, sum: 0 },
            career: consecutive ? before : add(before, p.cur),
          };
        }
        p.cur.n++;
        p.cur.sum += v;
        p.cur.recent = [...p.cur.recent, v].slice(-5);
        players.set(row.pid, p);
        if (row.eligible !== false) {
          const k = posKey(row);
          const q = pos.get(k) ?? { n: 0, sum: 0 };
          q.n++;
          q.sum += v;
          pos.set(k, q);
        }
      }
    },
  };
}

// Replay a stat's rows in date order under one set of settings: each row's projection (where the player had
// two games or more before it) and its value, by window (0: teaching only, 1: fit, 2: check)
export function replayStat(stat, rows, params, env, cuts) {
  const m = makeModel(stat, params, env);
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const day = rows[i].date.slice(0, 10);
    let j = i;
    while (j < rows.length && rows[j].date.slice(0, 10) === day) j++;
    const batch = rows.slice(i, j);
    const win = day < cuts[0] ? 0 : day < cuts[1] ? 1 : 2;
    if (win) for (const row of batch) {
      const p = m.project(row);
      if (p) out.push({ row, p, v: Math.max(0, Math.round(row.s[stat.key])), win });
    }
    m.learn(batch);
    i = j;
  }
  return { model: m, out };
}

const R = [1, 1.5, 2.5, 4, 6, 10, 16, 30, 60, 150];
// (a window's log-likelihood at its best dispersion)
function scoreOf(out, win) {
  const list = out.filter((x) => x.win === win);
  let best = null;
  for (const r of R) {
    let ll = 0;
    for (const x of list) ll += nbLog(x.v, x.p.mu, r);
    if (!best || ll > best.ll) best = { ll, r };
  }
  return { ...best, n: list.length };
}

const GRID = { K: [2, 4, 8, 16, 32], w: [0, 0.2, 0.4, 0.6], a: [0, 0.5, 1], b: [-0.5, 0, 0.5, 1, 1.5], c: [-0.3, -0.15, 0, 0.15, 0.3], roleK: [Infinity, 32, 16, 8, 4, 2], fun: [0, 1, 2, 4, 8], pc: [0, 0.5, 1, 1.5], tg: [0, 0.5, 1] };
// (each matchup term's off setting, and which stats have it)
const OPTIONAL = { roleK: Infinity, fun: 0, pc: 0, tg: 0 };
const has = (stat, key) => (key === 'roleK' ? !!stat.roles : key === 'tg' ? !!stat.targets : !!stat.volume);

// (a window's chances of going over a line at each player's median so far, and what happened)
function linePairs(list, r) {
  const hist = new Map();
  const out = [];
  for (const x of [...list].sort((a, b) => a.row.date.localeCompare(b.row.date))) {
    const past = (hist.get(x.row.pid) ?? []).filter((h) => h.season === x.row.season).map((h) => h.v);
    if (past.length >= 3) {
      const vals = past.sort((a, b) => a - b);
      const line = Math.floor(vals[Math.floor(vals.length / 2)]) + 0.5;
      out.push({ x, vals, line, p: nbOver(line, x.p.mu, r), over: x.v > line ? 1 : 0 });
    }
    hist.set(x.row.pid, [...(hist.get(x.row.pid) ?? []), { season: x.row.season, v: x.v }]);
  }
  return out;
}

// A chance recalibrated: [shift, stretch] on its log-odds
export function recal(p, cal) {
  if (!cal) return p;
  const q = Math.min(0.995, Math.max(0.005, p));
  const z = cal[0] + cal[1] * Math.log(q / (1 - q));
  return 1 / (1 + Math.exp(-z));
}

// (the recalibration that best fits a window's chances to what happened)
function fitRecal(pairs) {
  let best = { ll: Infinity, cal: [0, 1] };
  for (let a = -0.6; a <= 0.6001; a += 0.05) {
    for (let b = 0.5; b <= 1.6001; b += 0.05) {
      let ll = 0;
      for (const x of pairs) {
        const p = recal(x.p, [a, b]);
        ll -= Math.log(x.over ? p : 1 - p);
      }
      if (ll < best.ll) best = { ll, cal: [Math.round(a * 100) / 100, Math.round(b * 100) / 100] };
    }
  }
  return best.cal;
}

// A stat's settings fit (one at a time, twice round) on the fit window, then checked on the last 30%
export function fitStat(stat, rows, env) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 300) return null;
  const at = (q) => sorted[Math.floor(sorted.length * q)].date.slice(0, 10);
  const cuts = [at(0.3), at(0.7)];
  let params = { K: 4, w: 0.2, a: 0.5, b: 0.5, c: 0, ...OPTIONAL };
  const optional = Object.keys(OPTIONAL).filter((k) => has(stat, k));
  const keys = [...(env.ctx ? ['K', 'w', 'a', 'b', 'c'] : ['K', 'w', 'a', 'b']), ...optional];
  let best = scoreOf(replayStat(stat, sorted, params, env, cuts).out, 1);
  for (let pass = 0; pass < 2; pass++) {
    for (const key of keys) {
      for (const v of GRID[key]) {
        if (v === params[key]) continue;
        const tryP = { ...params, [key]: v };
        const s = scoreOf(replayStat(stat, sorted, tryP, env, cuts).out, 1);
        if (s.ll > best.ll) (best = s), (params = tryP);
      }
    }
  }
  params.r = best.r;
  // (what's left of a lean on the eligible players once the rest is fit: their total over their projection)
  const fitOut = replayStat(stat, sorted, params, env, cuts).out.filter((x) => x.win === 1 && x.row.eligible !== false);
  const sumMu = fitOut.reduce((t, x) => t + x.p.mu, 0);
  params.scale = sumMu ? Math.round((fitOut.reduce((t, x) => t + x.v, 0) / sumMu) * 1000) / 1000 : 1;
  const { out } = replayStat(stat, sorted, params, env, cuts);
  // (the recalibration, fit on the middle window: its teaching games and its fit games, in order)
  // (the recalibration and the check: on the eligible players only, the ones a book posts props for)
  params.cal = fitRecal(linePairs(out.filter((x) => x.win === 1 && x.row.eligible !== false), params.r));
  // (each matchup term the fit took up, tested on the held-out games: left out unless its log loss on them is
  // lower with it; its gain recorded either way: the held-out log loss without it less with it)
  const heldOut = (p) => {
    const o = replayStat(stat, sorted, p, env, cuts).out;
    const cal = fitRecal(linePairs(o.filter((x) => x.win === 1 && x.row.eligible !== false), p.r));
    return { cal, check: check(o.filter((x) => x.win === 2 && x.row.eligible !== false), p.r, cal) };
  };
  let current = heldOut(params);
  const gains = {};
  for (const key of optional) {
    if (params[key] === OPTIONAL[key]) {
      gains[key] = null;
      continue;
    }
    const without = heldOut({ ...params, [key]: OPTIONAL[key] });
    gains[key] = Math.round(((without.check?.logLoss ?? 0) - (current.check?.logLoss ?? 0)) * 10000) / 10000;
    if (gains[key] <= 0) {
      params = { ...params, [key]: OPTIONAL[key], cal: without.cal };
      current = without;
    }
  }
  params.cal = current.cal;
  const final = replayStat(stat, sorted, params, env, cuts).out;
  // (the held-out numbers with no matchup terms at all, for the before and after)
  const base = optional.length ? heldOut({ ...params, ...OPTIONAL }).check : current.check;
  return { params, gains, base, check: current.check, checkAll: check(final.filter((x) => x.win === 2), params.r, params.cal), fitN: best.n };
}

// The check on the held-out games: the projection's error against a plain season average's, and its chance of
// going over a line at the player's median so far this season against what happened (log loss and Brier),
// against the plain answer (how often he'd gone over that line this season, pulled a game's worth toward
// even), with how often it picked the right side and a calibration table
function check(list, r, cal) {
  if (!list.length) return null;
  const hist = new Map();
  let mae = 0;
  let sumMu = 0;
  let sumV = 0;
  let maeBase = 0;
  let nBase = 0;
  let ll = 0;
  let brier = 0;
  let llBase = 0;
  let brierBase = 0;
  let nLine = 0;
  let sides = 0;
  let sideHits = 0;
  const bands = new Map();
  for (const x of list.sort((a, b) => a.row.date.localeCompare(b.row.date))) {
    mae += Math.abs(x.p.mu - x.v);
    sumMu += x.p.mu;
    sumV += x.v;
    const past = (hist.get(x.row.pid) ?? []).filter((h) => h.season === x.row.season);
    if (past.length >= 3) {
      const vals = past.map((h) => h.v).sort((a, b) => a - b);
      maeBase += Math.abs(vals.reduce((s, v) => s + v, 0) / vals.length - x.v);
      nBase++;
      const median = vals[Math.floor(vals.length / 2)];
      const line = Math.floor(median) + 0.5;
      const p = Math.min(0.995, Math.max(0.005, recal(nbOver(line, x.p.mu, r), cal)));
      const over = x.v > line ? 1 : 0;
      ll -= Math.log(over ? p : 1 - p);
      brier += (p - over) ** 2;
      const q = (vals.filter((v) => v > line).length + 1) / (vals.length + 2);
      llBase -= Math.log(over ? q : 1 - q);
      brierBase += (q - over) ** 2;
      nLine++;
      if (Math.abs(p - 0.5) >= 0.05) {
        sides++;
        if ((p > 0.5) === !!over) sideHits++;
      }
      const band = Math.min(0.8, Math.max(0.2, Math.floor(p * 10) / 10));
      const b = bands.get(band) ?? { n: 0, said: 0, was: 0 };
      b.n++;
      b.said += p;
      b.was += over;
      bands.set(band, b);
    }
    hist.set(x.row.pid, [...(hist.get(x.row.pid) ?? []), { season: x.row.season, v: x.v }]);
  }
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return {
    n: list.length,
    mae: r4(mae / list.length),
    bias: r4((sumMu - sumV) / list.length),
    maeBase: nBase ? r4(maeBase / nBase) : null,
    lines: nLine,
    logLoss: nLine ? r4(ll / nLine) : null,
    logLossBase: nLine ? r4(llBase / nLine) : null,
    brier: nLine ? r4(brier / nLine) : null,
    brierBase: nLine ? r4(brierBase / nLine) : null,
    sides,
    sideHit: sides ? r4(sideHits / sides) : null,
    calibration: [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([band, b]) => ({ band, n: b.n, said: r4(b.said / b.n), was: r4(b.was / b.n) })),
  };
}

