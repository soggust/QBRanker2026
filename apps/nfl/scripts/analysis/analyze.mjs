// The AI player analysis: each dossier (dossier.mjs) through Claude, a structured report back, checked
// against the dossier (every evidence path must resolve; numbers in the prose are looked up) and kept in
// .cache/analysis/reports/<gsisId>.json with its token usage.
//
//   node apps/nfl/scripts/analysis/analyze.mjs <name filters...>   (live calls, a few at a time: the pilot)
//   node apps/nfl/scripts/analysis/analyze.mjs --batch            (every dossier, through the Batch API)
//
// Needs ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const DOSSIERS = path.join(ROOT, '.cache/analysis/dossiers');
const REPORTS = path.join(ROOT, '.cache/analysis/reports');
const MODEL = 'claude-opus-5-5';
const EFFORT = process.env.EFFORT ?? 'high';
// $ per million tokens (Opus 5.5); the Batch API halves both
const PRICE = { input: 4, output: 20 };

const SYSTEM = `You are the analyst behind a football rankings site's player cards: the reader has just clicked a player and wants to understand him — what kind of player he is, what's driving his numbers, what's real and what's noise, and what to expect next. Write like a sharp film-and-numbers analyst, not a stat table read aloud and not a hype piece.

You get one player's dossier as JSON. It is your only source. Use no outside knowledge of players, teams, injuries, trades or contracts beyond what the dossier says, and never state a number that isn't in it or directly derivable from it (a difference or a ratio of two dossier numbers is fine). If something you'd want to know isn't there, don't guess.

How to read the dossier:
- [value, rank, of]: the value, its rank among the position's qualifiers this season (1 = best; for "bad" stats like ints, sackPct, fumblesLost, rank 1 is the fewest), and how many qualify. Career lines rank within that season's site list.
- EPA = expected points added per play (0 is average; +0.2/play is very good for a QB, -0.1 bad). Success = share of plays with positive EPA. CPOE = completion % over expected, in points. anyPerDropback = adjusted net yards per dropback. passRateOverExp = how much more (or less) a team passes than situation predicts, in neutral game states.
- gameLog: each game from the player's team's side: favoredBy (Vegas; negative = underdog), covered (against the spread), overUnder vs the total, oppDefRankNow (that opponent's defensive EPA rank today, 1 = best defense). line holds his stats that game (pressuredPct, blitzed and badThrowPct from PFR charting; separation, cushion, yacAboveExp, ryoe, eightManBoxPct from Next Gen Stats; snapPct offensive snaps).
- splits: play-by-play cuts — byDepth (air yards), byDirection, third down, red zone, byScore (game state), shotgun vs under center; for receivers share of team red-zone and third-down targets, end-zone targets, YAC over expected; for runners by run direction/gap, goal line, short yardage.
- team: his offense and defense, ranked (defense ranks: 1 = stingiest); qbStarts: who started at QB each week; injuries: his offensive teammates on the injury report, most-used first (snapPct = their share of snaps this season: 90+ is a starter, under 30 a backup). nextGame: the coming opponent, the sportsbook line (line like "BAL -2.5" names the favorite and the spread; overUnder; his team's moneyline), the opponent's injury report (offense and defense, most-used first), its defense profile and what it allows to his position (pprPerGame etc.: rank 1 = allows the least).
- Injuries: player.injury is his own status, with ESPN's news note and an expected return date (an estimate, not a promise). Notes are reports as of their "reported" date: weigh them as news, not certainty. When availability matters — his own, his starting QB's, his blockers', his key targets', or a starter on the other side who bears on his matchup — say what it changes and why, concretely (a backup QB's effect on a receiver's volume and depth, a missing tackle against a QB's pressure problem, a missing corner in coverage). Don't list injuries that don't touch him.
- Early in a season samples are small: weigh them honestly (a 15-attempt split is a hint, not a fact) and say so when it matters, without hedging everything.

What makes a good report: specific causes over generic praise ("his EPA is built on the short game: 0.50 on throws under 10 air yards, while third downs sit near zero" beats "he's been efficient"); tension and nuance (what the box score hides, what's sustainable, what isn't); connecting numbers across sections (game log + splits + team context + career arc); the matchup in football terms. No clichés ("dual-threat weapon", "he's a gamer", "elite"); no filler; never just restate the totals.

The archetype: name the kind of player he is, from what the data shows, in 2-4 memorable words a fan would use (e.g. "Quick-Game Surgeon", "Volume Grinder", "Boom-or-Bust Field Stretcher") — specific to his profile, not his position name, and not flattering by default. Define it in one sentence.

Evidence: every insight cites 1-3 numbers from the dossier by JSON path (dot notation from the dossier root, array indexes as numbers: "splits.byDepth.short0to9.epa", "season.ranked.ypa", "gameLog.2.line.passYds", "nextGame.oppDefense.defRushEpa"). The site shows the real value from that path, so the path must exist exactly. The label is a 1-4 word name for the number.

The trend chart: pick the one game-log stat (a key of gameLog[].line) whose game-by-game path best tells his season's story.`;

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
const SCHEMA = {
  type: 'object',
  properties: {
    archetype: {
      type: 'object',
      properties: { name: { type: 'string', description: '2-4 words' }, definition: { type: 'string', description: 'one sentence' } },
      required: ['name', 'definition'],
      additionalProperties: false,
    },
    headline: { type: 'string', description: 'one punchy line, at most 14 words, the take on his season' },
    summary: { type: 'string', description: '2-3 sentences: who he is this season and why' },
    insights: {
      type: 'array',
      description: '3-5 insights, most important first',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '3-7 words' },
          tone: { type: 'string', enum: ['strength', 'concern', 'context'] },
          body: { type: 'string', description: '2-4 sentences' },
          evidence,
        },
        required: ['title', 'tone', 'body', 'evidence'],
        additionalProperties: false,
      },
    },
    trend: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['rising', 'falling', 'steady', 'volatile'] },
        stat: { type: 'string', description: 'a key of gameLog[].line to chart game by game' },
        label: { type: 'string', description: 'the chart title, 2-5 words' },
        note: { type: 'string', description: 'one sentence on the trend' },
      },
      required: ['direction', 'stat', 'label', 'note'],
      additionalProperties: false,
    },
    nextGame: {
      type: 'object',
      description: 'the coming matchup (when the dossier has a nextGame)',
      properties: {
        outlook: { type: 'string', enum: ['favorable', 'tough', 'neutral'] },
        headline: { type: 'string', description: 'at most 12 words' },
        body: { type: 'string', description: '2-4 sentences on how this opponent meets his profile' },
        watch: { type: 'string', description: 'one specific thing to watch in this game' },
        evidence,
      },
      required: ['outlook', 'headline', 'body', 'watch', 'evidence'],
      additionalProperties: false,
    },
    careerArc: { type: 'string', description: 'one or two sentences placing this season in his career (or his rookie context); empty when no history' },
    outlook: { type: 'string', description: '1-2 sentences: what to expect the rest of the season, and the biggest swing factor' },
    confidence: {
      type: 'object',
      properties: { level: { type: 'string', enum: ['low', 'medium', 'high'] }, note: { type: 'string', description: 'why, in a few words (sample size, role change...)' } },
      required: ['level', 'note'],
      additionalProperties: false,
    },
  },
  required: ['archetype', 'headline', 'summary', 'insights', 'trend', 'nextGame', 'careerArc', 'outlook', 'confidence'],
  additionalProperties: false,
};

const params = (dossier) => ({
  model: MODEL,
  max_tokens: 16000,
  output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
  system: SYSTEM,
  messages: [{ role: 'user', content: `Dossier:\n${JSON.stringify(dossier)}` }],
});

// ---- checking a report against its dossier

const at = (obj, p) => p.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
// The value an evidence path shows: a ranked [value, rank, of] reads as its value and "#rank of N"
function resolve(dossier, p) {
  const v = at(dossier, p);
  if (v === undefined || v === null || typeof v === 'object' && !Array.isArray(v)) return null;
  if (Array.isArray(v)) return v.length === 3 && v.every((x) => typeof x === 'number') ? { value: v[0], rank: v[1], of: v[2] } : null;
  return { value: v };
}
function numbersIn(obj, out = new Set()) {
  if (typeof obj === 'number') {
    out.add(obj);
    out.add(Math.abs(obj));
    out.add(Math.round(obj * 10) / 10);
    out.add(Math.round(obj * 100) / 100);
    out.add(Math.round(obj));
    if (Math.abs(obj) < 1) out.add(Math.round(obj * 1000) / 10); // .363 -> 36.3%
  } else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) numbersIn(v, out);
  return out;
}
function check(report, dossier) {
  const problems = [];
  const all = [...(report.insights ?? []).flatMap((i) => i.evidence), ...(report.nextGame?.evidence ?? [])];
  for (const e of all) {
    e.resolved = resolve(dossier, e.path);
    if (!e.resolved) problems.push(`bad path: ${e.path}`);
  }
  if (!dossier.gameLog.some((g) => g.line[report.trend.stat] !== undefined)) problems.push(`trend stat not in the game log: ${report.trend.stat}`);
  // numbers in the prose that aren't in the dossier (nor a simple difference of two)
  const known = numbersIn(dossier);
  const prose = [report.headline, report.summary, ...report.insights.map((i) => i.body), report.nextGame?.body, report.nextGame?.watch, report.careerArc, report.outlook].join(' ');
  for (const m of prose.matchAll(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isInteger(n) && Math.abs(n) <= 20) continue; // counts, weeks, ranks: too common to check
    if (!known.has(n) && !known.has(Math.abs(n))) problems.push(`unmatched number: ${m[0]}`);
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

async function main() {
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
    return;
  }

  const filters = process.argv.slice(2).map((x) => x.toLowerCase());
  const picks = index.filter((p) => filters.some((f) => p.name.toLowerCase().includes(f)));
  if (!picks.length) throw new Error('no players match');
  let total = 0;
  const one = async (p) => {
    const dossier = load(p.gsis);
    const message = await client.messages.create(params(dossier));
    const out = save(p.gsis, dossier, message, false);
    total += out.cost;
    console.log(`${out.name}: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out, $${out.cost.toFixed(3)} (batched $${(out.cost / 2).toFixed(3)})${out.problems.length ? `\n  ${out.problems.join('\n  ')}` : ''}`);
  };
  for (let i = 0; i < picks.length; i += 4) await Promise.all(picks.slice(i, i + 4).map(one));
  console.log(`total $${total.toFixed(2)} live (batched about $${(total / 2).toFixed(2)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
