// A game's margin and total as whole numbers: the chance of each, which the spread, the total and the moneyline
// are priced from (desk.mjs price), pushes and all.
//
//   the base    a normal around the expected margin (or total), its spread the history's own (sigma), cut into
//               whole numbers (k takes the normal's mass from k - 0.5 to k + 0.5)
//   no ties     the NBA, NHL and MLB have none (overtime, a shootout, extra innings): in the NHL and MLB a
//               tie's mass goes to a one-goal (one-run) win, the better side's share a little over half (the
//               overtime winner leaning its way, half as far as the game does); in the NBA, whose overtimes end
//               by any margin, it's shared out over every margin alike (NO_TIES)
//   the shape   how often each margin really comes against the base (the NFL's 3 and 7; the NHL's one-goal games
//               and empty nets): a weight for each margin |k|, fit on the history's finals against each one's
//               expected margin from the replay (predicted before it was played: no look-ahead), shrunk toward 1
//               (SHRINK made-up games at the base), and kept only if it predicts the held-out last 30% of the
//               finals' margins better than the base alone (fitMargins). Totals: the base alone
//   a side      its win, its push (an integer line landing on the number: its stake back) and its loss. The
//               model's chance set beside the book's fair chance is the win's share of the two that aren't a push
//               (the book's two prices know no push); its expected return is (1 - push)(p·decimal - 1)
//   moneyline   priced off the spread market, not off the margin's normal alone (that leaned to every underdog: a
//               normal's chance at the spread is under the book's, whose margins bunch at the key numbers): the
//               margins the book's spread and moneyline each imply, and the model's chance is the moneyline's
//               moved by the model's margin less the spread's (mlModel). The model agreeing with the spread is
//               the book's fair moneyline, so no edge
//   CLV         a line's points valued by the same chances: a half point onto the 3 worth far more than one onto
//               the 8 (atLine, clv.mjs)

import { phi } from './ratings.mjs';

// (the sports with no ties, and where a tie's mass goes: a one-goal or one-run win (a shootout, extra
// innings), or every margin alike (the NBA's overtimes))
export const NO_TIES = { nba: 'spread', nhl: 'one', mlb: 'one' };
// (the shape's shrink: made-up games at the base each margin's weight starts from)
const SHRINK = 20;
const RANGE = 6;

// The standard normal's inverse (Acklam's), for a chance as a margin
export function probit(p) {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (q < lo) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - lo) return -probit(1 - q);
  const t = q - 0.5;
  const r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// A margin's (or total's) chances at each whole number: { lo, p } (p[i] the chance of lo + i). shape: { ties,
// ot, w } (ties false: none, ot 'one' or 'spread' where its mass goes; w: |k| to its weight; none, the base)
export function marginDist(mean, sigma, shape = null) {
  const s = Math.max(0.1, sigma);
  const lo = Math.floor(mean - RANGE * s);
  const hi = Math.ceil(mean + RANGE * s);
  const p = new Array(hi - lo + 1);
  let prev = phi((lo - 0.5 - mean) / s);
  for (let k = lo; k <= hi; k++) {
    const c = phi((k + 0.5 - mean) / s);
    p[k - lo] = Math.max(0, c - prev);
    prev = c;
  }
  // (no ties: a tie's chance to a one-point win, the better side's share a little over half)
  if (shape && shape.ties === false && shape.ot === 'spread' && lo <= 0 && hi >= 0) p[-lo] = 0;
  else if (shape && shape.ties === false && lo <= -1 && hi >= 1) {
    const tie = p[-lo];
    const home = 0.5 + 0.5 * (phi(mean / s) - 0.5);
    p[-lo] = 0;
    p[1 - lo] += tie * home;
    p[-1 - lo] += tie * (1 - home);
  }
  const w = shape?.w;
  if (w) {
    for (let i = 0; i < p.length; i++) {
      const x = w[Math.abs(lo + i)];
      if (x !== undefined) p[i] *= x;
    }
  }
  const sum = p.reduce((t, x) => t + x, 0) || 1;
  for (let i = 0; i < p.length; i++) p[i] /= sum;
  return { lo, p };
}

// (a side's chances against the number it must beat: over it a win, on it a push, under it a loss)
function split(d, x) {
  let win = 0;
  let push = 0;
  let lose = 0;
  for (let i = 0; i < d.p.length; i++) {
    const k = d.lo + i;
    if (k > x + 1e-9) win += d.p[i];
    else if (Math.abs(k - x) <= 1e-9) push += d.p[i];
    else lose += d.p[i];
  }
  return { win, push, lose };
}

// A side's win share of the two that aren't a push (what the book's two fair chances price)
export const cond = (c) => (c.win + c.lose > 0 ? c.win / (c.win + c.lose) : 0.5);

// The home side's chances at its spread line (it covers when its margin plus its line is over 0); the away
// side's are the same with the margin and its own line (the shape is the same both ways)
export const spreadChances = (margin, line, sigma, shape) => split(marginDist(margin, sigma, shape), -line);
// The over's chances at a total's line
export const totalChances = (total, line, sigmaT) => split(marginDist(total, sigmaT, null), line);
// The home side's chances to win (an NFL tie a push)
export const mlChances = (margin, sigma, shape) => split(marginDist(margin, sigma, shape), 0);

// The mean at which a chance (rising with it) is the target: the margin or total a market's fair chance implies
export function impliedMean(chanceAt, target, center, sigma) {
  const want = Math.min(0.98, Math.max(0.02, target));
  let lo = center - RANGE * sigma;
  let hi = center + RANGE * sigma;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (chanceAt(mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The model's moneyline chances for the home side. With the book's spread (the home line and its fair chance)
// and its fair moneyline: the moneyline's implied margin moved by the model's margin less the spread's implied
// one (the model agreeing with the spread: the fair moneyline). Without them: its own margin's chances
export function mlModel(margin, sigma, shape, fairMlHome = null, spreadHome = null) {
  if (Number.isFinite(fairMlHome) && spreadHome && Number.isFinite(spreadHome.line) && Number.isFinite(spreadHome.fair)) {
    const mSpread = impliedMean((m) => cond(spreadChances(m, spreadHome.line, sigma, shape)), spreadHome.fair, -spreadHome.line, sigma);
    const mMl = impliedMean((m) => cond(mlChances(m, sigma, shape)), fairMlHome, 0, sigma);
    return { ...mlChances(mMl + margin - mSpread, sigma, shape), anchored: true };
  }
  return { ...mlChances(margin, sigma, shape), anchored: false };
}

// A side's closing fair chance carried from the close's line to its own (the closing market's implied margin
// or total, priced at the bet's line). dist: { sigma, sigmaT, shape }; null for a moneyline (no line to carry)
export function atLine(market, side, close, betLine, dist) {
  if (market === 'spread') {
    const home = side === 'home';
    const closeHome = home ? close.line : -close.line;
    const fairHome = home ? close.fair : 1 - close.fair;
    const m = impliedMean((x) => cond(spreadChances(x, closeHome, dist.sigma, dist.shape)), fairHome, -closeHome, dist.sigma);
    const q = cond(spreadChances(m, home ? betLine : -betLine, dist.sigma, dist.shape));
    return home ? q : 1 - q;
  }
  if (market === 'total') {
    const over = side === 'over';
    const fairOver = over ? close.fair : 1 - close.fair;
    const t = impliedMean((x) => cond(totalChances(x, close.line, dist.sigmaT)), fairOver, close.line, dist.sigmaT);
    const q = cond(totalChances(t, betLine, dist.sigmaT));
    return over ? q : 1 - q;
  }
  return null;
}

// The shape fit on the history (finals: the games; expOf: game id to its expectation before it was played, the
// replay's): each margin's weight against the base, kept only if the held-out last 30% are better predicted.
// Its summary: { ties, w (null: the base), kept, gain (the held-out games' mean log likelihood, better by), n }
export function fitMargins(sport, finals, expOf, sigma) {
  const ties = !NO_TIES[sport];
  const plain = { ties, ot: NO_TIES[sport] ?? null, w: null };
  const games = finals.filter((g) => g.final && g.hs !== null && g.as !== null && expOf.get(g.id)).sort((a, b) => a.date.localeCompare(b.date));
  // (after the replay's burn-in: its first games' expectations are the ratings still starting out)
  const rows = games.slice(Math.floor(games.length * 0.3)).map((g) => ({ m: expOf.get(g.id).margin, k: g.hs - g.as }));
  if (rows.length < 400) return { ...plain, kept: false, gain: null, n: rows.length };
  const K = Math.max(3, Math.ceil(2.5 * sigma));
  const cut = Math.floor(rows.length * 0.7);
  const ll = (list, shape) => {
    let s = 0;
    for (const x of list) {
      const d = marginDist(x.m, sigma, shape);
      const i = x.k - d.lo;
      s += Math.log(Math.max(1e-9, i >= 0 && i < d.p.length ? d.p[i] : 0));
    }
    return s / list.length;
  };
  const trained = { ...plain, w: weightsOn(rows.slice(0, cut), sigma, plain, K) };
  const gain = ll(rows.slice(cut), trained) - ll(rows.slice(cut), plain);
  if (!(gain > 0)) return { ...plain, kept: false, gain: Math.round(gain * 1e5) / 1e5, n: rows.length };
  return { ...plain, w: weightsOn(rows, sigma, plain, K), kept: true, gain: Math.round(gain * 1e5) / 1e5, n: rows.length };
}

// (each margin's weight: how often it came over how often the chances without its own weight say it should,
// SHRINK made-up games at 1 added to both (a gamma prior's posterior mean: a margin seen a handful of times
// moves little), a few rounds, the others' weights moving the normalization)
function weightsOn(rows, sigma, base, K) {
  const w = {};
  for (let a = base.ties ? 0 : 1; a <= K; a++) w[a] = 1;
  const seen = new Array(K + 1).fill(0);
  for (const x of rows) if (Math.abs(x.k) <= K) seen[Math.abs(x.k)]++;
  for (let round = 0; round < 6; round++) {
    const expected = new Array(K + 1).fill(0);
    for (const x of rows) {
      const d = marginDist(x.m, sigma, { ...base, w });
      for (let i = 0; i < d.p.length; i++) {
        const a = Math.abs(d.lo + i);
        if (a <= K) expected[a] += d.p[i];
      }
    }
    for (const a of Object.keys(w)) w[a] = (seen[a] + SHRINK) / (expected[a] / w[a] + SHRINK);
  }
  for (const a of Object.keys(w)) w[a] = Math.round(w[a] * 1e4) / 1e4;
  return w;
}
