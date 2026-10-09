// The AI player analysis: each dossier (dossier.mjs) through Claude, a long-form structured report back,
// checked against the dossier (every evidence path must resolve; numbers in the prose are looked up) and
// kept in .cache/analysis/reports/<gsisId>.json with its token usage. --publish writes the reports the
// site reads (apps/nfl/src/StaticData/analysis/<row id>.json and its index).
//
//   node apps/nfl/scripts/analysis/analyze.mjs <names...> --qbs --teams --team=BAL   (live calls, 4 at a time)
//   node apps/nfl/scripts/analysis/analyze.mjs --batch <the same choices>          (through the Batch API: half price)
//   ... --skip-done                                                               (not the ones written today)
//   node apps/nfl/scripts/analysis/analyze.mjs --resume                           (the last batch's results)
//   node apps/nfl/scripts/analysis/analyze.mjs --publish          (no calls: the kept reports to the site)
//
// Needs ANTHROPIC_API_KEY (not for --publish).

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { kickoffIso } from './live.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const DOSSIERS = path.join(ROOT, '.cache/analysis/dossiers');
const TEAM_DOSSIERS = path.join(ROOT, '.cache/analysis/teams');
const REPORTS = path.join(ROOT, '.cache/analysis/reports');
const SITE = path.join(ROOT, 'apps/nfl/src/StaticData/analysis');
const MODEL = 'claude-opus-5-5';
const EFFORT = process.env.EFFORT ?? 'high';
// $ per million tokens (Opus 5.5); the Batch API halves both
const PRICE = { input: 4, output: 20 };

const SYSTEM = `You are the analyst behind a football rankings site's player cards. The reader has opened a player's Analysis tab to understand him properly: what kind of player he is, what's really driving his numbers, what's real and what's noise, how the coming game sets up, what to expect the rest of the season, and whether anything in the betting market looks off. Write like a sharp film-and-numbers analyst talking to a smart fan: in depth, in context, with a point of view. Not a stat table read aloud, not a hype piece, not a list of disconnected bullet points.

You get one player's dossier as JSON. It is your only source. Use no outside knowledge of players, teams, injuries, trades or contracts beyond what the dossier says, and never state a number that isn't in it or directly derivable from it (a difference, a per-game average or a ratio of dossier numbers is fine). The one exception is restOfSeason.projections, which are your own estimates. If something you'd want to know isn't there, don't guess.

How to read the dossier:
- [value, rank, of]: the value, its rank among the position's qualifiers this season (1 = best; for "bad" stats like ints, sackPct, fumblesLost, rank 1 is the fewest), and how many qualify. Career lines rank within that season's site list.
- EPA = expected points added per play (0 is average; +0.2/play is very good for a QB, -0.1 bad). Success = share of plays with positive EPA. CPOE = completion % over expected, in points. anyPerDropback = adjusted net yards per dropback. passRateOverExp = how much more (or less) a team passes than situation predicts, in neutral game states.
- gameLog: each game from the player's team's side: favoredBy (Vegas; negative = underdog), covered (against the spread), overUnder vs the total, oppDefRankNow (that opponent's defensive EPA rank today, 1 = best defense). line holds his stats that game (pressuredPct, blitzed and badThrowPct from PFR charting; separation, cushion, yacAboveExp, ryoe, eightManBoxPct from Next Gen Stats; snapPct offensive snaps).
- splits: play-by-play cuts — byDepth (air yards), byDirection, third down, red zone, byScore (game state), shotgun vs under center, scrambles and designed runs; for receivers share of team red-zone and third-down targets, end-zone targets, YAC over expected; for runners by run direction/gap, goal line, short yardage.
- team: his offense and defense, ranked (defense ranks: 1 = stingiest); qbStarts: who started at QB each week; injuries: his offensive teammates on the injury report, most-used first (snapPct = their share of snaps this season: 90+ is a starter, under 30 a backup). nextGame: the coming opponent, the sportsbook line (line like "BAL -2.5" names the favorite and the spread; overUnder; his team's moneyline), the opponent's injury report, its defense profile and what it allows to his position (pprPerGame etc.: rank 1 = allows the least). oppVsPosition: that defense by role: pprOverAvg.WR1 (WR2, WR3, TE1 the top tight end, RB1 the lead back) = [PPR points a game those players scored against it over their own averages elsewhere, rank, of] (rank 1 = held them furthest under: an elite WR1 held to his average reads as good defense; his role is his place in his team's target or carry share); passRateOverNorm = [how many points more often offenses pass on it than they usually do in neutral situations (negative: they run more, a run funnel), rank (1 = the strongest pass funnel), of]; targetShare = [share of the targets against it to WRs / TEs / RBs, the league's share]. Treat these as context to weigh with everything else, not a verdict on their own: they rest on few games early in a season, and a role's rank can come from who the defense happened to face.
- career: past seasons, each stat ranked within that season. Use it to separate a real change from a blip, and to see what he has always been.
- Injuries: player.injury is his own status, with ESPN's news note and an expected return date (an estimate, not a promise). Notes are reports as of their "reported" date: news, not certainty. When availability matters — his own, his QB's, his blockers', his key targets', or a starter on the other side who bears on his matchup — say what it changes and why, concretely. Don't list injuries that don't touch him.
- Weather: nextGame.weather is the kickoff forecast at the stadium (roof: outdoors; retractable, likely closed in bad weather; or indoors, where weather doesn't matter). early: true means it's more than 3 days out and rough, especially wind: mention a big system, hedged, but don't build a case on it. What moves games: sustained wind of 15+ mph (or gusts of 25+) hurts passing, the deep game and kicking, and leans totals and passing numbers down; heavy rain or snow (a high precipChance with real precipIn) hurts passing and ball security somewhat; cold alone matters little. When it's mild, say nothing about it.
- Early in a season samples are small: weigh them honestly (a 15-attempt split is a hint, not a fact) and say so when it matters, without hedging everything.

Think like a football analyst, not a spreadsheet. Before you call any number a strength or a weakness, ask what produces it, and judge the cause, not the number:
- A stat is often the price of a strength, or a product of his role, scheme, teammates, opponents or game script. A scrambling QB's high pressure-to-sack rate and long time to throw usually come from extending plays to create with his legs: judge that trade (do the extended plays and scrambles pay for the sacks?), don't call it poor pocket presence. Likewise a deep threat's low catch rate, a goal-line back's low yards per carry, a slot receiver's low aDOT, a low target share in a run-first offense, gaudy numbers piled up in garbage time, or a dip that lines up with a backup QB, a missing tackle or a run of top defenses.
- Check the career before calling anything new: a trait he has had for years is who he is; a sudden change needs a cause (injury, new coach or QB, role change, opponents) or is likely noise.
- Separate what is sustainable (role, volume, skills that held up across seasons) from what is likely to regress (TD rate on small volume, a hot or cold split on a handful of plays, fumble luck).

The archetype: the established football name for the kind of player he is, the way analysts and fans would say it — not an invented label. Pick the best fit from these (or an equally standard term if none fits), optionally with a short qualifier in parentheses ("Dual-Threat (scramble-first)"):
- QB: Dual-Threat, Pocket Passer, Gunslinger, Game Manager, Point Guard (quick, spread-it-around distributor), Improviser, Field General, Rookie Developmental
- RB: Bell Cow, Workhorse, Power Back, Home-Run Hitter, Receiving Back, Change-of-Pace, Goal-Line Back, Committee Back
- WR: Alpha X, Deep Threat, Slot Separator, Possession Receiver, YAC Weapon, Contested-Catch, Field Stretcher, Gadget Weapon, Volume Possession
- TE: Move Tight End, Inline Blocker, Complete Tight End, Seam Stretcher, Red-Zone Target, Big Slot
Define it in one sentence for this player.

Evidence: every strength, concern and key matchup cites 1-3 numbers from the dossier by JSON path (dot notation from the dossier root, array indexes as numbers: "splits.byDepth.short0to9.epa", "season.ranked.ypa", "gameLog.2.line.passYds", "nextGame.oppDefense.defRushEpa"). The site shows the real value from that path, so the path must exist exactly. The label is a 1-4 word name for the number.

Betting angles: look at the game's line (spread, total, moneyline) and his own production against this matchup, and flag what looks favorable — or say nothing looks off. For his player markets the dossier has no prop lines, so frame those against his own baseline ("his rushing yards: over his 36-a-game average against a front that ..."). Give every angle the data really supports, up to five — and none when nothing stands out; never pad the list. Only bets someone could actually place ("avoid his props" is not a bet), and none at all if he isn't expected to play (ruled out, doubtful, or not the starter). Each needs a real reason in the data, not a vibe. Mark each like (backing the side you name) or fade (going against a side the market or the obvious read favors: name that side as the market, and make the lean the bet itself, the other side); how strong a bet is belongs in its score, not this. Then score each 1-10 for how likely it is to win, apart from its grade (a fade can score as high as any bet). Be decisive, not defensive: when the matchup, recent form, injuries and the number all point the same way, say so with an 8 or 9; a 5-6 is a modest edge; below 5 isn't worth listing. Don't park every bet in the middle to protect yourself; the reader wants to know which of your calls you would actually put money on. This score is about the bet, not about how much data there is (that is the report's confidence).

Style: plain sentences, numbers woven in only where they make the point, no clichés ("he's a gamer", "elite", "weapon"), no filler, never restate the totals table.`;

// Teams: the same report, about a team (its Team, Defense, O-line and Coach cards all show it)
const TEAM_SYSTEM = `You are the analyst behind a football rankings site's team cards. The reader has opened a team's Analysis tab to understand it properly: what kind of team this is, what is really driving its record, what is real and what is noise, how the coming game sets up, where the season is heading, and whether anything in the betting market looks off. Write like a sharp film-and-numbers analyst talking to a smart fan: in depth, in context, with a point of view. Not a stat table read aloud, not a hype piece, not disconnected bullet points.

You get one team's dossier as JSON. It is your only source. Use no outside knowledge of players, teams, injuries, trades or coaches beyond what the dossier says, and never state a number that isn't in it or directly derivable from it (a difference, a per-game average or a ratio of dossier numbers is fine). The one exception is restOfSeason.projections, which are your own estimates. If something you'd want to know isn't there, don't guess.

How to read the dossier:
- [value, rank, of]: the value and its rank among the 32 teams this season (1 = best; for stats where less is better — points allowed, EPA allowed, sacks allowed, penalties — rank 1 is the fewest). History lines rank within that season.
- team: record, points for and against, division standings, the coach (newCoach: first year).
- season.team: results and efficiency (winsOverExpected: wins beyond what the point differential predicts, so luck; atsPct: share of games covered; netEpa; offEpa; defEpaAllowed; oneScoreWinPct; turnoverDiffPerGame; fourthDownGoPct; topPerGame). season.defense: EPA allowed by pass and rush, pressure rate made, takeaways, third-down and red-zone rates allowed, missed tackles. season.offensiveLine: pressure and sack rates allowed, stuff rate, yards before contact, run EPA. season.playByPlay: offense and defense EPA splits by pass and rush, success rates, pass rate over expected, explosive plays allowed, deep and short passing defense. season.defenseVsPosition (and nextGame.oppVsPosition, the opponent's): the defense by role: pprOverAvg.WR1 (WR2, WR3, TE1, RB1) = [PPR points a game the offense's WR1 (by target share; the lead back by carries) scored against it over his own average elsewhere, rank, of] (rank 1 = held them furthest under); passRateOverNorm = [how many points more often offenses pass on it than usual in neutral situations (negative: a run funnel), rank (1 = the strongest pass funnel), of]; targetShare = [share of the targets against it to WRs / TEs / RBs, the league's share]. Treat these as context to weigh with everything else, not a verdict on their own: they rest on few games early in a season, and a role's rank can come from who the defense happened to face.
- qbStarts: who started at QB each week. usage: who carries the offense (top passers, rushers by carries, receivers by targets).
- gameLog: each game: the score, Vegas (favoredBy: negative = underdog; covered; overUnder), the QB, the opponent's offense and defense EPA ranks today, and the box score (yards, EPA, turnovers, sacks both ways, takeaways, penalties).
- injuries: the team's injury report, most-used first (snapPct: 90+ is a starter, under 30 a backup), with ESPN's news notes and return estimates (estimates, not promises).
- Weather: nextGame.weather is the kickoff forecast at the stadium (roof: outdoors; retractable, likely closed in bad weather; or indoors, where weather doesn't matter). early: true means it's more than 3 days out and rough, especially wind: mention a big system, hedged, but don't build a case on it. What moves games: sustained wind of 15+ mph (or gusts of 25+) hurts passing, the deep game and kicking, and leans totals and passing numbers down; heavy rain or snow (a high precipChance with real precipIn) hurts passing and ball security somewhat; cold alone matters little. When it's mild, say nothing about it.
- nextGame: the coming opponent, the line (line like "BAL -2.5" names the favorite and the spread; overUnder; this team's moneyline), the opponent's record, its season profile, its QB starts and its injury report. restOfSchedule: each remaining opponent's record and offense/defense EPA ranks today (division games marked).
- history: the team's recent seasons, ranked within each season.
- Early in a season samples are small: weigh them honestly and say so when it matters, without hedging everything.

Think like a football analyst, not a spreadsheet. Before calling anything a strength or a weakness, ask what produces it and judge the cause: a record built on close wins and turnovers (luck that tends to regress) versus one built on efficiency; a defense whose numbers came against bad offenses; points allowed driven by short fields from turnovers; a run game that looks bad because of the line or good because of game script; a quarterback change or key injuries that split the season in two. Check history before calling anything new.

The archetype: the established way fans and analysts describe this kind of team, optionally with a short qualifier in parentheses for its style ("Playoff Team (defense-first)"). Pick from: Super Bowl Contender, Playoff Team, Fringe Contender, Pretender (record ahead of its play), Better Than Its Record, Retooling, Rebuilding — or an equally standard term if none fits. Define it in one sentence for this team.

Evidence: every strength, concern and key matchup cites 1-3 numbers from the dossier by JSON path (dot notation from the dossier root, array indexes as numbers: "season.team.netEpa", "season.defense.pressureRate", "gameLog.2.box.rushYds", "nextGame.oppSeason.playByPlay.defRushEpa"). The site shows the real value from that path, so the path must exist exactly. The label is a 1-4 word name for the number.

Projections: per-game or season ranges for the rest of the season (e.g. "Final wins", "Points scored / game", "Points allowed / game").

Betting angles: look at the game's line (spread, total, moneyline), each side's team total, and the season picture, and flag what looks favorable — or say nothing looks off. Give every angle the data really supports, up to five, and none when nothing stands out; never pad the list. Only bets someone could actually place ("avoid this game" is not a bet). Each needs a real reason in the data, not a vibe. Mark each like (backing the side you name) or fade (going against a side the market or the obvious read favors: name that side as the market, and make the lean the bet itself, the other side); how strong a bet is belongs in its score, not this. Then score each 1-10 for how likely it is to win, apart from its grade (a fade can score as high as any bet). Be decisive, not defensive: when the matchup, recent form, injuries and the number all point the same way, say so with an 8 or 9; a 5-6 is a modest edge; below 5 isn't worth listing. Don't park every bet in the middle to protect yourself; the reader wants to know which of your calls you would actually put money on. This score is about the bet, not about how much data there is (that is the report's confidence).

Style: plain sentences, numbers woven in only where they make the point, no clichés, no filler, never restate the stats table.`;

const evidence = {
  type: 'array',
  description: '1-3 dossier numbers backing this, by exact JSON path',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', description: '1-4 words, e.g. "Deep-ball EPA"' },
      path: { type: 'string', description: 'dot path into the dossier, e.g. splits.byDepth.deep20plus.epa' },
    },
    required: ['label', 'path'],
    additionalProperties: false,
  },
};
const point = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '3-7 words' },
    body: { type: 'string', description: '2-4 sentences: what it is, what causes it, whether it lasts' },
    evidence,
  },
  required: ['title', 'body', 'evidence'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: {
    archetype: {
      type: 'object',
      properties: { name: { type: 'string', description: 'an established archetype name, optional short qualifier in parentheses' }, definition: { type: 'string', description: 'one sentence, for this player' } },
      required: ['name', 'definition'],
      additionalProperties: false,
    },
    headline: { type: 'string', description: 'one line, at most 14 words: the take on his season' },
    take: { type: 'string', description: 'the in-depth take: 3-4 paragraphs separated by blank lines — who he is, what is driving the season, what the numbers hide, where it is heading' },
    strengths: { type: 'array', description: '2-3, most important first', items: point },
    concerns: { type: 'array', description: '1-3, most important first; each judged in context (a cost of a strength, his role, or a real flaw?)', items: point },
    trend: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['rising', 'falling', 'steady', 'volatile'] },
        note: { type: 'string', description: 'one or two sentences on the game-by-game path' },
      },
      required: ['direction', 'note'],
      additionalProperties: false,
    },
    nextGame: {
      type: 'object',
      description: 'the coming game (when the dossier has one)',
      properties: {
        outlook: { type: 'string', enum: ['favorable', 'tough', 'neutral'] },
        headline: { type: 'string', description: 'at most 12 words' },
        body: { type: 'string', description: '2 paragraphs, separated by a blank line: how this opponent meets his profile, and the availability that matters on both sides' },
        keyMatchups: { type: 'array', description: '1-3 specific matchups or game-script factors', items: point },
        watch: { type: 'string', description: 'the one thing to watch' },
      },
      required: ['outlook', 'headline', 'body', 'keyMatchups', 'watch'],
      additionalProperties: false,
    },
    restOfSeason: {
      type: 'object',
      properties: {
        body: { type: 'string', description: '1-2 paragraphs: what to expect from here and why, what is sustainable and what will regress' },
        projections: {
          type: 'array',
          description: '2-4 per-game ranges you project for the rest of the season, for his key stats (your estimates)',
          items: {
            type: 'object',
            properties: { stat: { type: 'string', description: 'e.g. "Passing yards / game"' }, low: { type: 'number' }, high: { type: 'number' } },
            required: ['stat', 'low', 'high'],
            additionalProperties: false,
          },
        },
        swingFactors: { type: 'array', description: '1-3 short phrases: what moves the outlook most', items: { type: 'string' } },
      },
      required: ['body', 'projections', 'swingFactors'],
      additionalProperties: false,
    },
    bets: {
      type: 'array',
      description: '0-5 betting angles for the coming game, only those the data supports; empty when nothing looks off',
      items: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'e.g. "BAL -2.5", "Over 44.5", "Jackson rushing yards"' },
          lean: { type: 'string', description: 'the bet itself, in a few words: "Under 45.5", "TB +9.5", "Over 0.5 INT", "Under his rushing average" (for a fade, the other side: never "fade ...")' },
          strength: { type: 'string', enum: ['like', 'fade'], description: 'like: backing the side named; fade: going against it (its score says how sure)' },
          confidence: { type: 'integer', description: 'how likely this bet is to win, 5-10 (decisive: 8-9 when everything lines up; a fade can be a 9)' },
          reason: { type: 'string', description: '1-3 sentences from the data' },
        },
        required: ['market', 'lean', 'strength', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'object',
      properties: { level: { type: 'string', enum: ['low', 'medium', 'high'] }, note: { type: 'string', description: 'why, in a few words (sample size, role change...)' } },
      required: ['level', 'note'],
      additionalProperties: false,
    },
  },
  required: ['archetype', 'headline', 'take', 'strengths', 'concerns', 'trend', 'nextGame', 'restOfSeason', 'bets', 'confidence'],
  additionalProperties: false,
};

const params = (dossier) => ({
  model: MODEL,
  max_tokens: 20000,
  output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
  system: dossier.kind === 'team' ? TEAM_SYSTEM : SYSTEM,
  messages: [{ role: 'user', content: `Dossier:\n${JSON.stringify(dossier)}` }],
});

// ---- checking a report against its dossier

const at = (obj, p) => p.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
// The value an evidence path shows: a ranked [value, rank, of] reads as its value and its rank
function resolve(dossier, p) {
  const v = at(dossier, p);
  if (v === undefined || v === null || (typeof v === 'object' && !Array.isArray(v))) return null;
  if (Array.isArray(v)) return v.length === 3 && v.every((x) => typeof x === 'number') ? { value: v[0], rank: v[1], of: v[2] } : null;
  return { value: v };
}
function numbersIn(obj, out = new Set()) {
  if (typeof obj === 'number') {
    for (const n of [obj, Math.round(obj * 10) / 10, Math.round(obj * 100) / 100, Math.round(obj)]) out.add(Math.abs(n));
    if (Math.abs(obj) < 1) out.add(Math.abs(Math.round(obj * 1000) / 10)); // .363 -> 36.3%
  } else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) numbersIn(v, out);
  return out;
}
const points = (r) => [...r.strengths, ...r.concerns, ...(r.nextGame?.keyMatchups ?? [])];
function check(report, dossier) {
  const problems = [];
  for (const e of points(report).flatMap((p) => p.evidence)) {
    e.resolved = resolve(dossier, e.path);
    if (!e.resolved) problems.push(`bad path: ${e.path}`);
  }
  // numbers in the prose that aren't in the dossier (small counts, and the projections, aren't checked)
  const known = numbersIn(dossier);
  const prose = [report.headline, report.take, ...points(report).map((p) => p.body), report.trend.note, report.nextGame?.body, report.nextGame?.watch, report.restOfSeason.body, ...report.bets.map((b) => `${b.market} ${b.reason}`)].join(' ');
  for (const m of prose.matchAll(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g)) {
    const n = Math.abs(Number(m[0].replace(/,/g, '')));
    if (Number.isInteger(n) && n <= 20) continue;
    if (!known.has(n)) problems.push(`unmatched number: ${m[0]}`);
  }
  return problems;
}

function costOf(usage, batch) {
  const k = batch ? 0.5 : 1;
  return (k * ((usage.input_tokens + (usage.cache_creation_input_tokens ?? 0)) * PRICE.input + usage.output_tokens * PRICE.output)) / 1e6;
}

function save(id, dossier, message, batch) {
  const text = message.content.find((b) => b.type === 'text')?.text;
  const report = JSON.parse(text);
  const problems = check(report, dossier);
  const name = dossier.kind === 'team' ? dossier.team.name : dossier.player.name;
  const out = { id, name, model: MODEL, effort: EFFORT, at: new Date().toISOString(), usage: message.usage, cost: costOf(message.usage, batch), problems, report };
  writeFileSync(path.join(REPORTS, `${id}.json`), JSON.stringify(out, null, 2));
  return out;
}

// A job's dossier: a player's by gsis id, a team's as "team-BAL"
const dossierFile = (id) => (id.startsWith('team-') ? path.join(TEAM_DOSSIERS, `${id.slice(5)}.json`) : path.join(DOSSIERS, `${id}.json`));
const load = (id) => JSON.parse(readFileSync(dossierFile(id), 'utf8'));

// ---- the Bets page's bets: only bets you could place, from players who'll play

const OUT = /^(out|injured reserve|doubtful|suspended)/i;
const unavailable = (d) => OUT.test(d.player?.injury?.status ?? '') || OUT.test(d.player?.siteInjuryStatus ?? '');
// The depth-chart rank of a player's spot ("QB1" -> 1; none: 99)
const depthRank = (d) => Number(d.player?.depthChart?.match(/^[A-Z]+(\d+)/)?.[1] ?? 99);
// Whether a player plays this week: not ruled out, and (a QB) the best-ranked of his team's QBs who aren't
let starters = null;
function playing(id, dossier) {
  if (unavailable(dossier)) return false;
  if (dossier.player?.position !== 'QB') return true;
  if (!starters) {
    starters = new Map();
    for (const f of readdirSync(DOSSIERS)) {
      const d = JSON.parse(readFileSync(path.join(DOSSIERS, f), 'utf8'));
      if (d.player?.position !== 'QB' || unavailable(d)) continue;
      const team = d.player.team;
      const best = starters.get(team);
      if (!best || depthRank(d) < best.rank) starters.set(team, { id: f.replace('.json', ''), rank: depthRank(d) });
    }
  }
  return starters.get(dossier.player.team)?.id === id;
}

// A bet as one you could place, or null. "Avoid ...", "no edge" and "pass" aren't bets. A side spelled out
// inside ("Against Seattle (SF +2.5)") is that side. Going against something ("Fade WSH -3", "Against
// NE") is the other side of what it names, or of its market: a spread the other team's, a moneyline the
// other team's, a total the other way; a player's or team's own numbers stay as written; anything else
// (no telling the other side) is dropped
const SAME = { WSH: 'WAS', LAR: 'LA' };
function otherSide(text, team, opp) {
  const total = text.match(/\b(over|under)\s*(\d+(?:\.\d+)?)?/i);
  if (total && !/team total/i.test(text)) return `${/over/i.test(total[1]) ? 'Under' : 'Over'}${total[2] ? ` ${total[2]}` : ''}`;
  if (!team || !opp) return null;
  const other = (abbr) => ((SAME[abbr] ?? abbr) === team ? opp : team);
  const ml = text.match(/\b([A-Z]{2,3})\b[^/]*?\b(?:moneyline|ML)\b/);
  if (ml) return `${other(ml[1])} ML`;
  const side = text.match(/\b([A-Z]{2,3})\s*[^\d+-]*([+-])(\d+(?:\.\d+)?)/);
  if (side) return `${other(side[1])} ${side[2] === '-' ? '+' : '-'}${side[3]}`;
  return null;
}
function actionable(b, team, opp) {
  const lean = b.lean.trim();
  if (/^(avoid|no edge|no bet|pass|none|stay away)\b/i.test(lean) || /\bany\b/i.test(b.market)) return null;
  const inner = lean.match(/\(([A-Z]{2,3})\s*([+-]\d+(?:\.\d+)?)\)/);
  if (inner) return { ...b, lean: `${inner[1]} ${inner[2]}` };
  const against = lean.match(/^(?:fade|against)\s+(.*)$/i);
  if (!against) return b;
  const flipped = otherSide(against[1], team, opp) ?? otherSide(b.market, team, opp);
  if (flipped) return { ...b, lean: flipped };
  // (a player's or team's own numbers: "against the streak" stays as written)
  return /\b(passing|rushing|receiving|sacks?|interceptions?|touchdowns?|tds?|yards|completions)\b/i.test(b.market) ? b : null;
}

// Each game's kickoff (an ISO time, UTC) from nflverse's schedule, by its day and teams
// ("2026-10-11 PHI@JAX"): the schedule's times are Eastern, so each gets that day's Eastern offset
// (EDT or EST)
function kickoffs() {
  const file = path.join(ROOT, '.cache/nflverse/games.csv');
  if (!existsSync(file)) return new Map();
  const [head, ...rows] = readFileSync(file, 'utf8').split('\n');
  const col = Object.fromEntries(head.split(',').map((name, i) => [name.trim(), i]));
  const out = new Map();
  for (const row of rows) {
    const f = row.split(',');
    const kickoff = kickoffIso(f[col.gameday], f[col.gametime]);
    if (kickoff) out.set(`${f[col.gameday]} ${f[col.away_team]}@${f[col.home_team]}`, kickoff);
  }
  return out;
}

// ---- the site's copies: what the tab shows, each evidence with its real value (bad paths dropped), the
// game it previews, keyed by the row ids the site uses (a QB's "QB-<ESPN id>"; a team's report under its
// Team, Defense, O-line and Coach rows)

function publish() {
  const kickoff = kickoffs();
  // each team's logo on the site, by abbreviation (from its defense's row: "DEF-CHI")
  const logos = new Map(
    JSON.parse(readFileSync(path.join(ROOT, 'apps/nfl/src/StaticData/skill-players.json'), 'utf8')).DEF.map((unit) => [unit.gsisId.slice(4), unit.teamLogo]),
  );
  const players = JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/index.json'), 'utf8'));
  const teams = existsSync(path.join(ROOT, '.cache/analysis/team-index.json')) ? JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/team-index.json'), 'utf8')) : [];
  const siteIds = new Map([...players.map((p) => [p.gsis, [p.siteId]]), ...teams.map((t) => [`team-${t.team}`, t.siteIds])]);
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(SITE, { recursive: true });
  const listed = {};
  // every betting angle, for the Bets page: its game, its source, the call and how sure
  const bets = [];
  for (const f of readdirSync(REPORTS)) {
    const kept = JSON.parse(readFileSync(path.join(REPORTS, f), 'utf8'));
    const ids = siteIds.get(kept.id);
    if (!ids || !kept.report.take || !existsSync(dossierFile(kept.id))) continue;
    const dossier = load(kept.id);
    const r = kept.report;
    for (const p of points(r)) p.evidence = p.evidence.map((e) => ({ label: e.label, ...(resolve(dossier, e.path) ?? {}) })).filter((e) => e.value !== undefined);
    const next = dossier.nextGame;
    const file = kept.id.startsWith('team-') ? kept.id : ids[0].replace(/[^\w-]/g, '_');
    writeFileSync(
      path.join(SITE, `${file}.json`),
      JSON.stringify({
        at: kept.at,
        model: kept.model,
        game: next ? { week: next.week, date: next.date, opp: next.opp, at: next.at, line: next.line ?? null } : null,
        report: r,
      }),
    );
    for (const id of ids) listed[id] = file;
    const team = (dossier.kind === 'team' ? dossier.team.name : (dossier.player.team ?? '')).match(/\((\w+)\)/)?.[1] ?? null;
    // (a player's bets only when he's expected to play: his team's starter, not ruled out)
    if (dossier.kind !== 'team' && !playing(kept.id, dossier)) continue;
    for (const raw of r.bets ?? []) {
      const b = actionable(raw, team, next?.opp);
      if (!b) continue;
      bets.push({
        sport: 'nfl',
        source: kept.name,
        kind: dossier.kind === 'team' ? 'team' : 'player',
        position: dossier.player?.position ?? null,
        rowId: ids[0],
        team,
        game:
          next && team
            ? {
                week: next.week,
                date: next.date,
                kickoff: kickoff.get(next.at === 'home' ? `${next.date} ${next.opp}@${team}` : `${next.date} ${team}@${next.opp}`) ?? null,
                matchup: next.at === 'home' ? `${next.opp} @ ${team}` : `${team} @ ${next.opp}`,
                // (its two teams, each with its logo: the away team first, as in the matchup)
                teams: (next.at === 'home' ? [next.opp, team] : [team, next.opp]).map((abbr) => ({ abbr, logo: logos.get(abbr) ?? null })),
                line: next.line ?? null,
              }
            : null,
        market: b.market,
        lean: b.lean,
        strength: b.strength === 'strong' ? 'like' : b.strength,
        score: Number.isInteger(b.confidence) ? b.confidence : null,
        reason: b.reason,
        confidence: r.confidence?.level ?? null,
        at: kept.at,
      });
    }
  }
  writeFileSync(path.join(SITE, 'index.json'), JSON.stringify(listed));
  writeFileSync(path.join(SITE, 'bets.json'), JSON.stringify({ at: new Date().toISOString(), bets }));
  console.log(`published ${new Set(Object.values(listed)).size} analyses (${Object.keys(listed).length} rows)`);
}

// The jobs the command line asks for: --qbs (every QB), --teams (every team), --team=BAL, and names
function jobs() {
  const args = process.argv.slice(2);
  const players = JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/index.json'), 'utf8'));
  const teams = JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/team-index.json'), 'utf8'));
  const names = args.filter((a) => !a.startsWith('--')).map((x) => x.toLowerCase());
  const ids = new Set();
  if (args.includes('--qbs')) for (const p of players) if (p.pos === 'QB') ids.add(p.gsis);
  if (args.includes('--teams')) for (const t of teams) ids.add(`team-${t.team}`);
  for (const a of args) if (a.startsWith('--team=')) ids.add(`team-${a.slice(7).toUpperCase()}`);
  for (const p of players) if (names.some((n) => p.name.toLowerCase().includes(n))) ids.add(p.gsis);
  // (--skip-done: not the ones already written today)
  const today = new Date().toISOString().slice(0, 10);
  const done = (id) => existsSync(path.join(REPORTS, `${id}.json`)) && JSON.parse(readFileSync(path.join(REPORTS, `${id}.json`), 'utf8')).at.startsWith(today);
  return [...ids].filter((id) => !args.includes('--skip-done') || !done(id));
}

async function main() {
  if (process.argv.includes('--publish')) return publish();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  mkdirSync(REPORTS, { recursive: true });
  const client = new Anthropic();
  // (--resume: wait for the last batch sent, and keep its results)
  const resume = process.argv.includes('--resume');
  const ids = resume ? [] : jobs();
  if (!ids.length && !resume) throw new Error('nothing to analyze (names, --qbs, --teams, --team=BAL)');

  if (process.argv.includes('--batch') || resume) {
    const batch = resume
      ? JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/batch.json'), 'utf8'))
      : await client.messages.batches.create({ requests: ids.map((id) => ({ custom_id: id, params: params(load(id)) })) });
    if (!resume) {
      console.log(`batch ${batch.id}: ${ids.length} requests`);
      writeFileSync(path.join(ROOT, '.cache/analysis/batch.json'), JSON.stringify({ id: batch.id, ids, at: new Date().toISOString() }));
    }
    for (;;) {
      const b = await client.messages.batches.retrieve(batch.id);
      if (b.processing_status === 'ended') break;
      console.log(`  ${b.request_counts.processing} processing, ${b.request_counts.succeeded} done...`);
      await new Promise((res) => setTimeout(res, 60_000));
    }
    let total = 0;
    for await (const result of await client.messages.batches.results(batch.id)) {
      if (result.result.type !== 'succeeded') {
        console.log(`${result.custom_id}: ${result.result.type}`);
        continue;
      }
      const out = save(result.custom_id, load(result.custom_id), result.result.message, true);
      total += out.cost;
      if (out.problems.length) console.log(`${out.name}: ${out.problems.join('; ')}`);
    }
    console.log(`total $${total.toFixed(2)}`);
    return publish();
  }

  let total = 0;
  const one = async (id) => {
    const dossier = load(id);
    const message = await client.messages.stream(params(dossier)).finalMessage();
    const out = save(id, dossier, message, false);
    total += out.cost;
    console.log(`${out.name}: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out, $${out.cost.toFixed(3)} (batched $${(out.cost / 2).toFixed(3)})${out.problems.length ? `\n  ${out.problems.join('\n  ')}` : ''}`);
  };
  for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(one));
  console.log(`total $${total.toFixed(2)} live (batched about $${(total / 2).toFixed(2)})`);
  publish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
