// The AI player analysis: each dossier (dossier.mjs) through Claude, a long-form structured report back,
// checked against the dossier (every evidence path must resolve; numbers in the prose are looked up) and
// kept in .cache/analysis/reports/<gsisId>.json with its token usage. --publish writes the reports the
// site reads (apps/nfl/src/StaticData/analysis/<row id>.json and its index).
//
//   node apps/nfl/scripts/analysis/analyze.mjs <name filters...>   (live calls, a few at a time: the pilot)
//   node apps/nfl/scripts/analysis/analyze.mjs --batch            (every dossier, through the Batch API)
//   node apps/nfl/scripts/analysis/analyze.mjs --publish          (no calls: the kept reports to the site)
//
// Needs ANTHROPIC_API_KEY (not for --publish).

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const DOSSIERS = path.join(ROOT, '.cache/analysis/dossiers');
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
- team: his offense and defense, ranked (defense ranks: 1 = stingiest); qbStarts: who started at QB each week; injuries: his offensive teammates on the injury report, most-used first (snapPct = their share of snaps this season: 90+ is a starter, under 30 a backup). nextGame: the coming opponent, the sportsbook line (line like "BAL -2.5" names the favorite and the spread; overUnder; his team's moneyline), the opponent's injury report, its defense profile and what it allows to his position (pprPerGame etc.: rank 1 = allows the least).
- career: past seasons, each stat ranked within that season. Use it to separate a real change from a blip, and to see what he has always been.
- Injuries: player.injury is his own status, with ESPN's news note and an expected return date (an estimate, not a promise). Notes are reports as of their "reported" date: news, not certainty. When availability matters — his own, his QB's, his blockers', his key targets', or a starter on the other side who bears on his matchup — say what it changes and why, concretely. Don't list injuries that don't touch him.
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

Betting angles (the site shows them as entertainment, with a disclaimer): look at the game's line (spread, total, moneyline) and his own production against this matchup, and flag what looks favorable — or say nothing looks off. For his player markets the dossier has no prop lines, so frame those against his own baseline ("his rushing yards: lean over his 36-a-game average against a front that ..."). Be selective and honest: "pass" is a fine answer, and a lean needs a real reason in the data, not a vibe. Strength: lean (slight), like (solid), strong (rare).

Style: plain sentences, numbers woven in only where they make the point, no clichés ("he's a gamer", "elite", "weapon"), no filler, never restate the totals table.`;

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
      description: '0-3 betting angles for the coming game; empty when nothing looks off',
      items: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'e.g. "BAL -2.5", "Over 44.5", "Jackson rushing yards"' },
          lean: { type: 'string', description: 'the side, e.g. "Over", "BAL -2.5", "Under his average"' },
          strength: { type: 'string', enum: ['lean', 'like', 'strong'] },
          reason: { type: 'string', description: '1-3 sentences from the data' },
        },
        required: ['market', 'lean', 'strength', 'reason'],
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
  system: SYSTEM,
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
  const out = { id, name: dossier.player.name, model: MODEL, effort: EFFORT, at: new Date().toISOString(), usage: message.usage, cost: costOf(message.usage, batch), problems, report };
  writeFileSync(path.join(REPORTS, `${id}.json`), JSON.stringify(out, null, 2));
  return out;
}

// ---- the site's copies: what the tab shows, each evidence with its real value (bad paths dropped), the
// game it previews, keyed by the row id the site uses (a QB's "QB-<ESPN id>")
function publish() {
  const index = JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/index.json'), 'utf8'));
  const siteIds = new Map(index.map((p) => [p.gsis, p.siteId]));
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(SITE, { recursive: true });
  const listed = {};
  for (const f of readdirSync(REPORTS)) {
    const kept = JSON.parse(readFileSync(path.join(REPORTS, f), 'utf8'));
    const siteId = siteIds.get(kept.id);
    if (!siteId || !kept.report.take) continue;
    const dossier = JSON.parse(readFileSync(path.join(DOSSIERS, `${kept.id}.json`), 'utf8'));
    const r = kept.report;
    for (const p of points(r)) p.evidence = p.evidence.map((e) => ({ label: e.label, ...(resolve(dossier, e.path) ?? {}) })).filter((e) => e.value !== undefined);
    const next = dossier.nextGame;
    const file = siteId.replace(/[^\w-]/g, '_');
    writeFileSync(
      path.join(SITE, `${file}.json`),
      JSON.stringify({
        at: kept.at,
        model: kept.model,
        game: next ? { week: next.week, date: next.date, opp: next.opp, at: next.at, line: next.line ?? null } : null,
        report: r,
      }),
    );
    listed[siteId] = file;
  }
  writeFileSync(path.join(SITE, 'index.json'), JSON.stringify(listed));
  console.log(`published ${Object.keys(listed).length} analyses`);
}

async function main() {
  if (process.argv.includes('--publish')) return publish();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  mkdirSync(REPORTS, { recursive: true });
  const client = new Anthropic();
  const index = JSON.parse(readFileSync(path.join(ROOT, '.cache/analysis/index.json'), 'utf8'));
  const load = (id) => JSON.parse(readFileSync(path.join(DOSSIERS, `${id}.json`), 'utf8'));

  if (process.argv.includes('--batch')) {
    const ids = readdirSync(DOSSIERS).map((f) => f.replace('.json', ''));
    const batch = await client.messages.batches.create({ requests: ids.map((id) => ({ custom_id: id, params: params(load(id)) })) });
    console.log(`batch ${batch.id}: ${ids.length} requests`);
    writeFileSync(path.join(ROOT, '.cache/analysis/batch.json'), JSON.stringify({ id: batch.id, at: new Date().toISOString() }));
    for (;;) {
      const b = await client.messages.batches.retrieve(batch.id);
      if (b.processing_status === 'ended') break;
      console.log(`  ${b.request_counts.processing} processing...`);
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

  const filters = process.argv.slice(2).map((x) => x.toLowerCase());
  const picks = index.filter((p) => filters.some((f) => p.name.toLowerCase().includes(f)));
  if (!picks.length) throw new Error('no players match');
  let total = 0;
  const one = async (p) => {
    const dossier = load(p.gsis);
    const message = await client.messages.stream(params(dossier)).finalMessage();
    const out = save(p.gsis, dossier, message, false);
    total += out.cost;
    console.log(`${out.name}: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out, $${out.cost.toFixed(3)} (batched $${(out.cost / 2).toFixed(3)})${out.problems.length ? `\n  ${out.problems.join('\n  ')}` : ''}`);
  };
  for (let i = 0; i < picks.length; i += 4) await Promise.all(picks.slice(i, i + 4).map(one));
  console.log(`total $${total.toFixed(2)} live (batched about $${(total / 2).toFixed(2)})`);
  publish();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
