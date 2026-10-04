// How well the MMA rating predicts fights it hasn't seen: every fight's prediction is made from before it,
// so a season's predictions are honest. Tunes the rating's settings on the training years (a coordinate
// search on log loss, the measure that rewards confident right calls and punishes confident wrong ones)
// and reports the test years untouched, against the old UFC-only Elo.
//
// Usage: node apps/ufc/scripts/backtest.mjs [--tune]
import { keptFights } from './fights.mjs';
import { PARAMS, rate } from './rating.mjs';

const TRAIN = ['2008-01-01', '2019-12-31'];
const TEST = ['2020-01-01', '2099-12-31'];
// Judged on the fights that matter for the rankings: the big promotions
const JUDGED = new Set(['ufc', 'bellator', 'pfl', 'strikeforce', 'pride', 'wec', 'rizin']);

const fights = await keptFights();
console.log(`${fights.length} fights`);

// Log loss and accuracy of predictions over a date range (fights with a winner)
function score(predictions, [from, to], leagues = JUDGED) {
  let loss = 0;
  let right = 0;
  let n = 0;
  for (const f of fights) {
    if (f.date < from || f.date > to || !leagues.has(f.league)) continue;
    const [a, b] = f.fighters;
    if (a.winner === b.winner) continue;
    const pa = Math.min(0.99, Math.max(0.01, predictions.get(f.id)));
    loss -= Math.log(a.winner ? pa : 1 - pa);
    right += (pa > 0.5) === a.winner ? 1 : pa === 0.5 ? 0.5 : 0;
    n++;
  }
  return { loss: loss / n, acc: right / n, n };
}

// The old rating: Elo over UFC fights only, everyone at 1500, K = 32
function oldElo() {
  const elo = new Map();
  const predictions = new Map();
  for (const f of fights) {
    const [a, b] = f.fighters;
    const ra = elo.get(a.id) ?? 1500;
    const rb = elo.get(b.id) ?? 1500;
    const e = 1 / (1 + 10 ** ((rb - ra) / 400));
    predictions.set(f.id, e);
    if (f.league !== 'ufc' || f.method === 'NC' || (!a.winner && !b.winner && f.method !== 'DRAW')) continue;
    const s = a.winner ? 1 : b.winner ? 0 : 0.5;
    elo.set(a.id, ra + 32 * (s - e));
    elo.set(b.id, rb - 32 * (s - e));
  }
  return predictions;
}

const report = (name, predictions) => {
  const tr = score(predictions, TRAIN);
  const te = score(predictions, TEST);
  const ufc = score(predictions, TEST, new Set(['ufc']));
  console.log(
    `${name.padEnd(14)} train ${tr.loss.toFixed(4)} ${(tr.acc * 100).toFixed(1)}%  test ${te.loss.toFixed(4)} ${(te.acc * 100).toFixed(1)}% (${te.n})  test UFC ${ufc.loss.toFixed(4)} ${(ufc.acc * 100).toFixed(1)}%`,
  );
};

report('old Elo', oldElo());
report('rating', rate(fights, PARAMS).predictions);

if (process.argv.includes('--tune')) {
  // Coordinate search: nudge one setting at a time, keep what lowers the training log loss, shrink the
  // steps when nothing helps
  const p = structuredClone(PARAMS);
  const knobs = [
    ['rd0', 20],
    ['rdMin', 5],
    ['rdPerYear', 10],
    ['finishWeight', 0.05],
    ['divisionStep', 10],
    ['score.MD', 0.05],
    ['score.SD', 0.05],
    ['score.UD', 0.02],
    ['score.DQ', 0.1],
    ['leagueLift.ufc', 15],
    ['leagueLift.pride', 15],
    ['leagueLift.strikeforce', 15],
    ['leagueLift.wec', 15],
    ['leagueLift.bellator', 15],
    ['leagueLift.pfl', 15],
    ['leagueLift.rizin', 15],
  ];
  const getK = (o, k) => k.split('.').reduce((x, y) => x[y], o);
  const setK = (o, k, v) => {
    const parts = k.split('.');
    parts.slice(0, -1).reduce((x, y) => x[y], o)[parts.at(-1)] = v;
  };
  const lossOf = (q) => score(rate(fights, q).predictions, TRAIN).loss;
  let best = lossOf(p);
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (const [k, step0] of knobs) {
      const step = step0 / 2 ** pass;
      for (const dir of [1, -1]) {
        for (;;) {
          const q = structuredClone(p);
          setK(q, k, Math.round((getK(q, k) + dir * step) * 1000) / 1000);
          const l = lossOf(q);
          if (l < best - 1e-5) {
            best = l;
            setK(p, k, getK(q, k));
            improved = true;
          } else break;
        }
      }
    }
    console.log(`pass ${pass}: train loss ${best.toFixed(4)}`);
    if (!improved && pass > 0) break;
  }
  console.log(JSON.stringify(p, null, 2));
  report('tuned', rate(fights, p).predictions);
}
