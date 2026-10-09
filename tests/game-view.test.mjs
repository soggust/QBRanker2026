// The game view read from ESPN's summary (tests/support/card-entry.ts, its fetch stubbed): a tie and how
// the line came out, two teams in the same color told apart, a game to come with nothing played, a summary
// missing its parts; and the logos and colors it draws (the Rams' own logo, a dark color lifted to read).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';

const ENTRY = path.join(import.meta.dirname, 'support', 'card-entry.ts');
let nfl;
const realFetch = globalThis.fetch;
before(async () => {
  nfl = await loadEngine('nfl', { entry: ENTRY, data: {} });
});
after(() => {
  globalThis.fetch = realFetch;
});

// (ESPN's summary for the next loadGame, or a failed request)
function serve(summary, status = 200) {
  globalThis.fetch = async () => ({ ok: status === 200, status, json: async () => summary });
}

const team = (homeAway, abbreviation, color, extra = {}) => ({
  homeAway,
  team: { id: abbreviation, abbreviation, displayName: `${abbreviation} Team`, color, logos: [{ href: `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png` }], ...extra.team },
  ...extra,
});

test("a tie: no winner, the line's underdog covered and the total under; overtime named", async () => {
  serve({
    header: {
      week: 6,
      competitions: [
        {
          date: '2026-10-18T17:00Z',
          status: { type: { detail: 'Final/OT', completed: true, state: 'post' } },
          competitors: [
            team('away', 'KC', 'e31837', { score: '20', linescores: [7, 3, 7, 3, 0].map((n) => ({ displayValue: String(n) })) }),
            team('home', 'BUF', '00338d', { score: '20', linescores: [0, 10, 3, 7, 0].map((n) => ({ displayValue: String(n) })) }),
          ],
        },
      ],
    },
    pickcenter: [{ provider: { name: 'DraftKings' }, details: 'KC -3', overUnder: 40.5 }],
  });
  const g = await nfl.loadGame('football/nfl', '1');
  assert.equal(g.away.winner, false);
  assert.equal(g.home.winner, false);
  assert.deepEqual(g.periodLabels, ['1', '2', '3', '4', 'OT']);
  assert.equal(g.label, 'Week 6');
  assert.equal(g.line.spread, 'BUF covered', 'the favorite by 3 tied: the underdog covered');
  assert.equal(g.line.total, 'Under');
  assert.equal(g.preview, false);
  // (nothing else in the summary: empty, not broken)
  assert.deepEqual([g.plays, g.box, g.leaders, g.teamStats, g.fantasy, g.injuries, g.form, g.videos], [[], [], [], [], [], [], [], []]);
  assert.equal(g.chart, null);
  assert.equal(g.venue, null);
  assert.equal(g.winProbability, null);
});

test('two teams in the same color: the home side takes its alternate, the away side keeps its own', async () => {
  serve({
    header: {
      competitions: [
        {
          status: { type: { completed: true } },
          competitors: [team('away', 'CAR', 'c8102e', { score: '3' }), team('home', 'FLA', 'c8102e', { score: '2', team: { alternateColor: 'b9975b' } })],
        },
      ],
    },
  });
  const g = await nfl.loadGame('hockey/nhl', '2');
  assert.equal(g.away.color, '#c8102e');
  assert.ok(nfl.distance(g.away.color, g.home.color) >= nfl.TOO_CLOSE, `${g.away.color} and ${g.home.color} look alike`);
  assert.equal(g.home.color, '#b9975b');
  assert.deepEqual(g.periodLabels, []);
});

test('a game to come: its preview, the line without a result, no score', async () => {
  serve({
    header: {
      competitions: [
        {
          date: '2026-10-25T20:25Z',
          status: { type: { detail: 'Sun, October 25th at 4:25 PM EDT', completed: false, state: 'pre' } },
          competitors: [team('away', 'LAR', '003594'), team('home', 'SF', 'aa0000')],
        },
      ],
    },
    pickcenter: [{ details: 'SF -2.5', overUnder: 47.5 }],
    predictor: { homeTeam: { id: 'SF', gameProjection: '55.1' }, awayTeam: { id: 'LAR', gameProjection: '44.9' } },
  });
  const g = await nfl.loadGame('football/nfl', '3');
  assert.equal(g.preview, true);
  assert.equal(g.away.score, '');
  assert.deepEqual(g.line, { book: null, details: 'SF -2.5', overUnder: 47.5, spread: null, total: null });
  assert.deepEqual(g.predictor, { away: 0.449, home: 0.551 });
  // (the Rams' logo: the app's own yellow one, their blue LA vanishing on their blue)
  assert.equal(g.away.logo, 'assets/NFL_Icons/hd/Rams.png');
});

test("a summary without its teams, or ESPN's request failing: an error (the view says it couldn't be found)", async () => {
  serve({ header: { competitions: [{}] } });
  await assert.rejects(nfl.loadGame('football/nfl', '4'), /no teams/);
  serve({}, 404);
  await assert.rejects(nfl.loadGame('football/nfl', '5'), /404/);
});

test("logos: the Rams' ESPN logos swapped for the app's own, everyone else's kept", () => {
  const { ownLogo } = nfl;
  for (const href of ['https://a.espncdn.com/i/teamlogos/nfl/500/lar.png', 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/lar.png', 'https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/lar.png']) {
    assert.equal(ownLogo(href), 'assets/NFL_Icons/hd/Rams.png', href);
  }
  assert.equal(ownLogo('https://a.espncdn.com/i/teamlogos/nfl/500/lac.png'), 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png');
  assert.equal(ownLogo('https://a.espncdn.com/i/teamlogos/nhl/500/la.png'), 'https://a.espncdn.com/i/teamlogos/nhl/500/la.png');
  assert.equal(ownLogo(undefined), null);
  assert.equal(ownLogo(''), null);
});

test("team colors on the dark board: a bright one kept, a dark one lifted, a black swapped for its alternate's color", () => {
  const { teamColor } = nfl;
  const light = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  assert.equal(teamColor('e31837', undefined), '#e31837');
  assert.equal(teamColor('#E31837', undefined), '#e31837', 'with its # and in capitals');
  // (the Ravens' purple: lightened until it reads, still a purple)
  const ravens = teamColor('241773', undefined);
  assert.ok(light(ravens) >= 0.2, ravens);
  const [r, g, b] = ravens.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16));
  assert.ok(b > r && r > g, `${ravens} is no longer purple`);
  // (the Bruins' black: their gold)
  assert.equal(teamColor('000000', 'ffb81c'), '#ffb81c');
  // (a black with a grey alternate: the black lifted)
  assert.ok(light(teamColor('000000', '333333')) >= 0.2);
  // (no colors at all, or ESPN's junk: a grey)
  assert.equal(teamColor(undefined, undefined), '#8a8f8c');
  assert.equal(teamColor('nope', undefined), '#8a8f8c');
});
