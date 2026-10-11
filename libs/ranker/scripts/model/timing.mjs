// The desk's timing (leagues.mjs TIMING): when a coming game's markets and props are bet, the news they wait
// for, and what each bet was priced on, so a bet whose inputs change before the start is priced again.
//
//   phaseOf      a game's phase for its lines or its props: early (before the window: nothing priced or bet),
//                open (in the window: bet once its news is in), last (inside the last chance: bet with whatever's
//                known, what's missing flagged, the minimum stake). The last chance is lastChance or, the runs
//                coming further apart than that (GitHub's hourly schedule runs hours late at times), 1.5 times
//                the recent gap between runs (cadenceOf), MAX_LAST hours at most: a game the next run would
//                likely see only after its start is bet now with what's known, not missed
//   cadenceOf    the median gap between the recent runs, in hours (run.mjs keeps their times in
//                .cache/model/runs.json); null with too few
//   newsMissing  the news a bet waits for that isn't in yet: the NHL's probable goalies (both: a skater's
//                projection weighs the other side's), MLB's probable starters (a game line both; a pitcher's
//                prop his own; a batter's the other side's) and posted lineups (a game line both: its platoon
//                terms read them; a batter's prop his own). The NFL and NBA wait for the window alone
//   inputsOf     a game's inputs as the bets on it were priced: each side's injury report (out, doubtful, on
//                IR or suspended; and questionable or day-to-day), the NFL's starting quarterbacks, the NHL's
//                probable goalies (and whether confirmed), MLB's probable starters and lineups. Each part's
//                text, and a short hash of it a bet keeps (ledger: inputs); a part that couldn't be read this run
//                (its source failed) is null, never taken for a change
//   propAsk      why The Odds API is asked for a game's props this run: its first ask, owed (its props taken
//                back and its board unpriced: the NFL's), near the start; or not at all
//   inputChanges what changed between a bet's inputs and the game's now: a part that's moved to a new value
//                (or read now where it was unread when the bet was placed: news it was priced without), not one
//                that's gone blank (a goalie, a lineup dropped from a source doesn't un-name him: more likely the
//                source than the news; but an MLB starter gone to none named, StatsAPI read, is the scratch
//                itself and counts), not a side's whole injury list gone empty in one run (a partial report is
//                likelier than everyone healed: it counts once a second run agrees) and not one unread now
//
// Not in the inputs (they'd churn, or a failed fetch would read as news): the weather's forecast, the flags
// (each starter's flag comes from the parts above), the rosters (a trade inside the window is rare)

import { createHash } from 'node:crypto';
import { TIMING } from './leagues.mjs';

const HOUR = 36e5;

// (the words for out and questionable, the props', the context's and the inputs' alike (one pattern, so they
// can't drift apart): ESPN's NBA and NHL reports say Day-To-Day where the NFL's says Questionable)
export const OUT_STATUS = /^out|doubtful|injured reserve|suspension/i;
export const Q_STATUS = /questionable|day-to-day|game-time/i;
const OUT = OUT_STATUS;
const QUESTIONABLE = Q_STATUS;

// (an open bet is priced again on news only this far ahead of its start (a run takes minutes, and a bet taken
// back that close might not be placed again in time); from then on it's locked, and the Bets page's picks are
// published then (picks.mjs), never earlier: a published pick is never one the news could still move)
export const REPRICE_BY = 20 * 60e3;
// (the most the last chance stretches to, in hours, however far apart the runs come)
export const MAX_LAST = 12;

// The median gap between the recent runs, in hours (times: their starts, ISO; the last 9, so 8 gaps), or null
// with fewer than 3
export function cadenceOf(times) {
  const t = (times ?? [])
    .map((x) => Date.parse(x))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .slice(-9);
  if (t.length < 3) return null;
  const gaps = t
    .slice(1)
    .map((x, i) => (x - t[i]) / HOUR)
    .sort((a, b) => a - b);
  const mid = gaps.length / 2;
  return gaps.length % 2 ? gaps[Math.floor(mid)] : (gaps[mid - 1] + gaps[mid]) / 2;
}

// (a sport's last chance, in hours: its own, or 1.5 times the runs' recent gap where that's longer, MAX_LAST at
// most)
export const lastChanceOf = (sport, gap = null) => Math.max(TIMING[sport]?.lastChance ?? 0, Math.min(MAX_LAST, Number.isFinite(gap) ? 1.5 * gap : 0));

// A game's phase for its lines or props, by the time till its start (ms); gap: the runs' recent gap, in hours
// (cadenceOf), which can stretch the last chance (and so the window)
export function phaseOf(sport, kind, until, gap = null) {
  const t = TIMING[sport];
  if (!t) return 'open';
  if (until <= lastChanceOf(sport, gap) * HOUR) return 'last';
  if (until <= t[kind] * HOUR) return 'open';
  return 'early';
}

// (the widest window, hours: how far ahead The Odds API is asked about)
export const reach = (sport) => Math.max(TIMING[sport]?.lines ?? 96, TIMING[sport]?.props ?? 96);

// Why The Odds API is asked for a game's props this run, or null: 'first' (never asked: its props are due),
// 'owed' (its props were taken back, on news or by --replace, and its board has no prices of its own (the
// NFL's): without a new ask they'd never be bet again; kept across runs till an ask succeeds), 'near' (within
// 2.5 hours of the start, once, with prop bets open or owed: their last line before the close). times: the
// asks so far; max: PROP_ASKS; until: ms to the start. A board with its own prices (NBA, NHL, MLB) prices its
// owed props on them, so its re-asks don't spend the allowance the NFL's first asks need
export function propAsk({ times, max, owed = false, boardPriced = false, nearAsked = false, until, open = 0 }) {
  if (times >= max) return null;
  if (times === 0) return 'first';
  if (owed && !boardPriced) return 'owed';
  if (!nearAsked && until < 2.5 * HOUR && (open > 0 || owed)) return 'near';
  return null;
}

// The news a game's bets still wait for: a list of what's missing ([] when it's in). kind: 'lines' or
// 'props'; for a prop, home (his side) and pitcher (an MLB pitcher's)
export function newsMissing(sport, live, { kind = 'lines', home = null, pitcher = false } = {}) {
  const out = [];
  const l = live ?? {};
  if (sport === 'nhl') {
    if (!l.home?.id || !l.away?.id) out.push('the probable goalies not listed');
  }
  if (sport === 'mlb') {
    const sp = [l.hp, l.ap];
    const lu = [l.lineups?.[0]?.length, l.lineups?.[1]?.length];
    if (kind === 'lines') {
      if (!sp[0] || !sp[1]) out.push('the starting pitchers not named');
      if (!lu[0] || !lu[1]) out.push('the lineups not posted');
    } else {
      const mine = home ? 0 : 1;
      if (pitcher && !sp[mine]) out.push('his start not announced');
      if (!pitcher && !sp[1 - mine]) out.push("the other side's starting pitcher not named");
      if (!pitcher && !lu[mine]) out.push('his lineup not posted');
    }
  }
  return out;
}

const hash = (s) => (s === null || s === undefined ? null : s === '' || s === '-' ? s : createHash('sha1').update(s).digest('hex').slice(0, 8));

// A game's inputs: { parts: { key: text or null }, hash: { key: short hash or null }, names: { id: name } }.
// live: its live facts (context.mjs gather); info: its context's info (starters); ok: which sources worked
// this run ({ nflverse, injuries, statsapi }: false, unread)
export function inputsOf(sport, game, live, info, ok = {}) {
  const parts = {};
  const names = {};
  const l = live ?? {};
  const sides = [
    ['h', game.home],
    ['a', game.away],
  ];
  if (sport !== 'mlb') {
    const report = ok.injuries === false || l.injuriesFailed ? null : (l.injuries ?? null);
    for (const [s, team] of sides) {
      const list = report ? (report.get(String(team)) ?? []) : null;
      const key = (p) => String(p.id ?? p.name);
      if (list) for (const p of list) names[key(p)] = p.name;
      parts[`out:${s}`] = list ? list.filter((p) => OUT.test(p.status)).map(key).sort().join(',') : null;
      parts[`q:${s}`] = list ? list.filter((p) => !OUT.test(p.status) && QUESTIONABLE.test(p.status)).map(key).sort().join(',') : null;
    }
  }
  if (sport === 'nfl') {
    const known = ok.nflverse !== false && !!l.row;
    const st = info?.starters;
    for (const [s, where] of [
      ['h', 'home'],
      ['a', 'away'],
    ]) {
      // (the quarterback the context priced: his name, or a backup unnamed; '-' when nflverse has none yet)
      const qb = st ? (st[where] ?? (st.backup?.[s === 'h' ? 0 : 1] ? 'a backup' : null)) : null;
      parts[`qb:${s}`] = known ? (qb ?? '-') : null;
    }
  }
  if (sport === 'nhl') {
    for (const [s, where] of [
      ['h', 'home'],
      ['a', 'away'],
    ]) {
      const g = l[where];
      if (g?.id) names[g.id] = g.name;
      parts[`g:${s}`] = g?.id ? `${g.id}${/confirmed/i.test(g.status ?? '') ? ' confirmed' : ''}` : '-';
    }
  }
  if (sport === 'mlb') {
    const known = ok.statsapi !== false && !!l.pk;
    for (const [s, i] of [
      ['h', 0],
      ['a', 1],
    ]) {
      const sp = i === 0 ? l.hp : l.ap;
      if (sp && l.names?.[i]) names[sp] = l.names[i];
      parts[`sp:${s}`] = known ? (sp ? String(sp) : '-') : null;
      parts[`lu:${s}`] = known ? (l.lineups?.[i]?.length ? l.lineups[i].join(',') : '-') : null;
    }
  }
  return { parts, hash: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, hash(v)])), names };
}

// (each part's words, for the changelog)
const WORDS = { out: 'out list', q: 'questionable list', qb: 'quarterback', g: 'goalie', sp: 'starting pitcher', lu: 'lineup' };

// What changed between a bet's inputs (hashes) and the game's now: [{ key, words }]; before: the game's
// parts as a run before saw them (the cache: the names who joined or left a list), when it has them
export function inputChanges(was, now, { game = null, before = null, names = {} } = {}) {
  if (!was || !now) return [];
  const out = [];
  // (a side's whole injury list gone empty since the run before, which had names on it: a partial report (one
  // team's entry dropped) is likelier than everyone healed, so it waits for a second run to agree)
  const vanished = (s) => !!before && now.parts?.[`out:${s}`] === '' && now.parts?.[`q:${s}`] === '' && !!(before[`out:${s}`] || before[`q:${s}`]);
  for (const [key, h] of Object.entries(now.hash)) {
    const then = was[key];
    const [kind, s] = key.split(':');
    // (an MLB starter gone to none named with StatsAPI read (unread, the part is null, not '-'): the scratch
    // itself, news)
    const scratched = kind === 'sp' && h === '-' && typeof then === 'string' && then !== '-';
    // (unread now, blank now, or not kept then (a bet from before the part was): not a change; unread then
    // and read now is: the news the bet was priced without)
    if (h === null || h === undefined || then === undefined || (h === '-' && !scratched) || h === then) continue;
    if ((kind === 'out' || kind === 'q') && vanished(s)) continue;
    const team = game ? (s === 'h' ? game.homeAbbr : game.awayAbbr) : s === 'h' ? 'home' : 'away';
    let detail = '';
    const prev = before?.[key];
    if ((kind === 'out' || kind === 'q') && typeof prev === 'string' && hash(prev) === then) {
      const a = new Set(prev ? prev.split(',') : []);
      const b = new Set(now.parts[key] ? now.parts[key].split(',') : []);
      const joined = [...b].filter((x) => !a.has(x)).map((x) => names[x] ?? x);
      const left = [...a].filter((x) => !b.has(x)).map((x) => names[x] ?? x);
      detail = [...joined.map((x) => `+${x}`), ...left.map((x) => `-${x}`)].join(', ');
    } else if (kind === 'qb') detail = now.parts[key];
    else if (scratched) detail = 'none named now';
    else if (kind === 'g' || kind === 'sp') {
      const [id, conf] = String(now.parts[key]).split(' ');
      detail = `${names[id] ?? id}${conf ? ' confirmed' : ''}`;
    } else if (kind === 'lu') detail = then === '-' || then === null ? 'posted' : 'changed';
    out.push({ key, words: `${team} ${WORDS[kind] ?? kind}${detail ? ` (${detail})` : ''}` });
  }
  return out;
}
