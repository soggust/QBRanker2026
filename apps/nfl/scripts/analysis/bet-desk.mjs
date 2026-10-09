// The bet desk: one pass over every bet the week's reports suggested (data/analysis/bets.json), with each
// game's fresh line, injury report and kickoff forecast. Claude merges the same call from different
// reports, rejects the weak or contradicted ones (saying why), and writes the week's sheet: the best
// ideas, each with its case, what would make it wrong, and how strong it is. The Bets page shows the
// sheet (data/analysis/bet-sheet.json) and falls back to the reports' own ranking without one.
//
//   node apps/nfl/scripts/analysis/bet-desk.mjs            (a live call; after the reports, and again
//                                                          before the games for fresh lines and weather)
//   node apps/nfl/scripts/analysis/bet-desk.mjs --dry-run  (no call: prints what it would send, and its size)
//
// Every run is kept in .cache/analysis/desk/ with its rejections, token usage and cost.
// Needs ANTHROPIC_API_KEY (not for --dry-run).

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { espnInjuries, espnLines, kickoffForecast, kickoffIso, venue } from './live.mjs';
import { readLedger, seasonOf, writeLedger } from './ledger.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SITE = path.join(ROOT, 'apps/nfl/src/StaticData/analysis');
const TEAMS = path.join(ROOT, '.cache/analysis/teams');
const LOG = path.join(ROOT, '.cache/analysis/desk');
const MODEL = 'claude-opus-5-5';
const EFFORT = process.env.EFFORT ?? 'high';
// $ per million tokens (Opus 5.5)
const PRICE = { input: 4, output: 20 };

const SYSTEM = `You run the bet desk for a football rankings site. Every week the site's analysts write a report on each team and each starting quarterback, and each report suggests up to five betting angles for its coming game. You get all of those suggestions at once, grouped by game, with each game's current line, injury report and kickoff forecast. Your job is the editor's: decide which ideas really hold up, and write the week's bet sheet.

The reader is an independent bettor who will decide for themselves whether to act. They don't want hype or a promise of winning; they want a full menu of ideas, each with reasoning strong enough to weigh, honestly rated, and honesty about what could go wrong.

What you get, per game: the matchup, kickoff, venue, the current line (line names the favorite and the spread; overUnder; moneylines) and the line when the reports were written if it has moved, each team's season profile ([value, rank of 32], 1 = best; for "allowed" stats rank 1 is the fewest; defenseVsPosition is its defense by role: pprOverAvg.WR1 / WR2 / WR3 / TE1 / RB1 = PPR points a game those players scored against it over their own averages, 1 = held furthest under; epaPerPlay.WR1 etc. = EPA a play allowed to that role, 1 = the stingiest; passRateOverNorm = points more often offenses pass on it than usual for the situation (pass rate over expected), negative a run funnel, 1 = the strongest pass funnel; targetShare = [share of the targets to WRs / TEs / RBs against it, the league's]; context to weigh, not a verdict: few games early in a season), the injury report's regulars (snapPct is this season's share of snaps; "new" means reported since the analysts wrote), the kickoff forecast, and the candidates: each suggestion's id, the report it came from, its market, the bet (lean), like (backing the side named) or fade (going against the side named; the lean is the bet to make), the analyst's 1-10 score, and the analyst's reason.

How to edit:
- Merge: when several reports make the same call (the Raiders' report and the Patriots' report both on "LV +3.5"), it is one pick with all of their candidate ids. Agreement from both sides of a game is worth noting; it isn't proof.
- Judge the logic, not the confidence. A pick needs a real mechanism in the numbers: a matchup edge (a strong run game into a defense that can't stop the run), a mispriced line (the market leaning on a record the efficiency doesn't support), a situation (rest, travel, injuries that change a unit). Reject reasons that are only a streak, a record, a narrative, or a stat that doesn't bear on the bet.
- Check every pick against the rest of the game: contradictions between reports (one says the Bears run all day, another bets the Bears' passing over), the line having moved past the number the reasoning needed, injuries reported since (a key player now out, or a questionable star whose status decides the bet), and the weather.
- Weather: only for outdoor games (a retractable roof is likely closed in bad weather). Sustained wind of 15+ mph or gusts of 25+ hurt passing, the deep game and kicking, and lean totals and passing numbers down; heavy rain or snow (a high precipChance with real precipIn) hurts passing and ball security somewhat; cold alone matters little. early: true means the forecast is more than 3 days out and rough: mention a big system, hedged, but don't build a pick on it. A pick that bad weather undercuts (an over, a passing over) must answer it or be rejected. A pick weather supports can say so.
- Player bets are framed against the player's own average ("over his 250-a-game average"): the site has no prop lines. Keep that framing honest; don't invent a line.
- No new bets: every pick is one or more candidates. You can restate a candidate's bet more cleanly, but not change it.
- Keep every idea with a real case, up to 50 picks (aim for 35-50 in a full week): the reader wants the whole menu, rated, not just the best few. Thin but reasonable ideas stay with a low strength; that's what the low end is for. Reject only what doesn't hold up at all: the line has moved past the number the reasoning needed, an injury or another report undercuts it, it contradicts a stronger pick, or its reason is only a streak or a narrative. Group rejections that fail for the same reason, each with one specific line of under 15 words; your rejections teach the analysts what doesn't hold up, so be specific.

Each pick:
- bet: the wager in a few words, as a bettor would say it ("LV +3.5", "Under 42.5", "MIA team total under 17.5", "Jackson under his 36-a-game rushing average").
- label: the market, short ("Spread", "Game total", "Moneyline", "Team total", "Jackson rushing yards").
- side: like, or fade (going against what the market or the obvious read favors); for a fade, fades names the side it goes against ("BUF -3.5"), otherwise fades is "".
- strength: 1-10, how convincing the case is and how likely it is to win: 8-9 when the matchup, the number, the injuries and the weather all point the same way; 7 a strong case with a real risk; 5-6 a modest edge; 3-4 a reasonable idea with a thin edge or a serious counter-case. The site shows 7+ as High, 5-6 as Medium and below 5 as Low confidence. Use the whole range; don't park everything at 7.
- case: 2-4 sentences, the argument a sharp friend would make, built on specific numbers from the candidates' reasons and the game's data. Use no numbers that aren't there or directly derivable from them.
- risk: 1-2 sentences, the most likely way it loses.
- grade: what settles it after the game, from the bettor's side (the bet you wrote, not what a fade goes against): "LV +3.5" is spread, team LV, line 3.5; "Under 42.5" is total, under, 42.5; "MIA team total under 17.75" is team_total, MIA, under, 17.75; "Love under his 260-a-game passing average" is player, Jordan Love, GB, passing_yards, under, 260; "Ravens under their 153.5 rushing average" is team_stat, BAL, rushing_yards, under, 153.5.

trackRecord, when there is one: how your earlier sheets' picks did, graded after their games, by confidence level and by kind of bet. Use it to calibrate: if a level wins less often than its label claims, rate more conservatively; if a kind of bet keeps losing, hold it to a higher bar, and if one keeps winning, trust that reasoning a little more. Samples are small and football is noisy: below about 30 graded picks in a group, it's a nudge, not a rule.

summary: 2-3 sentences on the slate: its themes, and anything that shapes several picks (a weather system, a wave of injuries, a market overreacting to records).`;

// How a pick is graded after its game (grade.mjs): what it bets on, from the bettor's side
const STATS = [
  'passing_yards', 'passing_tds', 'passing_interceptions', 'completions', 'attempts', 'sacks_suffered',
  'rushing_yards', 'carries', 'rushing_tds', 'receptions', 'targets', 'receiving_yards', 'receiving_tds',
  'def_sacks', 'def_interceptions',
];
const GRADE = {
  type: 'object',
  description:
    'what settles the bet, from the bettor\'s side: spread (team + its line, e.g. LV and 3.5, or BUF and -3.5), moneyline (team), total (direction + line), team_total (team + direction + line), player (player + team + stat + direction + line: for a bet against his average, the average), team_stat (team + stat + direction + line). Fields that don\'t apply are null.',
  properties: {
    kind: { type: 'string', enum: ['spread', 'moneyline', 'total', 'team_total', 'player', 'team_stat'] },
    team: { type: ['string', 'null'], description: 'the team the bet is on (its abbreviation, as in the matchup)' },
    player: { type: ['string', 'null'], description: 'the player\'s full name, as in the candidates' },
    stat: { type: ['string', 'null'], enum: [...STATS, null] },
    direction: { type: ['string', 'null'], enum: ['over', 'under', null] },
    line: { type: ['number', 'null'] },
  },
  required: ['kind', 'team', 'player', 'stat', 'direction', 'line'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidates: { type: 'array', items: { type: 'integer' }, description: 'the ids of the candidates this pick is' },
          bet: { type: 'string' },
          label: { type: 'string' },
          side: { type: 'string', enum: ['like', 'fade'] },
          fades: { type: 'string' },
          strength: { type: 'integer' },
          case: { type: 'string' },
          risk: { type: 'string' },
          grade: GRADE,
        },
        required: ['candidates', 'bet', 'label', 'side', 'fades', 'strength', 'case', 'risk', 'grade'],
        additionalProperties: false,
      },
    },
    rejected: {
      type: 'array',
      items: {
        type: 'object',
        properties: { candidates: { type: 'array', items: { type: 'integer' } }, why: { type: 'string', description: 'one line, under 15 words' } },
        required: ['candidates', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'picks', 'rejected'],
  additionalProperties: false,
};

// ---- the week's candidates: the latest run's bets (reports written within 6 hours of its newest), the
// coming week's games only (as the Bets page reads them)
function candidates() {
  const file = JSON.parse(readFileSync(path.join(SITE, 'bets.json'), 'utf8'));
  const newest = Math.max(...file.bets.map((b) => Date.parse(b.at)));
  const latest = file.bets.filter((b) => newest - Date.parse(b.at) < 6 * 3600e3 && b.game);
  const week = Math.min(...latest.map((b) => b.game.week));
  return { reportsAt: file.at, week, bets: latest.filter((b) => b.game.week === week).map((b, id) => ({ ...b, id })) };
}

// ---- the schedule's facts for a game: its stadium, roof and kickoff
function schedule() {
  const [head, ...rows] = readFileSync(path.join(ROOT, '.cache/nflverse/games.csv'), 'utf8').trim().split('\n');
  const col = Object.fromEntries(head.split(',').map((name, i) => [name.trim(), i]));
  const games = new Map();
  for (const row of rows) {
    const f = row.split(',').map((x) => x.replace(/^"|"$/g, ''));
    games.set(`${f[col.gameday]} ${f[col.away_team]}@${f[col.home_team]}`, {
      stadiumId: f[col.stadium_id],
      stadium: f[col.stadium],
      roof: f[col.roof],
      kickoff: kickoffIso(f[col.gameday], f[col.gametime]),
    });
  }
  return games;
}

// A team's season profile, from its Tuesday dossier: the numbers that bear on a bet
const PROFILE = {
  team: ['pointDiffPerGame', 'netEpa', 'offEpa', 'defEpaAllowed', 'atsPct', 'turnoverDiffPerGame', 'oneScoreWinPct'],
  playByPlay: ['offPassEpa', 'offRushEpa', 'passRateOverExp', 'defPassEpa', 'defRushEpa'],
  defense: ['pressureRate', 'qbHitRate'],
};
function profile(dossier) {
  const out = { record: dossier.team.record };
  for (const [part, keys] of Object.entries(PROFILE)) for (const k of keys) if (dossier.season?.[part]?.[k]) out[k] = dossier.season[part][k];
  // (its defense by role, the funnel and where the targets go: dossier.mjs, from the site's DEF rows)
  if (dossier.season?.defenseVsPosition) out.defenseVsPosition = dossier.season.defenseVsPosition;
  return out;
}

// A team's regulars on the injury report: the Tuesday report's (with snap shares), each status as of
// now, and anyone ruled out or doubtful since ("new")
const REGULAR = 40;
function injuries(dossier, fresh) {
  const now = new Map((fresh ?? []).map((i) => [i.name, i]));
  const known = new Set();
  const list = [];
  for (const i of dossier.injuries ?? []) {
    known.add(i.name);
    if ((i.snapPct ?? 0) < REGULAR) continue;
    const today = now.get(i.name);
    // (off today's report: back to full go)
    list.push({ name: i.name, pos: i.pos, snapPct: i.snapPct, status: today ? today.status : 'Active (off the report)', injury: today?.injury ?? i.injury, news: today?.news ?? i.news });
  }
  for (const i of fresh ?? []) {
    if (known.has(i.name) || !/^(out|doubtful|injured reserve)/i.test(i.status)) continue;
    list.push({ name: i.name, pos: i.pos, status: i.status, injury: i.injury, news: i.news, new: true });
  }
  return list;
}

async function main() {
  const { reportsAt, week, bets } = candidates();
  if (!bets.length) {
    console.log('no bets to edit');
    return;
  }
  const facts = schedule();
  const dates = [...new Set(bets.map((b) => b.game.date))].sort();
  const [lines, report] = await Promise.all([espnLines(dates), espnInjuries().catch(() => null)]);

  // ---- each game: its facts now, and its candidates
  const byGame = new Map();
  for (const b of bets) {
    if (!byGame.has(b.game.matchup)) byGame.set(b.game.matchup, { game: b.game, candidates: [] });
    byGame.get(b.game.matchup).candidates.push(b);
  }
  const games = [];
  const site = {};
  for (const [matchup, { game, candidates: list }] of byGame) {
    const [away, home] = matchup.split(' @ ');
    const fact = facts.get(`${game.date} ${away}@${home}`) ?? {};
    // (a game that's kicked off is settled: its picks stay as they were locked in the ledger)
    if (fact.kickoff && Date.parse(fact.kickoff) <= Date.now()) continue;
    const forecast = await kickoffForecast(fact);
    const now = lines.get(`${away}@${home}`);
    const line = now ? { line: now.line, overUnder: now.overUnder, awayMoneyline: now.awayMoneyline, homeMoneyline: now.homeMoneyline } : game.line;
    const moved = now && game.line && (now.line !== game.line.line || now.overUnder !== game.line.overUnder) ? { line: game.line.line, overUnder: game.line.overUnder } : undefined;
    const team = (abbr) => {
      const file = path.join(TEAMS, `${abbr}.json`);
      if (!existsSync(file)) return { abbr };
      const d = JSON.parse(readFileSync(file, 'utf8'));
      return { abbr, ...profile(d), injuries: injuries(d, report?.get(abbr)) };
    };
    const where = venue(fact);
    games.push({
      matchup,
      kickoff: fact.kickoff ?? game.date,
      venue: [where.stadium, where.city].filter(Boolean).join(', ') || undefined,
      line,
      lineWhenWritten: moved,
      forecast: forecast ?? 'unavailable',
      away: team(away),
      home: team(home),
      candidates: list.map((b) => ({ id: b.id, from: `${b.source}${b.kind === 'team' ? ' (team report)' : ` (${b.position ?? 'player'} report)`}`, market: b.market, lean: b.lean, side: b.strength === 'fade' ? 'fade' : 'like', score: b.score ?? null, reason: b.reason })),
    });
    // (what the page shows under each matchup: where, and the weather)
    site[matchup] = { kickoff: fact.kickoff ?? null, city: where.city, stadium: where.stadium, line, weather: forecast };
  }
  if (!games.length) {
    console.log('every game this week has kicked off');
    return;
  }
  games.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  // (how the earlier sheets' picks did, once any are graded: grade.mjs)
  const ledger = readLedger();
  const trackRecord = ledger.record?.graded ? ledger.record : undefined;
  const input = JSON.stringify({ week, trackRecord, games });
  const count = games.reduce((n, g) => n + g.candidates.length, 0);
  console.log(`${count} candidates in ${games.length} games (${Math.round(input.length / 1000)}k characters)`);
  if (process.argv.includes('--dry-run')) {
    mkdirSync(LOG, { recursive: true });
    writeFileSync(path.join(LOG, 'dry-run.json'), JSON.stringify({ week, games }, null, 2));
    console.log(`(dry run: ${path.join(LOG, 'dry-run.json')})`);
    return;
  }

  const client = new Anthropic();
  const message = await client.messages
    .stream({
      model: MODEL,
      max_tokens: 100000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `This week's games and candidates:\n${input}` }],
    })
    .finalMessage();
  const usage = message.usage;
  const cost = ((usage.input_tokens + (usage.cache_creation_input_tokens ?? 0)) * PRICE.input + usage.output_tokens * PRICE.output) / 1e6;
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (message.stop_reason !== 'end_turn' || !text) throw new Error(`the desk stopped early (${message.stop_reason})`);
  const sheet = JSON.parse(text);

  // ---- checked: each pick's candidates real, from one game; its strength in range
  const byId = new Map(bets.map((b) => [b.id, b]));
  const problems = [];
  const picks = [];
  for (const p of sheet.picks) {
    const from = p.candidates.map((id) => byId.get(id)).filter(Boolean);
    const matchups = new Set(from.map((b) => b.game.matchup));
    if (!from.length || matchups.size > 1) {
      problems.push(`dropped "${p.bet}": candidates ${p.candidates.join(', ')}`);
      continue;
    }
    const game = from[0].game;
    picks.push({
      sport: 'nfl',
      bet: p.bet,
      label: p.label,
      side: p.side,
      fades: p.side === 'fade' ? p.fades || null : null,
      strength: Math.max(1, Math.min(10, p.strength)),
      case: p.case,
      risk: p.risk,
      grade: p.grade,
      sources: [...new Set(from.map((b) => b.source))],
      game: { week: game.week, date: game.date, kickoff: game.kickoff ?? site[game.matchup]?.kickoff ?? null, matchup: game.matchup, teams: game.teams, line: site[game.matchup]?.line ?? game.line },
    });
  }
  const at = new Date().toISOString();
  mkdirSync(LOG, { recursive: true });
  writeFileSync(
    path.join(LOG, `${at.slice(0, 16).replace(':', '')}.json`),
    JSON.stringify({ at, model: MODEL, effort: EFFORT, week, reportsAt, usage, cost, problems, sheet }, null, 2),
  );
  writeFileSync(path.join(SITE, 'bet-sheet.json'), JSON.stringify({ at, week, reportsAt, summary: sheet.summary, games: site, picks }));
  // The ledger: each game's picks as this sheet has them, until it kicks off (then they're what's graded)
  const season = seasonOf(picks[0]?.game.date ?? games[0].kickoff);
  if (ledger.season !== season) Object.assign(ledger, { season, weeks: {}, record: null });
  const thisWeek = (ledger.weeks[week] ??= {});
  for (const g of games) {
    thisWeek[g.matchup] = {
      kickoff: g.kickoff,
      lockedAt: at,
      picks: picks
        .filter((p) => p.game.matchup === g.matchup)
        .map((p) => ({ bet: p.bet, label: p.label, side: p.side, strength: p.strength, grade: p.grade, result: null, actual: null })),
    };
  }
  writeLedger(ledger);
  console.log(`${picks.length} picks, ${sheet.rejected.length} rejections; $${cost.toFixed(2)} (${usage.input_tokens} in, ${usage.output_tokens} out)`);
  for (const p of problems) console.log(`  ${p}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
