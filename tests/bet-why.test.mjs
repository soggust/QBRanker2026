// The Bets page's order and its rank tile breakdown (bet-why.ts), and the parts picks.mjs writes for it
// (scoreParts): the Kelly score, (b·p − (1 − p)) / b, split into the price (the book's fair chance against the
// price's break-even) and the model's lean, adding up to it; a heavy favorite with no edge on its price scores 0
// or under and sorts below a longer price with a real edge; the analyst's quarter never lowers a score; a picks
// file from before the Kelly score is worked out from its chances and price, and one with no price shows the
// chance alone. Made-up bets, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';
import { buildPicks, scoreParts } from '../libs/ranker/scripts/model/picks.mjs';
import { decimal } from '../libs/ranker/scripts/model/desk.mjs';

const desk = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support', 'bets-entry.ts'), data: {} });

const close = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const bet = (over = {}) => ({ id: 'x', sport: 'nfl', start: '2026-10-10T17:00:00Z', matchup: 'TB @ DAL', market: 'spread', side: 'home', line: -3, pick: 'DAL -3', odds: -110, model: 0.6, fair: 0.5, p: 0.535, ev: 0.0214, units: 1, status: 'open', profit: 0, ...over });
// (the Kelly fraction as written: (b·p − (1 − p)) / b)
const kelly = (p, odds) => {
  const b = decimal(odds) - 1;
  return (b * p - (1 - p)) / b;
};
const now = new Date('2026-10-09T12:00:00Z');
// (a -250 favorite the model agrees with the book on: no edge; a +150 dog the model likes: a real one)
const FAV = { id: 'fav', market: 'ml', side: 'home', pick: 'DAL ML', odds: -250, model: 0.7, fair: 0.7, p: 0.7, ev: -0.02, intent: 'action' };
const DOG = { id: 'dog', market: 'ml', side: 'away', pick: 'TB ML', odds: 150, model: 0.48, fair: 0.38, p: 0.415, ev: 0.0375, intent: 'edge' };

test('scoreParts: the Kelly score, price + lean adding up to it, the trust read back off the bet, where the fair chance came from', () => {
  const b = bet({ odds: -217, model: 0.7894, fair: 0.6571, p: 0.6571 + 0.35 * (0.7894 - 0.6571), fairFrom: 'pinnacle' });
  const parts = scoreParts(b, { spread: { fitted: true } });
  close(parts.price + parts.lean, parts.score, 'price + lean');
  close(parts.score, kelly(b.p, b.odds), 'the Kelly fraction', 1e-4);
  close(parts.p0, 217 / 317, 'break-even', 1e-4);
  assert.ok(parts.price < 0, 'the vig on this side');
  assert.ok(parts.lean > 0);
  assert.deepEqual([parts.trust, parts.fitted, parts.from], [0.35, true, 'pinnacle']);
  // (a model no different from the book: no trust to read, no lean; a prop with no price: an even line)
  const flat = scoreParts(bet({ market: 'prop', propType: 'k', model: 0.5, fair: 0.5, p: 0.5, oddsAssumed: true }), {});
  assert.deepEqual([flat.lean, flat.trust, flat.fitted, flat.from], [0, null, false, 'even']);
  assert.ok(flat.score < 0, 'an even chance at -110: the vig alone');
  // (a lean against the bet: the model under the book)
  const under = scoreParts(bet({ model: 0.45, fair: 0.6, p: 0.6 - 0.5 * 0.15 }), {});
  assert.ok(under.lean < 0);
  close(under.price + under.lean, under.score, 'price + lean (negative lean)');
});

test('buildPicks: by Kelly, a -250 favorite with no edge below a +150 bet with a real one; each pick its parts, adding up to its score', () => {
  const ledger = {
    bets: [
      bet(FAV),
      bet(DOG),
      bet({ id: 'a', model: 0.66, fair: 0.6, p: 0.627, ev: 0.197, intent: 'edge' }),
      bet({ id: 'b', market: 'total', side: 'over', pick: 'Over 47.5', model: 0.58, fair: 0.5123, p: 0.5427, ev: 0.036, intent: 'edge' }),
    ],
  };
  const out = buildPicks('nfl', ledger, { spread: { fitted: true } }, new Map(), now);
  assert.deepEqual(out.picks.map((p) => p.id), ['a', 'b', 'dog', 'fav']);
  const fav = out.picks.find((p) => p.id === 'fav');
  const dog = out.picks.find((p) => p.id === 'dog');
  assert.ok(fav.score <= 0, `the favorite's ${fav.score}`);
  assert.ok(dog.score > 0, `the dog's ${dog.score}`);
  assert.ok(fav.chance > dog.chance, 'the likelier bet ranked lower');
  assert.equal(fav.level, 'low');
  for (const p of out.picks) {
    close(p.why.price + p.why.lean, p.score, `${p.id}: price + lean`);
    close(p.score, kelly(p.p, p.odds), `${p.id}: Kelly`, 1e-4);
  }
  assert.equal(out.picks.find((p) => p.id === 'a').why.fitted, true);
  assert.equal(out.picks.find((p) => p.id === 'b').why.fitted, false);
});

test('the analyst agreeing: a quarter more of a positive score, never a lower one', () => {
  for (const s of [-0.08, -0.001, 0, 0.001, 0.05, 0.3]) {
    const w = desk.withAnalyst(s);
    assert.ok(w >= s, `${s} to ${w}`);
    if (s <= 0) assert.equal(w, s);
    else close(w, s * 1.25, 'a quarter more');
  }
});

// A row as the page builds it from a pick (picks.mjs's score; the analyst's quarter where it agrees)
const row = (pick, i, over = {}) => ({
  id: i,
  pick: pick.pick,
  market: 'Moneyline',
  confidence: pick.level,
  chance: pick.chance,
  sureness: pick.score,
  source: 'Algorithm',
  edge: pick.edge,
  model: pick.model,
  fair: pick.fair,
  p: pick.p,
  ev: pick.ev,
  units: pick.units,
  price: pick.odds,
  book: pick.book,
  why: pick.why ?? null,
  ...over,
});
const agree = (r) => Object.assign(r, { source: 'Algorithm + Analyst', sureness: desk.withAnalyst(r.sureness) });

test("betWhy: the parts add up to the row's Kelly score in points, the analyst's quarter on top, the gaps to the bets beside it the scores'", () => {
  const ledger = {
    bets: [
      bet(DOG),
      bet({ id: 'b', model: 0.62, fair: 0.55, p: 0.5745, ev: 0.097, intent: 'edge' }),
      bet(FAV),
    ],
  };
  const rows = buildPicks('nfl', ledger, {}, new Map(), now).picks.map((p, i) => row(p, i));
  // (the analyst agrees with the dog, and with the favorite: the favorite's no-edge score stays as it is)
  agree(rows.find((r) => r.pick === 'TB ML'));
  const favRow = rows.find((r) => r.pick === 'DAL ML');
  const before = favRow.sureness;
  agree(favRow);
  assert.equal(favRow.sureness, before);
  rows.sort((x, y) => y.sureness - x.sureness);
  for (const [i, r] of rows.entries()) {
    const w = desk.betWhy(rows, i);
    close(w.parts.reduce((s, p) => s + p.amount, 0), r.sureness * 100, `${r.pick} #${i + 1}: parts`);
    close(w.score, r.sureness * 100, 'score');
    assert.equal(w.partial, false);
    assert.ok(w.chanceText);
    assert.ok(w.parts.every((p) => p.title && p.width >= 0 && p.width <= 100));
    for (const vs of w.vs) {
      close(vs.diff, (r.sureness - rows[vs.rank - 1].sureness) * 100, 'gap');
      close(vs.drivers.reduce((s, d) => s + d.amount, 0), vs.diff, 'the gap made of its parts', 1e-6);
      assert.equal(vs.above, vs.rank > i + 1);
    }
  }
  const dog = desk.betWhy(rows, rows.findIndex((r) => r.pick === 'TB ML'));
  assert.deepEqual(dog.parts.map((p) => p.key), ['price', 'lean', 'analyst']);
  assert.ok(dog.parts[2].amount > 0);
  // (the lean's hover says the trust, read back off the bet: (0.415 − 0.38) / (0.48 − 0.38))
  assert.match(dog.parts[1].title, /Trust 0\.35 \(the untested start/);
  // (the favorite: last, no edge, low; the analyst adds nothing)
  const at = rows.findIndex((r) => r.pick === 'DAL ML');
  assert.equal(at, rows.length - 1);
  const fav = desk.betWhy(rows, at);
  assert.equal(fav.noEdge, true);
  assert.equal(fav.level, 'low');
  assert.match(fav.levelText, /no edge on the price/);
  assert.equal(fav.chanceText, '70.0%');
  assert.equal(fav.parts.find((p) => p.key === 'analyst').amount, 0);
  assert.equal(fav.edgeReturn + fav.edgeText, '−2.0% a unit at −250 · 1 unit');
  assert.equal(fav.edgeUp, false, 'no edge: red');
});

test('betWhy: an older picks file, its Kelly score and parts worked out from its chances and price; one with no price, the chance alone', () => {
  // (as the page reads one: no price part written, the score from kellyOf)
  const p = { pick: 'NYR ML', odds: -217, model: 0.7894, fair: 0.6571, p: 0.7034 };
  const score = desk.kellyOf(p.p, p.odds);
  close(score, kelly(p.p, p.odds), 'kellyOf', 1e-4);
  assert.equal(desk.kellyOf(undefined, -110), null);
  assert.equal(desk.kellyOf(0.6, undefined), null);
  const old = [
    { id: 0, pick: p.pick, market: 'Moneyline', confidence: 'high', chance: 70, sureness: score, source: 'Algorithm', edge: true, model: p.model, fair: p.fair, p: p.p, ev: 0.0276, units: 1.5, price: p.odds, book: 'DraftKings', why: { fair: 0.6571, lean: 0.0463, trust: 0.35, fitted: true, from: 'book' } },
    { id: 1, pick: 'Over 5.5', market: 'Game total', confidence: 'medium', chance: 55, sureness: 0.55, source: 'Algorithm' },
  ];
  const a = desk.betWhy(old, 0);
  assert.equal(a.partial, false);
  assert.deepEqual(a.parts.map((x) => x.key), ['price', 'lean']);
  close(a.parts.reduce((s, x) => s + x.amount, 0), score * 100, 'parts');
  assert.match(a.parts[1].title, /Trust 0\.35 \(fitted/);
  assert.equal(a.edgeReturn + a.edgeText, '+2.8% a unit at −217 · 1.5 units');
  assert.equal(a.edgeUp, true, 'an edge: green');
  const b = desk.betWhy(old, 1);
  assert.equal(b.partial, true);
  assert.deepEqual(b.parts.map((x) => x.key), ['chance']);
  close(b.parts[0].amount, 55, 'the chance alone');
  assert.equal(b.edgeText, null);
  // (a prop's player named first, once; the score signed)
  assert.equal(desk.betName({ pick: 'Over 5.5 strikeouts', player: 'Skubal' }), 'Skubal Over 5.5 strikeouts');
  assert.equal(desk.betName({ pick: 'Skubal Over 5.5', player: 'Skubal' }), 'Skubal Over 5.5');
  assert.deepEqual([desk.betScoreText(3.124), desk.betScoreText(-1.05), desk.betScoreText(0.001), desk.signedPoints(-0.004)], ['+3.12', '−1.05', '0.00', '−0.004']);
});

test("the page's bands are the bettor's: Lock (10%+ Kelly and a 60% chance), Love (5%), Bet (2%), Pass, the same cut for every score", async () => {
  const picks = await import('../libs/ranker/scripts/model/picks.mjs');
  assert.deepEqual(desk.BANDS, picks.BANDS);
  for (const kelly of [-0.05, 0, 0.0199, 0.02, 0.049, 0.05, 0.099, 0.1, 0.25]) {
    for (const p of [0.45, 0.59, 0.6, 0.75]) {
      const page = desk.confidenceOf(kelly, p, true);
      assert.equal(page, kelly > 0 ? picks.level(kelly, p) : 'low', `kelly ${kelly}, chance ${p}`);
    }
  }
  assert.equal(desk.confidenceOf(0.2, 0.7, true), 'lock');
  assert.equal(desk.confidenceOf(0.2, 0.55, true), 'high', 'a big edge on a coin flip is no lock');
  assert.equal(desk.confidenceOf(0.2, 0.7, false), 'low', 'no edge, no band');
});
