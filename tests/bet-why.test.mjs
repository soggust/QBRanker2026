// The Bets page's rank tile breakdown (bet-why.ts) and the parts picks.mjs writes for it (scoreParts): the
// book's fair chance and the model's lean add up to the score the picks are ordered by, the analyst's quarter
// on top where it agrees; a picks file from before the parts still splits its score off the chances it kept,
// and one with neither shows the chance alone. Made-up bets, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';
import { buildPicks, scoreParts } from '../libs/ranker/scripts/model/picks.mjs';

const desk = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support', 'bets-entry.ts'), data: {} });

const close = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const bet = (over = {}) => ({ id: 'x', sport: 'nfl', start: '2026-10-10T17:00:00Z', matchup: 'TB @ DAL', market: 'spread', side: 'home', line: -3, pick: 'DAL -3', odds: -110, model: 0.6, fair: 0.5, p: 0.535, ev: 0.0214, units: 1, status: 'open', profit: 0, ...over });

test('scoreParts: fair + lean is the score, the trust read back off the bet, fitted or not, where the fair chance came from', () => {
  const b = bet({ model: 0.7894, fair: 0.6571, p: 0.6571 + 0.35 * (0.7894 - 0.6571), fairFrom: 'pinnacle' });
  const parts = scoreParts(b, { spread: { fitted: true } });
  close(parts.fair + parts.lean, parts.score, 'fair + lean');
  assert.equal(parts.score, 0.7034);
  assert.equal(parts.trust, 0.35);
  assert.equal(parts.fitted, true);
  assert.equal(parts.from, 'pinnacle');
  // (a model no different from the book: no trust to read; a prop with no price: an even line)
  const flat = scoreParts(bet({ market: 'prop', propType: 'k', model: 0.5, fair: 0.5, p: 0.5, oddsAssumed: true }), {});
  assert.deepEqual([flat.lean, flat.trust, flat.fitted, flat.from], [0, null, false, 'even']);
  // (a lean against the bet: the model under the book)
  const under = scoreParts(bet({ model: 0.45, fair: 0.6, p: 0.6 - 0.5 * 0.15 }), {});
  assert.ok(under.lean < 0);
  close(under.fair + under.lean, under.score, 'fair + lean (negative lean)');
});

test('buildPicks: each pick carries its parts, and they add up to its score', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const ledger = {
    bets: [
      bet({ id: 'a', model: 0.66, fair: 0.6, p: 0.627, ev: 0.03, intent: 'edge' }),
      bet({ id: 'b', market: 'total', side: 'over', pick: 'Over 47.5', model: 0.58, fair: 0.5123, p: 0.5427, ev: 0.012, intent: 'edge' }),
      bet({ id: 'c', market: 'ml', side: 'away', pick: 'TB ML', model: 0.3, fair: 0.36, p: 0.333, ev: -0.02, intent: 'action' }),
    ],
  };
  const out = buildPicks('nfl', ledger, { spread: { fitted: true } }, new Map(), now);
  assert.equal(out.picks.length, 3);
  for (const p of out.picks) {
    close(p.why.fair + p.why.lean, p.score, `${p.id}: fair + lean`, 1e-9);
    assert.equal(p.score, Math.round(p.p * 1e4) / 1e4);
  }
  assert.equal(out.picks.find((p) => p.id === 'a').why.fitted, true);
  assert.equal(out.picks.find((p) => p.id === 'b').why.fitted, false);
});

// A row as the page builds it from a pick
const row = (pick, i, over = {}) => ({
  id: i,
  pick: pick.pick,
  market: 'Spread',
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

test("betWhy: the parts add up to the row's score in points, the analyst's quarter on top, the gaps to the bets beside it the scores'", () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const ledger = {
    bets: [
      bet({ id: 'a', model: 0.7, fair: 0.6, p: 0.635, ev: 0.04, intent: 'edge', odds: -150 }),
      bet({ id: 'b', model: 0.62, fair: 0.55, p: 0.5745, ev: 0.03, intent: 'edge' }),
      bet({ id: 'c', model: 0.5, fair: 0.58, p: 0.552, ev: -0.01, intent: 'action' }),
    ],
  };
  const picks = buildPicks('nfl', ledger, {}, new Map(), now).picks;
  const rows = picks.map((p, i) => row(p, i));
  // (the analyst agrees with the second: a quarter more, as the page orders it)
  rows[1].source = 'Algorithm + Analyst';
  rows[1].sureness *= 1.25;
  rows.sort((x, y) => y.sureness - x.sureness);
  for (const [i, r] of rows.entries()) {
    const w = desk.betWhy(rows, i);
    close(w.parts.reduce((s, p) => s + p.amount, 0), r.sureness * 100, `${r.pick} #${i + 1}: parts`);
    close(w.score, r.sureness * 100, 'score');
    assert.equal(w.partial, false);
    assert.ok(w.parts.every((p) => p.title && p.width >= 0 && p.width <= 100));
    assert.equal(Math.max(...w.parts.map((p) => p.width)), 100);
    for (const vs of w.vs) {
      close(vs.diff, (r.sureness - rows[vs.rank - 1].sureness) * 100, 'gap');
      close(vs.drivers.reduce((s, d) => s + d.amount, 0), vs.diff, 'the gap made of its parts', 1e-6);
      assert.equal(vs.above, vs.rank > i + 1);
    }
  }
  const agreed = desk.betWhy(rows, 0);
  assert.deepEqual(agreed.parts.map((p) => p.key), ['fair', 'lean', 'analyst']);
  assert.equal(agreed.vs.length, 1);
  // (the lean's hover says the trust, read back off the bet: (0.5745 − 0.55) / (0.62 − 0.55))
  assert.match(agreed.parts[1].title, /Trust 0\.35 \(the untested start/);
  // (a bet without an edge: low, and it says why)
  const fav = rows.findIndex((r) => r.edge === false);
  const w = desk.betWhy(rows, fav);
  assert.equal(w.level, 'low');
  assert.match(w.levelText, /no edge on the price/);
  assert.equal(w.edgeText, '−1.0% a unit at −110 · 1 unit');
  assert.ok(w.parts.find((p) => p.key === 'lean').amount < 0);
});

test('betWhy: an older picks file, the parts worked out from its chances; one with no chances, the chance alone', () => {
  const old = [
    { id: 0, pick: 'NYR ML', market: 'Moneyline', confidence: 'high', chance: 70, sureness: 0.7034, source: 'Algorithm', edge: true, model: 0.7894, fair: 0.6571, p: 0.7034, ev: 0.0276, units: 1.5, price: -217, book: 'DraftKings' },
    { id: 1, pick: 'Over 5.5', market: 'Game total', confidence: 'medium', chance: 55, sureness: 0.55, source: 'Algorithm' },
  ];
  const a = desk.betWhy(old, 0);
  assert.equal(a.partial, false);
  close(a.parts.reduce((s, p) => s + p.amount, 0), 70.34, 'parts', 1e-9);
  assert.match(a.parts[1].title, /Trust 0\.35 × the model/);
  assert.equal(a.edgeText, '+2.8% a unit at −217 · 1.5 units');
  const b = desk.betWhy(old, 1);
  assert.equal(b.partial, true);
  assert.deepEqual(b.parts.map((p) => p.key), ['chance']);
  close(b.parts[0].amount, 55, 'the chance alone');
  assert.equal(b.edgeText, null);
  assert.equal(b.vs[0].rank, 1);
  // (a prop's player named first, once)
  assert.equal(desk.betName({ pick: 'Over 5.5 strikeouts', player: 'Skubal' }), 'Skubal Over 5.5 strikeouts');
  assert.equal(desk.betName({ pick: 'Skubal Over 5.5', player: 'Skubal' }), 'Skubal Over 5.5');
  assert.deepEqual([desk.betScoreText(70.344), desk.signedPoints(-0.004), desk.signedPoints(4.6)], ['70.34', '−0.004', '+4.60']);
});
