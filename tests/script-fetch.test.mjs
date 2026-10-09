// The data scripts' shared fetch (libs/ranker/scripts/fetch.mjs: a timeout on each try, retries, giving up)
// and their carry-forward of committed data when a source fails (libs/ranker/scripts/carry-forward.mjs,
// the NHL's game-log plan). A stub fetch stands in for the network: nothing is asked of anyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchRetry } from '../libs/ranker/scripts/fetch.mjs';
import { carryForward, previousRows, previousTab, sameSeason } from '../libs/ranker/scripts/carry-forward.mjs';
import { gameLogPlan } from '../apps/nhl/scripts/game-log-files.mjs';

const URL = 'https://example.test/data';
// (a stub fetch answering in turn from replies: a Response, an Error to throw, or 'hang' to wait until aborted)
function stub(...replies) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    if (reply === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(typeof reply === 'function' ? reply() : reply);
  };
  return { fetch, calls };
}
const ok = (body) => () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
const status = (code) => () => new Response('', { status: code });

test('fetchRetry: a body as text, JSON or bytes, the headers passed on', async () => {
  const { fetch, calls } = stub(ok('hello'));
  assert.equal(await fetchRetry(URL, { fetch, headers: { 'User-Agent': 'x' } }), 'hello');
  assert.equal(calls[0].init.headers['User-Agent'], 'x');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(await fetchRetry(URL, { as: 'json', fetch: stub(ok({ a: 1 })).fetch }), { a: 1 });
  const bytes = await fetchRetry(URL, { as: 'buffer', fetch: stub(ok('abc')).fetch });
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.toString(), 'abc');
});

test('fetchRetry: a failed try is tried again, after the backoff, with before() each time', async () => {
  const { fetch, calls } = stub(status(500), new TypeError('fetch failed'), ok('third time'));
  let paced = 0;
  const started = Date.now();
  const body = await fetchRetry(URL, { fetch, backoff: 20, before: () => paced++ });
  assert.equal(body, 'third time');
  assert.equal(calls.length, 3);
  assert.equal(paced, 3);
  // (20ms after the first, 40ms after the second)
  assert.ok(Date.now() - started >= 55, 'waited between tries');
});

test('fetchRetry: gives up after its attempts, throwing the last error with the URL', async () => {
  const { fetch, calls } = stub(status(503));
  await assert.rejects(fetchRetry(URL, { fetch, attempts: 3, backoff: 0 }), (err) => err.message.includes('503') && err.message.includes(URL));
  assert.equal(calls.length, 3);
  const dropped = stub(new TypeError('fetch failed'));
  await assert.rejects(fetchRetry(URL, { fetch: dropped.fetch, attempts: 2, backoff: 0 }), (err) => /fetch failed for https:\/\/example\.test\/data/.test(err.message));
  assert.equal(dropped.calls.length, 2);
});

test('fetchRetry: a try that hangs is cut off at the timeout, then tried again', async (t) => {
  // (AbortSignal.timeout's timer doesn't hold the process open, and a stub that hangs has no socket that
  // would: kept open here, or Node can finish before the timeout fires and cancel the file's tests)
  const awake = setInterval(() => {}, 1000);
  t.after(() => clearInterval(awake));
  const { fetch, calls } = stub('hang', ok('second'));
  const started = Date.now();
  assert.equal(await fetchRetry(URL, { fetch, timeout: 50, backoff: 0 }), 'second');
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started < 2000);
  // (every try hanging: gives up, saying it timed out)
  const hung = stub('hang');
  await assert.rejects(fetchRetry(URL, { fetch: hung.fetch, timeout: 30, attempts: 2, backoff: 0 }), (err) => /timeout|abort/i.test(err.message) && err.message.includes(URL));
  assert.equal(hung.calls.length, 2);
});

test('fetchRetry: a 404 is notFound when given (not tried again), a failure otherwise', async () => {
  const { fetch, calls } = stub(status(404));
  assert.equal(await fetchRetry(URL, { fetch, notFound: null }), null);
  assert.equal(calls.length, 1);
  await assert.rejects(fetchRetry(URL, { fetch: stub(status(404)).fetch, backoff: 0 }), /404/);
});

test('fetchRetry: a body that will not parse as JSON is a failed try', async () => {
  const { fetch, calls } = stub(ok('<html>busy</html>'), ok({ fine: true }));
  assert.deepEqual(await fetchRetry(URL, { as: 'json', fetch, backoff: 0 }), { fine: true });
  assert.equal(calls.length, 2);
});

test('fetchRetry: a 429 is waited out (Retry-After) when rateLimit allows, not counted as a try', async () => {
  const limited = () => new Response('', { status: 429, headers: { 'retry-after': '0.01' } });
  const { fetch, calls } = stub(limited, limited, ok('in'));
  assert.equal(await fetchRetry(URL, { fetch, attempts: 1, rateLimit: 2 }), 'in');
  assert.equal(calls.length, 3);
});

test('carryForward: the failed columns from the previous rows, by gsisId; nothing else touched', () => {
  const rows = {
    C: [
      { gsisId: 'H-1', games: 10, stats: { war: 1.5, xwoba: null } },
      { gsisId: 'H-2', games: 3, stats: { war: 0.1, xwoba: null } },
    ],
    SP: [{ gsisId: 'P-9', games: 5, stats: { era: 3.1, whiffPct: null } }],
  };
  const previous = [
    { gsisId: 'H-1', games: 9, stats: { war: 1.2, xwoba: 0.351 } },
    { gsisId: 'P-9', games: 5, stats: { era: 3.5, whiffPct: 27.4 } },
  ];
  const n = carryForward(rows, previous, { stats: ['xwoba', 'whiffPct'], keep: sameSeason });
  assert.equal(n, 2);
  assert.equal(rows.C[0].stats.xwoba, 0.351);
  // (this run's own figures stay)
  assert.equal(rows.C[0].stats.war, 1.5);
  assert.equal(rows.SP[0].stats.era, 3.1);
  assert.equal(rows.SP[0].stats.whiffPct, 27.4);
  // (no previous row: left as it was)
  assert.equal(rows.C[1].stats.xwoba, null);
});

test("carryForward: keep turns down a previous row (sameSeason: more games is last season's file)", () => {
  const rows = [{ gsisId: 'H-1', games: 4, stats: { xwoba: null } }];
  assert.equal(carryForward(rows, [{ gsisId: 'H-1', games: 150, stats: { xwoba: 0.4 } }], { stats: ['xwoba'], keep: sameSeason }), 0);
  assert.equal(rows[0].stats.xwoba, null);
});

test('carryForward: fields only where the previous row has them, and take() for the rest', () => {
  const rows = [
    { gsisId: 'a', id: null, games: 5, stats: {}, awards: ['as'] },
    { gsisId: 'b', id: 7, games: 5, stats: {}, awards: [] },
  ];
  const previous = [
    { gsisId: 'a', id: 101, games: 5, stats: {}, injured: true, injuryStatus: 'Out', awards: ['mvp', 'as'] },
    { gsisId: 'b', id: 7, games: 5, stats: {}, awards: ['gg'] },
  ];
  carryForward(rows, previous, { fields: ['injured', 'injuryStatus'] });
  assert.deepEqual([rows[0].injured, rows[0].injuryStatus], [true, 'Out']);
  assert.equal('injured' in rows[1], false);
  // (an award list that failed: its badges back, once)
  const failed = new Set(['mvp', 'as']);
  carryForward(rows, previous, {
    take: (row, prev) => {
      const add = prev.awards.filter((b) => failed.has(b) && !row.awards.includes(b));
      row.awards.push(...add);
      return add.length > 0;
    },
  });
  assert.deepEqual(rows[0].awards, ['as', 'mvp']);
  assert.deepEqual(rows[1].awards, []);
});

test('previousRows / previousTab: a data file read back, none when it is missing or broken', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-'));
  try {
    const file = path.join(dir, 'skill-players.json');
    fs.writeFileSync(file, JSON.stringify({ C: [{ gsisId: 'a' }], TM: [{ gsisId: 'TM-1' }] }));
    assert.deepEqual((await previousRows(file)).map((r) => r.gsisId), ['a', 'TM-1']);
    assert.deepEqual(await previousTab(file, 'TM'), [{ gsisId: 'TM-1' }]);
    assert.deepEqual(await previousTab(file, 'HC'), []);
    assert.deepEqual(await previousRows(path.join(dir, 'none.json')), []);
    fs.writeFileSync(file, '{ not json');
    assert.deepEqual(await previousRows(file), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("NHL game logs: playoffs from the games' own type, never the calendar", () => {
  const log = (n) => Array.from({ length: n }, (_, i) => [`g${i}`]);
  // (the offseason: 82 regular games and 6 playoff games logged, the reports agreeing: kept, playoffs and all)
  assert.deepEqual(gameLogPlan({ played: 82, known: log(88), knownPlayoffs: 6, postGames: 6 }), { keep: true, types: [3, 2] });
  // (the playoff reports failing, or answering short: the log's playoff games still count, nothing stripped)
  assert.equal(gameLogPlan({ played: 82, known: log(88), knownPlayoffs: 6, postGames: null }).keep, true);
  assert.equal(gameLogPlan({ played: 82, known: log(88), knownPlayoffs: 6, postGames: 0 }).keep, true);
  // (a new playoff game: asked again, both types)
  assert.deepEqual(gameLogPlan({ played: 82, known: log(88), knownPlayoffs: 6, postGames: 7 }), { keep: false, types: [3, 2] });
  // (no playoffs: the regular season's log alone, kept while it's whole)
  assert.deepEqual(gameLogPlan({ played: 40, known: log(40), knownPlayoffs: 0, postGames: 0 }), { keep: true, types: [2] });
  assert.deepEqual(gameLogPlan({ played: 41, known: log(40), knownPlayoffs: 0, postGames: 0 }), { keep: false, types: [2] });
  // (a first playoff game, none logged yet)
  assert.deepEqual(gameLogPlan({ played: 82, known: log(82), knownPlayoffs: 0, postGames: 1 }), { keep: false, types: [3, 2] });
  // (no log yet)
  assert.equal(gameLogPlan({ played: 5, known: undefined, postGames: 0 }).keep, false);
});
