// The bettor's settling and data guards (libs/ranker/scripts/model), their pure parts: a prop's count when the
// player played but isn't in his stat's table (0, not void) or can't be read yet (waits); an MLB game cut short
// (its run line and total void, its moneyline standing); a doubleheader's events matched one to one; the
// Eastern day across daylight saving; a pull for how a player played counting in full, an injury not. No
// network: the box scores here are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, statInFinal } from '../libs/ranker/scripts/model/props.mjs';
import { settle } from '../libs/ranker/scripts/model/desk.mjs';
import { gameOf, goaliesInOrder, shortOf } from '../libs/ranker/scripts/model/espn.mjs';
import { matchNearest } from '../libs/ranker/scripts/model/oddsapi.mjs';
import { etDay } from '../libs/ranker/scripts/model/sources.mjs';
import { eventsOf, propPostmortem, storyHurt } from '../libs/ranker/scripts/model/postmortem.mjs';
import { settlePlayBet } from '../libs/ranker/scripts/accounts/settle-lib.mjs';

const athlete = (id, stats, extra = {}) => ({ athlete: { id, displayName: `P${id}` }, stats, ...extra });
const NFL = {
  boxscore: {
    players: [
      {
        statistics: [
          { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], athletes: [athlete('1', ['22/31', '287', '9.3', '2', '1'])] },
          { name: 'rushing', labels: ['CAR', 'YDS'], athletes: [athlete('2', ['17', '84'])] },
          { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], athletes: [athlete('3', ['7', '112', '16', '1', '41', '9'])] },
          // (a receiver with no targets who returned a kick: he played)
          { name: 'kickReturns', labels: ['NO', 'YDS'], athletes: [athlete('4', ['1', '22'])] },
        ],
      },
    ],
  },
};
const prop = (athleteId, propType) => ({ athlete: athleteId, propType, player: `P${athleteId}` });

test('statInFinal: a player in the box score but not his stat table counts 0, not void', async () => {
  assert.equal(await statInFinal('nfl', prop('4', 'rec'), NFL, null), 0);
  assert.equal(await statInFinal('nfl', prop('4', 'recYds'), NFL, null), 0);
  assert.equal(await statInFinal('nfl', prop('2', 'rec'), NFL, null), 0);
  assert.equal(await statInFinal('nfl', prop('1', 'rushYds'), NFL, null), 0);
  assert.equal(await statInFinal('nfl', prop('2', 'rushRecYds'), NFL, null), 84);
  assert.equal(await statInFinal('nfl', prop('3', 'recYds'), NFL, null), 112);
});

test("statInFinal: an NFL player in no table goes by his snaps: 0 if he took one, void if not, waits till they're posted", async () => {
  assert.equal(await statInFinal('nfl', prop('9', 'rec'), NFL, null, { played: async () => true }), 0);
  assert.equal(await statInFinal('nfl', prop('9', 'rec'), NFL, null, { played: async () => false }), null);
  assert.equal(await statInFinal('nfl', prop('9', 'rec'), NFL, null, { played: async () => null }), undefined);
  assert.equal(await statInFinal('nfl', prop('9', 'rec'), NFL, null), undefined);
  assert.equal(await statInFinal('nfl', prop('9', 'rushRecYds'), NFL, null, { played: async () => true }), 0);
  assert.equal(await statInFinal('nfl', prop('9', 'rushRecYds'), NFL, null, { played: async () => null }), undefined);
});

test("statInFinal: other sports' players not in the box score didn't play; MLB total bases without its game waits", async () => {
  const nba = { boxscore: { players: [{ statistics: [{ labels: ['MIN', 'PTS'], athletes: [athlete('11', ['30', '20']), athlete('12', [], { didNotPlay: true })] }] }] } };
  assert.equal(await statInFinal('nba', prop('11', 'pts'), nba, null), 20);
  assert.equal(await statInFinal('nba', prop('12', 'pts'), nba, null), null);
  assert.equal(await statInFinal('nba', prop('13', 'pts'), nba, null), null);
  assert.equal(await statInFinal('mlb', prop('31', 'tb'), { boxscore: { players: [] } }, null), undefined);
});

test('nameKey: accents, punctuation and suffixes off', () => {
  assert.equal(nameKey('José Ramírez Jr.'), nameKey('Jose Ramirez'));
  assert.equal(nameKey('D.J. Moore'), nameKey('DJ Moore'));
  assert.notEqual(nameKey('Will Smith'), nameKey('Will Smyth'));
});

// (a scoreboard competitor with its innings)
const side = (where, score, innings) => ({ homeAway: where, score: String(score), team: { id: where === 'home' ? '1' : '2', abbreviation: where === 'home' ? 'NYY' : 'BOS' }, linescores: Array.from({ length: innings }, () => ({ value: 0 })) });
const event = (home, away, period = 9) => ({ id: '9', date: '2026-08-01T23:05Z', season: { year: 2026, type: 2 }, competitions: [{ competitors: [home, away], status: { period, type: { completed: true, name: 'STATUS_FINAL' } } }] });

test('shortOf: 9 innings, or 8 and a half with the home side ahead, is a full game; fewer is short', () => {
  assert.equal(shortOf(side('home', 2, 9), side('away', 7, 9)), null);
  assert.equal(shortOf(side('home', 4, 8), side('away', 3, 9)), null);
  assert.equal(shortOf(side('home', 3, 12), side('away', 2, 12)), null);
  assert.equal(shortOf(side('home', 3, 6), side('away', 2, 7)), 6.5);
  assert.equal(shortOf(side('home', 1, 7), side('away', 5, 7)), 7);
  // (called in the 9th with the away side ahead, the home side not having batted: short)
  assert.equal(shortOf(side('home', 1, 8), side('away', 5, 9)), 8.5);
  // (no line scores: ESPN's period)
  assert.equal(shortOf({}, {}, 6), 6);
  assert.equal(shortOf({}, {}, 9), null);
});

test("a shortened MLB game: its run line and total void, its moneyline standing (the bettor's and the settler's)", () => {
  const g = gameOf(event(side('home', 3, 6), side('away', 2, 7)), { innings: true });
  assert.equal(g.short, 6.5);
  assert.equal(gameOf(event(side('home', 3, 6), side('away', 2, 7))).short, undefined);
  assert.equal(gameOf(event(side('home', 2, 9), side('away', 7, 9)), { innings: true }).short, undefined);
  const bet = (market, side_, line) => ({ market, side: side_, line, odds: -110, units: 1 });
  for (const [market, s, line] of [['spread', 'home', -1.5], ['total', 'over', 4.5]]) {
    const r = settle(bet(market, s, line), g);
    assert.deepEqual([r.status, r.profit, r.void], ['push', 0, true], market);
    const play = settlePlayBet({ ...bet(market, s, line), stake: 10, start: g.date, placedAt: '2026-08-01T20:00Z', matchup: 'BOS @ NYY' }, g, { observations: [{ kind: 'bot', market, side: s, line, odds: -110 }] });
    assert.equal(play.status, 'void', market);
  }
  const ml = settle(bet('ml', 'home', null), g);
  assert.equal(ml.status, 'won');
  assert.ok(!ml.void);
});

test("matchNearest: a doubleheader's two games each get their own event, nearest start first", () => {
  const g1 = { id: 'g1', t: 0 };
  const g2 = { id: 'g2', t: 5 };
  const e1 = { id: 'e1', t: 0.1 };
  const e2 = { id: 'e2', t: 5.2 };
  const pairs = [];
  for (const g of [g1, g2]) for (const e of [e1, e2]) if (Math.abs(g.t - e.t) < 6) pairs.push([g, e, Math.abs(g.t - e.t)]);
  const m = matchNearest(pairs);
  assert.equal(m.get(g1), e1);
  assert.equal(m.get(g2), e2);
  // (one event, two games: the nearer game takes it, the other none)
  const one = matchNearest([[g1, e2, 5.2], [g2, e2, 0.2]]);
  assert.equal(one.get(g2), e2);
  assert.equal(one.has(g1), false);
});

test('etDay: the Eastern date, daylight saving and all', () => {
  // (11:30 pm EDT in October is 03:30 UTC the next day)
  assert.equal(etDay('2026-10-11T03:30:00Z'), '2026-10-10');
  // (11:30 pm EST in December is 04:30 UTC)
  assert.equal(etDay('2026-12-11T04:30:00Z'), '2026-12-10');
  // (12:30 am EDT: the UTC-5 rule called this the day before)
  assert.equal(etDay('2026-10-11T04:30:00Z'), '2026-10-11');
});

// (a hockey final: the home side's goalie pulled after ga goals; ESPN lists the reliever first)
const hockey = (ga, story = '') => ({
  header: { competitions: [{ competitors: [{ linescores: [{}, {}, {}] }] }] },
  article: { story },
  boxscore: {
    players: [
      {
        team: { id: '1' },
        statistics: [{ name: 'goalies', labels: ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%', 'ESSV', 'PPSV', 'SHSV', 'TOI'], athletes: [athlete('22', ['1', '12', '0', '0', '11', '.917', '0', '0', '0', '29:00']), athlete('21', [String(ga), '20', '0', '0', '15', '.750', '0', '0', '0', '30:00'])] }],
      },
    ],
  },
});
const game = { home: '1', away: '2', homeAbbr: 'BOS', awayAbbr: 'NYR', hs: 2, as: 5 };

test('eventsOf: a goalie pulled after 3 or more goals is noted, not a broken premise; with fewer, or hurt, it is', () => {
  const pulled = (body) => eventsOf('nhl', game, body, null).events.find((e) => e.kind === 'goalie');
  assert.equal(pulled(hockey(5)).severe, false);
  assert.equal(pulled(hockey(1)).severe, true);
  assert.equal(pulled(hockey(4, 'P21 left the game with an injury in the second period.')).severe, true);
});

test("goaliesInOrder: ESPN's list read backwards (the reliever listed first), the story deciding when it says", () => {
  const g = (name, ga, toi) => ({ athlete: { id: name, displayName: name }, stats: [String(ga), '0', '0', '0', '0', '0', '0', '0', '0', toi] });
  // (nhl-401891829, VAN: Lankinen pulled after 8 goals, Merilainen in relief, listed first)
  const van = [g('Leevi Merilainen', 1, '30:41'), g('Kevin Lankinen', 8, '28:23')];
  const story = 'Kevin Lankinen made 13 saves before getting pulled midway through the second period. Leevi Merilainen — claimed off waivers on Friday — stopped 10 of the 11 shots he faced in relief.';
  assert.deepEqual(goaliesInOrder(van, story).map((a) => a.athlete.id), ['Kevin Lankinen', 'Leevi Merilainen']);
  assert.deepEqual(goaliesInOrder(van, '').map((a) => a.athlete.id), ['Kevin Lankinen', 'Leevi Merilainen']);
  // (the story says otherwise: it decides)
  const flipped = [g('Kevin Lankinen', 8, '28:23'), g('Leevi Merilainen', 1, '30:41')];
  assert.deepEqual(goaliesInOrder(flipped, story).map((a) => a.athlete.id), ['Kevin Lankinen', 'Leevi Merilainen']);
  assert.deepEqual(goaliesInOrder([g('Sebastian Cossa', 3, '15:51'), g('Karel Vejmelka', 3, '43:49')].reverse(), 'Karel Vejmelka stopped 11 of 14 shots he faced before he was replaced by Sebastian Cossa , who made five saves.').map((a) => a.athlete.id), ['Karel Vejmelka', 'Sebastian Cossa']);
  assert.deepEqual(goaliesInOrder([g('Dylan Garand', 1, '29:45'), g('Igor Shesterkin', 1, '28:20')].reverse(), 'Garand made 11 saves after entering midway through the second to replace Shesterkin, who stopped 13 shots.').map((a) => a.athlete.id), ['Igor Shesterkin', 'Dylan Garand']);
  // (one goalie: as is)
  assert.equal(goaliesInOrder([g('Jeremy Swayman', 1, '60:00')]).length, 1);
});

test('eventsOf: the pulled goalie named is the starter, not the reliever ESPN lists first', () => {
  const e = eventsOf('nhl', game, hockey(8), null).events.find((x) => x.kind === 'goalie');
  assert.match(e.text, /^P21 pulled \(8 goals/);
  assert.equal(e.severe, false);
});

test('propPostmortem: a skater with cut ice time (a benching) is noted; under a third of his usual, or hurt, breaks it', () => {
  const skater = (toi, story = '') => ({
    header: { competitions: [{ competitors: [{ linescores: [{}, {}, {}] }] }] },
    article: { story },
    boxscore: { players: [{ team: { id: '1' }, statistics: [{ name: 'forwards', labels: ['G', 'A', 'S', 'TOI'], athletes: [athlete('7', ['0', '0', '1', toi])] }] }] },
  });
  const rows = [1, 2, 3, 4].map((d) => ({ pid: '7', name: 'P7', season: 2027, date: `2026-10-0${d}`, s: { toi: 18 } }));
  const bet = { athlete: '7', player: 'Joe Skater', propType: 'sog', status: 'lost', actual: 1, statLabel: 'shots', line: 2.5, projection: { mean: 2.8 } };
  const g = { ...game, season: 2027, date: '2026-10-09' };
  const pm = (toi, story) => propPostmortem('nhl', bet, g, skater(toi, story), rows, 0.3);
  assert.equal(pm('9:00').weight, 1);
  assert.equal(pm('9:00').disrupted.find((e) => e.kind === 'early').severe, false);
  assert.equal(pm('4:00').weight, 0.3);
  assert.equal(pm('9:00', 'Skater left the game with an injury in the second.').weight, 0.3);
});

test('storyHurt: a sentence naming him by his last name that says he was hurt or thrown out', () => {
  const recap = { sentences: ['Connor McDavid left the game with a lower-body injury.', 'The coach was ejected in the third.'] };
  assert.equal(storyHurt(recap, 'Connor McDavid'), true);
  assert.equal(storyHurt(recap, 'Leon Draisaitl'), false);
  assert.equal(storyHurt({ sentences: ['Smith sat out with an injury and did not play.'] }, 'John Smith'), false);
});
