// The desk's timing (libs/ranker/scripts/model/timing.mjs, leagues.mjs TIMING): a game's window and last
// chance, the news its bets wait for, and the inputs a bet is priced again on. No network: the facts are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMING, LEAGUES } from '../libs/ranker/scripts/model/leagues.mjs';
import { cadenceOf, inputChanges, inputsOf, lastChanceOf, newsMissing, phaseOf, propAsk } from '../libs/ranker/scripts/model/timing.mjs';
import { fitTrust } from '../libs/ranker/scripts/model/desk.mjs';

const H = 36e5;
const game = { id: 'g1', home: '1', away: '2', homeAbbr: 'HOM', awayAbbr: 'AWY' };

test('TIMING: every league has a window for its lines and props, the last chance inside both', () => {
  for (const sport of Object.keys(LEAGUES)) {
    const t = TIMING[sport];
    assert.ok(t, sport);
    for (const kind of ['lines', 'props']) assert.ok(t[kind] > t.lastChance && t.lastChance >= 2, `${sport} ${kind}`);
    // (the hourly runs come late at times: the last chance gives at least two)
    assert.ok(t.lastChance >= 2);
  }
});

test('phaseOf: early before the window, open in it, last inside the last chance', () => {
  assert.equal(phaseOf('nfl', 'lines', 48 * H), 'early');
  assert.equal(phaseOf('nfl', 'lines', 20 * H), 'open');
  assert.equal(phaseOf('nfl', 'props', 2 * H), 'last');
  assert.equal(phaseOf('nba', 'props', 7 * H), 'early');
  assert.equal(phaseOf('nba', 'props', 5 * H), 'open');
});

test('cadenceOf / phaseOf: runs coming further apart than the last chance stretch it (1.5 times the median gap, 12 hours at most)', () => {
  const at = (hours) => hours.map((h) => new Date(Date.UTC(2026, 9, 9) + h * H).toISOString());
  assert.equal(cadenceOf(at([0, 1])), null);
  // (gaps 8.7, 11, 3.9, 5.8, 6.6, 5.3, 3.9, 3.3: the median 5.55)
  const gap = cadenceOf(at([0, 8.7, 19.7, 23.6, 29.4, 36, 41.3, 45.2, 48.5]));
  assert.ok(Math.abs(gap - 5.55) < 1e-9);
  assert.ok(Math.abs(lastChanceOf('mlb', gap) - 8.325) < 1e-9);
  // (an MLB game 7 hours off: early by the hourly design, but the next run likely comes after its start)
  assert.equal(phaseOf('mlb', 'lines', 7 * H), 'early');
  assert.equal(phaseOf('mlb', 'lines', 7 * H, gap), 'last');
  // (hourly runs: the sport's own)
  assert.equal(lastChanceOf('nfl', 1), 3);
  assert.equal(lastChanceOf('nba', 40), 12);
});

test("inputChanges: an MLB starter scratched to none named is news; a side's whole injury list gone empty waits a run", () => {
  const was = inputsOf('mlb', game, { pk: 1, hp: '11', ap: '12', names: ['S Eleven', 'S Twelve'], lineups: [['1'], ['2']] }, null);
  const tbd = inputsOf('mlb', game, { pk: 1, hp: null, ap: '12', lineups: [['1'], ['2']] }, null);
  assert.deepEqual(
    inputChanges(was.hash, tbd, { game }).map((c) => c.words),
    ['HOM starting pitcher (none named now)'],
  );
  // (StatsAPI unread: still no change)
  assert.deepEqual(inputChanges(was.hash, inputsOf('mlb', game, { hp: null }, null, { statsapi: false })), []);
  const before = inputsOf('nba', game, { injuries: report([{ id: '5', name: 'A Five', status: 'Out' }, { id: '6', name: 'A Six', status: 'Day-To-Day' }], []) }, null);
  const empty = inputsOf('nba', game, { injuries: report([], []) }, null);
  assert.deepEqual(inputChanges(before.hash, empty, { game, before: before.parts }), []);
  // (a second run agreeing: the run before saw it empty too)
  assert.deepEqual(
    inputChanges(before.hash, empty, { game, before: empty.parts }).map((c) => c.key),
    ['out:h', 'q:h'],
  );
  // (day-to-day is questionable)
  assert.equal(before.parts['q:h'], '6');
});

test('newsMissing: the NHL waits for both goalies; MLB lines for both starters and lineups; a batter for his lineup', () => {
  assert.deepEqual(newsMissing('nfl', {}), []);
  assert.deepEqual(newsMissing('nba', {}, { kind: 'props' }), []);
  assert.equal(newsMissing('nhl', { home: { id: '9' } }).length, 1);
  assert.deepEqual(newsMissing('nhl', { home: { id: '9' }, away: { id: '8' } }), []);
  const mlb = { hp: '11', ap: '12', lineups: [['1', '2'], null] };
  assert.deepEqual(newsMissing('mlb', mlb, { kind: 'lines' }), ['the lineups not posted']);
  assert.deepEqual(newsMissing('mlb', mlb, { kind: 'props', home: true }), []);
  assert.deepEqual(newsMissing('mlb', mlb, { kind: 'props', home: false }), ['his lineup not posted']);
  assert.deepEqual(newsMissing('mlb', mlb, { kind: 'props', home: false, pitcher: true }), []);
  assert.deepEqual(newsMissing('mlb', { ap: '12' }, { kind: 'props', home: true, pitcher: true }), ['his start not announced']);
});

const report = (home, away) =>
  new Map([
    ['1', home],
    ['2', away],
  ]);

test('inputsOf / inputChanges: a teammate ruled out changes the inputs, with his name; nothing else does', () => {
  const was = inputsOf('nba', game, { injuries: report([{ id: '5', name: 'A Five', status: 'Questionable' }], []) }, null);
  const same = inputsOf('nba', game, { injuries: report([{ id: '5', name: 'A Five', status: 'Questionable' }], []) }, null);
  assert.deepEqual(inputChanges(was.hash, same), []);
  const now = inputsOf('nba', game, { injuries: report([{ id: '5', name: 'A Five', status: 'Out' }], []) }, null);
  const changes = inputChanges(was.hash, now, { game, before: was.parts, names: now.names });
  assert.deepEqual(
    changes.map((c) => c.key),
    ['out:h', 'q:h'],
  );
  assert.match(changes[0].words, /HOM out list \(\+A Five\)/);
});

test("inputChanges: an injury report unread this run, or a goalie dropped from the listing, isn't news", () => {
  const was = inputsOf('nhl', game, { injuries: report([], []), home: { id: '30', name: 'G One', status: 'expected' }, away: { id: '31', name: 'G Two', status: 'expected' } }, null);
  // (the report failed: unread, not a change)
  const failed = inputsOf('nhl', game, { injuriesFailed: true, home: { id: '30', name: 'G One', status: 'expected' }, away: { id: '31', name: 'G Two', status: 'expected' } }, null);
  assert.deepEqual(inputChanges(was.hash, failed), []);
  // (a goalie no longer listed: not a change)
  const dropped = inputsOf('nhl', game, { injuries: report([], []), away: { id: '31', name: 'G Two', status: 'expected' } }, null);
  assert.deepEqual(inputChanges(was.hash, dropped), []);
  // (a new goalie, or the same one confirmed: a change)
  const swapped = inputsOf('nhl', game, { injuries: report([], []), home: { id: '32', name: 'G Three', status: 'expected' }, away: { id: '31', name: 'G Two', status: 'confirmed' } }, null);
  assert.deepEqual(
    inputChanges(was.hash, swapped, { game, names: swapped.names }).map((c) => c.words),
    ['HOM goalie (G Three)', 'AWY goalie (G Two confirmed)'],
  );
});

test('inputsOf: MLB lineups posted and a starter named are news; StatsAPI unread is not', () => {
  const was = inputsOf('mlb', game, { pk: 1, hp: '11', ap: null, lineups: null }, null);
  const posted = inputsOf('mlb', game, { pk: 1, hp: '11', ap: '12', names: [null, 'S Twelve'], lineups: [['1'], ['2']] }, null);
  assert.deepEqual(
    inputChanges(was.hash, posted, { game, names: posted.names }).map((c) => c.words),
    ['HOM lineup (posted)', 'AWY starting pitcher (S Twelve)', 'AWY lineup (posted)'],
  );
  const unread = inputsOf('mlb', game, {}, null, { statsapi: false });
  assert.deepEqual(inputChanges(posted.hash, unread), []);
  // (a bet from before the inputs were kept: nothing to compare)
  assert.deepEqual(inputChanges(undefined, posted), []);
  // (placed with StatsAPI unread, read now: the news it was priced without)
  assert.deepEqual(
    inputChanges(unread.hash, posted, { game, names: posted.names }).map((c) => c.key),
    ['sp:h', 'lu:h', 'sp:a', 'lu:a'],
  );
});

test('inputsOf: the NFL quarterback the context priced; nflverse unread is no change', () => {
  const live = { injuries: report([], []), row: {} };
  const was = inputsOf('nfl', game, live, { starters: { home: 'Q One', away: 'Q Two', backup: [0, 0] } });
  const backup = inputsOf('nfl', game, live, { starters: { home: null, away: 'Q Two', backup: [1.2, 0] } });
  assert.deepEqual(
    inputChanges(was.hash, backup, { game }).map((c) => c.words),
    ['HOM quarterback (a backup)'],
  );
  assert.deepEqual(inputChanges(was.hash, inputsOf('nfl', game, { injuries: report([], []) }, null)), []);
});

test('fitTrust: a bet placed under other timing (tw) weighs less', () => {
  const bets = (tw) =>
    Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, event: `e${i}`, market: 'spread', status: i % 3 ? 'won' : 'lost', model: 0.6, fair: 0.5, ...(tw ? { tw } : {}) }));
  const full = fitTrust(bets(null), 0.5);
  const half = fitTrust(bets(0.5), 0.5);
  assert.ok(full.fitted && half.fitted);
  // (the same results at half weight: the trust's cost counts for more, so it can't be higher)
  assert.ok(half.trust <= full.trust);
});

test('propAsk: first, owed only on an unpriced board, near once with props open or owed, never past the cap', () => {
  const h = 36e5;
  assert.equal(propAsk({ times: 0, max: 4, until: 20 * h }), 'first');
  assert.equal(propAsk({ times: 4, max: 4, owed: true, until: h }), null);
  // (the NFL's props taken back by --replace, asked once already: asked again, inside or outside 2.5 hours)
  assert.equal(propAsk({ times: 1, max: 4, owed: true, until: 20 * h }), 'owed');
  assert.equal(propAsk({ times: 1, max: 4, owed: true, until: h, nearAsked: true }), 'owed');
  // (a board with its own prices: owed props go on them; only the near ask, once)
  assert.equal(propAsk({ times: 1, max: 4, owed: true, boardPriced: true, until: 20 * h }), null);
  assert.equal(propAsk({ times: 1, max: 4, owed: true, boardPriced: true, until: h }), 'near');
  assert.equal(propAsk({ times: 1, max: 4, open: 2, until: h }), 'near');
  assert.equal(propAsk({ times: 2, max: 4, open: 2, until: h, nearAsked: true }), null);
  assert.equal(propAsk({ times: 1, max: 4, open: 0, until: h }), null);
});
