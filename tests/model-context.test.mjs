// The props' context terms (several a stat, each its own size; an old state's single c still read), the game
// script for a goalie's saves (the other side's expected shots), the weather's rain and snow, and the NFL's
// schedule facts (libs/ranker/scripts/model/project.mjs, props.mjs, sources.mjs, football.mjs, context.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFactor, ctxKeys, makeModel } from '../libs/ranker/scripts/model/project.mjs';
import { CTX, STATS, ctxValues, scriptValue } from '../libs/ranker/scripts/model/props.mjs';
import { gameWindow } from '../libs/ranker/scripts/model/sources.mjs';
import { fieldKind, hourAt } from '../libs/ranker/scripts/model/football.mjs';
import { weatherOf } from '../libs/ranker/scripts/model/context.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('ctxKeys: one name or a list', () => {
  assert.deepEqual(ctxKeys({ ctx: 'wind' }), ['wind']);
  assert.deepEqual(ctxKeys({ ctx: ['wind', 'cold'] }), ['wind', 'cold']);
  assert.deepEqual(ctxKeys({}), []);
  assert.deepEqual(ctxKeys(STATS.nfl.find((s) => s.key === 'recYds')), ['backupQb', 'wind', 'precip']);
});

test("ctxFactor: each term its own size; an old state's single c is the first term's; unknown values no effect", () => {
  const st = { ctx: ['wind', 'precip'] };
  close(ctxFactor(st, { c_wind: -0.15, c_precip: -0.07 }, [2, 3]), Math.exp(-0.3 - 0.21));
  close(ctxFactor(st, { c: -0.15 }, [2, 3]), Math.exp(-0.3));
  close(ctxFactor(st, { c_wind: -0.15, c_precip: 0 }, [2, 3]), Math.exp(-0.3));
  close(ctxFactor(st, { c_wind: -0.15 }, [NaN, 3]), 1);
  close(ctxFactor(st, {}, null), 1);
});

test('ctxValues: weather outdoors only, backups and teammates by side, the blowout either way', () => {
  const info = { weather: { wind: 25, temp: 30, precip: 0.8 }, starters: { backup: [0, 1.5], missing: [20, 0] }, b2b: [1, 0] };
  assert.deepEqual(ctxValues(['wind', 'cold', 'precip'], info, true, null), [1.5, 2, 5]);
  assert.deepEqual(ctxValues(['backupQb', 'usage', 'b2b'], info, false, null), [1.5, 0, 0]);
  assert.deepEqual(ctxValues(['backupQb', 'usage', 'b2b'], info, true, null), [0, 2, 1]);
  // (a dome: no weather in the info, no effect)
  assert.deepEqual(ctxValues(['wind', 'cold', 'precip'], { weather: { roof: 'dome' } }, true, null), [0, 0, 0]);
  close(CTX.blowout(null, true, [120, 104]), 1.6);
  close(CTX.blowout(null, false, [104, 120]), 1.6);
  assert.equal(CTX.blowout(null, true, null), 0);
});

test("scriptValue: a side's expected points over the average; a goalie's saves also by the other side's expected shots (a log, its size a power)", () => {
  const env = { avg: 110 };
  close(scriptValue({}, env, null, [121, 99], true), 1.1);
  close(scriptValue({ script: 'opp' }, env, null, [121, 99], true), 0.9);
  close(scriptValue({ script: 'opp' }, env, null, [121, 99], false), 1.1);

  close(CTX.oppShots({ more: { shots: [33, 27], shotsAvg: 30 } }, true), Math.log(0.9));
  close(CTX.oppShots({ more: { shots: [33, 27], shotsAvg: 30 } }, false), Math.log(1.1));
  assert.equal(CTX.oppShots({}, true), 0);
});

test('makeModel: the projection carries every context term at its size', () => {
  const st = { key: 'v', ctx: ['wind', 'precip'] };
  const env = { ctx: (row) => row.cv, script: () => 1, mean: 10 };
  const params = { K: 4, w: 0, a: 0, b: 0, c_wind: -0.1, c_precip: -0.2 };
  const m = makeModel(st, params, env);
  const row = (game, v, cv) => ({ pid: '1', pos: 'WR', date: `2025-09-0${game}T17:00Z`, season: 2025, team: 'a', opp: 'b', game: String(game), home: true, s: { v }, cv });
  m.learn([row(1, 10, [0, 0])]);
  m.learn([row(2, 10, [0, 0])]);
  const calm = m.project(row(3, 0, [0, 0]));
  const wet = m.project(row(3, 0, [1, 2]));
  close(wet.mu / calm.mu, Math.exp(-0.1 - 0.4));
  close(wet.ctxF, Math.exp(-0.5));
});

test("gameWindow: the four hours from kickoff's, rain and snow summed; a gap there, null", () => {
  const h = { precipitation: [0, 0.1, 0.2, 0, 0.05, 1], snowfall: [0, 0, 0.5, 0.5, 0, 0] };
  assert.deepEqual(gameWindow(h, 1), { precip: 0.35, snow: 1 });
  assert.equal(gameWindow(h, 4), null);
  assert.equal(gameWindow({ precipitation: [0, null, 0, 0], snowfall: [] }, 0), null);
});

test("weatherOf: StatsAPI's report with whether it's raining (not under a roof)", () => {
  assert.deepEqual(weatherOf({ temp: '61', condition: 'Rain', wind: '8 mph, Out To CF' }), [61, 8, 0, 1]);
  assert.deepEqual(weatherOf({ temp: '72', condition: 'Partly Cloudy', wind: '5 mph, In From LF' }), [72, -3.5, 0, 0]);
  assert.deepEqual(weatherOf({ temp: '72', condition: 'Roof Closed', wind: '0 mph, None' }), [72, 0, 1, 0]);
  assert.equal(weatherOf({ temp: '' }), null);
});

test("hourAt and fieldKind: a team's own clock at kickoff (Arizona keeps standard time); grass or turf", () => {
  // (1 p.m. Eastern on a September Sunday: 10 a.m. in Seattle and Arizona, 11 in Denver, noon in Chicago)
  const t = '2025-09-14T17:00Z';
  assert.equal(hourAt('NE', t), 13);
  assert.equal(hourAt('SEA', t), 10);
  assert.equal(hourAt('ARI', t), 10);
  assert.equal(hourAt('DEN', t), 11);
  assert.equal(hourAt('CHI', t), 12);
  // (after the clocks go back, Arizona is two hours behind Eastern)
  assert.equal(hourAt('ARI', '2025-12-07T18:00Z'), 11);
  assert.equal(fieldKind('grass '), 'grass');
  assert.equal(fieldKind('dessograss'), 'grass');
  assert.equal(fieldKind('fieldturf'), 'turf');
  assert.equal(fieldKind(''), null);
});

test('WEATHER.nfl: rain only once the archive has filled the history, a forecast at half, a retractable roof unknown', async () => {
  const { WEATHER, FORECAST_WET } = await import('../libs/ranker/scripts/model/context.mjs');
  const rows = new Map([
    ['f1', { roof: 'outdoors', temp: '40', wind: '15', stadium_id: 'A' }],
    ['f2', { roof: 'outdoors', temp: '60', wind: '5', stadium_id: 'A' }],
    ['c1', { roof: 'outdoors', temp: '', wind: '', stadium_id: 'A' }],
    ['o1', { roof: 'open', temp: '70', wind: '0', stadium_id: 'R' }],
    ['c2', { roof: '', temp: '', wind: '', stadium_id: 'R' }],
  ]);
  const live = new Map([
    ['c1', { weather: { temp: 35, wind: 20, precip: 0.4, snow: 0 } }],
    ['c2', {}],
  ]);
  const facts = (share) => ({ nfl: rows, wx: { f1: [0.3, 0] }, wxCover: { share, of: 100 } });
  // (filled: a final's rain as it fell, one not filled unknown (no effect), a coming game's at half)
  let w = WEATHER.nfl(facts(0.97), live);
  assert.equal(w({ id: 'f1', final: true }).terms.precip, 3);
  assert.equal(w({ id: 'f2', final: true }).terms.precip, 0);
  assert.equal(w({ id: 'f2', final: true }).info.precip, null);
  const c = w({ id: 'c1', final: false });
  assert.equal(c.info.precip, 0.4 * FORECAST_WET);
  assert.equal(c.info.precipForecast, 0.4);
  assert.equal(c.terms.precip, 0.4 * FORECAST_WET * 10);
  // (not filled yet: no rain anywhere, the wind and cold as before)
  w = WEATHER.nfl(facts(0.5), live);
  assert.equal(w({ id: 'f1', final: true }).terms.precip, 0);
  assert.equal(w({ id: 'c1', final: false }).terms.precip, 0);
  assert.equal(w({ id: 'c1', final: false }).info.rainUnfit, true);
  assert.equal(w({ id: 'f1', final: true }).terms.wind, 1);
  // (a coming game under a retractable roof that's been open: unknown, marked missing, no game flag)
  assert.deepEqual(w({ id: 'c2', final: false }), { info: { roof: 'retractable', missing: true } });
});
