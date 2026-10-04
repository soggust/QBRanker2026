// The MMA rating: a Glicko-style rating over every pro fight, oldest first. Each fighter has a rating (how
// good) and a deviation (how sure we are of it). A fight moves both by how surprising its result was
// against how sure we were of each: beating a highly rated opponent moves a fighter a lot, beating a
// low one barely at all, and a fighter we know little about moves more than an established one.
//
// - How it ended: a finish (or a clear decision) is a full win; a majority or split decision counts for
//   less (a split nearly a coin flip), a disqualification less still; a draw splits it; a no contest
//   counts for nothing
// - Time: the deviation grows while a fighter sits out, so a return moves him more, and a ranking that
//   uses the cautious rating (rating less half its deviation) slides him down while he's away
// - Weight classes: a fighter moving up a division starts there a little lower (and moving down, a little
//   higher), the bigger opponents being better than the ones he's rated against
// - Newcomers: everyone starts at the same rating, a little higher in the bigger promotions (their
//   debutants come in with better records), with a wide deviation
//
// The settings (PARAMS) are tuned on past fights by scripts/backtest.mjs: the ones that best predicted
// fights the rating hadn't seen.

export const PARAMS = {
  // A new fighter's rating and deviation, and his start's lift by promotion (the bigger promotions' debutants
  // come in better; Bellator's, for all its size, a little below the regional average)
  start: 1500,
  rd0: 222.5,
  leagueLift: { ufc: 75, wec: 60, strikeforce: 22.5, pfl: 20, rizin: 20, pride: 10, ksw: 0, 'cage-warriors': 0, lfa: 0, bellator: -25 },
  // The deviation's floor, and its growth a year out (so a long layoff isn't treated as no information)
  rdMin: 45,
  rdPerYear: 85,
  // A win's score by how it ended (the loser gets one less), and the weight of a finish's update. (Tuned,
  // a split decision tells next to nothing about the next fight; it keeps a little credit here, a ranking
  // being about results too. A disqualification is too rare to learn from: it counts as nothing.)
  score: { KO: 1, SUB: 1, UD: 0.96, MD: 0.85, SD: 0.6, DQ: 0.5, DEC: 1 },
  finishWeight: 1.05,
  // A division up (or down): the rating's change (tuned, next to none)
  divisionStep: 5,
};

const Q = Math.LN10 / 400;
const g = (rd) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
const expected = (r, rj, rdj) => 1 / (1 + 10 ** ((-g(rdj) * (r - rj)) / 400));

// Weight classes in pounds (men's and women's), from ESPN's division names; a promotion's own names
// first (PRIDE's middleweight was 205)
const POUNDS = {
  heavyweight: 265,
  'light heavyweight': 205,
  middleweight: 185,
  welterweight: 170,
  lightweight: 155,
  featherweight: 145,
  bantamweight: 135,
  flyweight: 125,
  strawweight: 115,
  atomweight: 105,
};
const LEAGUE_POUNDS = { pride: { middleweight: 205, welterweight: 185, lightweight: 160 } };
const CLASSES = [115, 125, 135, 145, 155, 170, 185, 205, 265];

// A fight's weight class (null: a catchweight, open weight or unknown) and whether it's women's
export function weightOf(fight) {
  const text = (fight.division ?? '').toLowerCase();
  const women = /^(w |women)/.test(text);
  const name = text.replace(/^(w |women'?s )/, '').trim();
  const lbs = LEAGUE_POUNDS[fight.league]?.[name] ?? POUNDS[name] ?? null;
  return { lbs, women };
}

// A fight's result for its first fighter: [score, weight], or null for a no contest
function outcome(fight, p) {
  const [a, b] = fight.fighters;
  const method = fight.method ?? '';
  if (method === 'NC') return null;
  // (no winner: a draw if it went the distance, otherwise a no contest)
  if (!a.winner && !b.winner) return /^(DRAW|UD|SD|MD|DEC)$/.test(method) ? [0.5, 1] : null;
  const finish = method === 'KO' || method === 'SUB';
  const win = p.score[method] ?? 1;
  return [a.winner ? win : 1 - win, finish ? p.finishWeight : 1];
}

// Rate every fight, oldest first. Returns each fighter's state now ({ r, rd, last, fights, lbs, women })
// and each fight's prediction for its first fighter (by fight id, from before it); onBefore and onAfter see
// both fighters' states going into each fight (time away and weight class counted) and coming out.
export function rate(fights, p = PARAMS, { onBefore, onAfter } = {}) {
  const state = new Map();
  const predictions = new Map();
  const fresh = (league) => ({ r: p.start + (p.leagueLift[league] ?? 0), rd: p.rd0, last: null, fights: 0, lbs: null, women: false });
  for (const fight of fights) {
    const [a, b] = fight.fighters;
    const { lbs, women } = weightOf(fight);
    const day = Date.parse(fight.date);
    const sides = [a, b].map((f) => {
      const s = state.get(f.id) ?? fresh(fight.league);
      // (time away: the deviation grows)
      if (s.last !== null) s.rd = Math.min(p.rd0, Math.sqrt(s.rd ** 2 + (p.rdPerYear ** 2 * (day - s.last)) / 31557600000));
      // (a new weight class: a step down in rating per class up)
      if (lbs && s.lbs && lbs !== s.lbs) {
        const steps = CLASSES.indexOf(lbs) - CLASSES.indexOf(s.lbs);
        if (CLASSES.includes(lbs) && CLASSES.includes(s.lbs)) s.r -= steps * p.divisionStep;
      }
      return s;
    });
    const [sa, sb] = sides;
    onBefore?.(fight, sa, sb);
    // The prediction: the first fighter's chance, both deviations counted
    predictions.set(fight.id, expected(sa.r, sb.r, Math.sqrt(sa.rd ** 2 + sb.rd ** 2)));
    const result = outcome(fight, p);
    for (const [i, s] of sides.entries()) {
      const o = sides[1 - i];
      if (result) {
        const [score, weight] = result;
        const mine = i === 0 ? score : 1 - score;
        const gj = g(o.rd);
        const e = expected(s.r, o.r, o.rd);
        const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
        const denom = 1 / s.rd ** 2 + 1 / d2;
        s.next = { r: s.r + (Q / denom) * gj * (mine - e) * weight, rd: Math.max(p.rdMin, Math.sqrt(1 / denom)) };
      } else {
        s.next = { r: s.r, rd: s.rd };
      }
    }
    for (const [i, s] of sides.entries()) {
      s.r = s.next.r;
      s.rd = s.next.rd;
      delete s.next;
      s.last = day;
      s.fights++;
      if (lbs) s.lbs = lbs;
      s.women = women || s.women;
      s.league = fight.league;
      state.set([a, b][i].id, s);
    }
    onAfter?.(fight, sa, sb);
  }
  return { state, predictions };
}

// A rating's deviation as of a day (it grows while he's away)
export function deviationOn(s, day, p = PARAMS) {
  if (s.last === null) return s.rd;
  return Math.min(p.rd0, Math.sqrt(s.rd ** 2 + (p.rdPerYear ** 2 * (day - s.last)) / 31557600000));
}

// The cautious rating ranked on: the rating less half its deviation, so a fighter we're unsure of (new, or
// away a while) ranks below one we're sure of at the same rating. (Half: MMA results are noisy, so every
// deviation stays wide, 150 or so even for a veteran; less all of it, the deviations' own differences
// would reorder fighters as much as their ratings do.)
export const cautious = (r, rd) => r - 0.5 * rd;

// A weight class and gender -> the app's tab
export function tabOf(lbs, women) {
  if (women) return lbs >= 135 ? 'WBW' : lbs >= 125 ? 'WFLW' : 'WSW';
  if (!lbs) return null;
  return lbs >= 265 ? 'HW' : lbs >= 205 ? 'LHW' : lbs >= 185 ? 'MW' : lbs >= 170 ? 'WW' : lbs >= 155 ? 'LW' : lbs >= 145 ? 'FW' : lbs >= 135 ? 'BW' : 'FLW';
}

// The rating replayed month by month, for the all-time lists and each fighter's best moments. Every
// month, each division's fighters (3+ fights, one in the last 450 days: Fight Matrix's rule) are ranked
// by their cautious rating, across every promotion, and the top 15 earn career points: 1 a month for #1,
// less down the list (0.85 a place), scaled by how deep the division was then (full points from 30
// ranked fighters up), so ten years at the top of a deep division is worth the most. Also, for each
// fighter: his peak cautious rating, the best opponent he beat and his quality wins (by the opponent's
// cautious rating going in), and his opponents' average. A month's points count in full while he fights in
// a promotion that was the sport's premier competition (the UFC; PRIDE and Strikeforce in their day, and
// the WEC for the lighter weights), half elsewhere: a long reign over a thinner field is worth less
export const POINTS = { places: 15, decay: 0.85, depth: 30, activeDays: 450, minFights: 3, qualityTop: 0.1, premier: ['ufc', 'pride', 'strikeforce', 'wec'], elsewhere: 0.5 };

export function history(fights, p = PARAMS) {
  const out = new Map();
  const of = (id) => {
    let h = out.get(id);
    if (!h) out.set(id, (h = { points: 0, byTab: {}, peak: null, bestWin: null, qualityWins: 0, qualityByTab: {}, oppSum: 0, oppN: 0, months1: 0, bestPlace: null, wins: [] }));
    return h;
  };
  const live = new Map();
  // (each fight's pre-fight cautious ratings, for quality wins; the bar is the top tenth of rated fighters)
  const before = [];
  let month = null;
  const snapshot = (endDay) => {
    const tabs = new Map();
    for (const [id, s] of live) {
      if (s.fights < POINTS.minFights || endDay - s.last > POINTS.activeDays * 864e5) continue;
      const tab = tabOf(s.lbs, s.women);
      if (!tab) continue;
      (tabs.get(tab) ?? tabs.set(tab, []).get(tab)).push([id, cautious(s.r, deviationOn(s, endDay, p))]);
    }
    for (const [tab, list] of tabs) {
      list.sort((a, b) => b[1] - a[1]);
      const depth = Math.min(1, list.length / POINTS.depth);
      list.slice(0, POINTS.places).forEach(([id], i) => {
        const h = of(id);
        const pts = ((POINTS.decay ** i * depth) / 12) * (POINTS.premier.includes(live.get(id).league) ? 1 : POINTS.elsewhere);
        h.points += pts;
        h.byTab[tab] = (h.byTab[tab] ?? 0) + pts;
        if (i === 0) h.months1++;
        if (h.bestPlace === null || i + 1 < h.bestPlace) h.bestPlace = i + 1;
      });
    }
  };
  // (every month's end from the last snapshot's month up to, not including, this one)
  const catchUp = (m) => {
    if (month && m > month) {
      for (let d = new Date(`${month}-01T00:00:00Z`); d.toISOString().slice(0, 7) < m; d.setUTCMonth(d.getUTCMonth() + 1)) {
        const end = new Date(d);
        end.setUTCMonth(end.getUTCMonth() + 1);
        snapshot(end.getTime() - 1);
      }
    }
    month = m;
  };
  rate(fights, p, {
    onBefore(fight, sa, sb) {
      catchUp(fight.date.slice(0, 7));
      const [a, b] = fight.fighters;
      const ca = cautious(sa.r, sa.rd);
      const cb = cautious(sb.r, sb.rd);
      before.push(ca, cb);
      const tab = tabOf(weightOf(fight).lbs, weightOf(fight).women);
      for (const [me, theirs, opp] of [[a, cb, sb], [b, ca, sa]]) {
        const h = of(me.id);
        // (an opponent with no fight before this one is just the starting guess: not counted)
        if (opp.fights > 0) {
          h.oppSum += theirs;
          h.oppN++;
        }
        if (me.winner && opp.fights > 0) {
          if (h.bestWin === null || theirs > h.bestWin) h.bestWin = theirs;
          h.wins.push([theirs, tab]);
        }
      }
    },
    onAfter(fight, sa, sb) {
      for (const [f, s] of [[fight.fighters[0], sa], [fight.fighters[1], sb]]) {
        live.set(f.id, s);
        const h = of(f.id);
        const c = cautious(s.r, s.rd);
        if (s.fights >= POINTS.minFights && (h.peak === null || c > h.peak)) h.peak = c;
      }
    },
  });
  // (the months since the last fight, up to this one)
  catchUp(new Date().toISOString().slice(0, 7));
  // (quality wins: over an opponent rated in the top tenth of every pre-fight rating)
  before.sort((x, y) => x - y);
  const bar = before[Math.floor(before.length * (1 - POINTS.qualityTop))];
  for (const h of out.values()) {
    for (const [r, tab] of h.wins ?? []) {
      if (r < bar) continue;
      h.qualityWins++;
      if (tab) h.qualityByTab[tab] = (h.qualityByTab[tab] ?? 0) + 1;
    }
    delete h.wins;
  }
  return { history: out, qualityBar: bar };
}
