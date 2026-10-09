// Every pro MMA fight ESPN has, across the promotions it covers: the UFC (1997 on), PRIDE, WEC,
// Strikeforce, Bellator, the PFL (and the WSOF before it), Rizin, KSW, Cage Warriors, LFA, DREAM, Shooto,
// Pancrase, K-1 HERO'S, M-1, Affliction, the IFL and EliteXC. Kept in
// scripts/fights/<promotion>/<year>.json, one row a fight; a finished year is fetched once and kept, so a
// night's update only refetches this year's scoreboards. Each fight's method (ESPN's core API: KO/TKO,
// submission, unanimous / split / majority decision, draw...) is fetched once, when the fight is first seen.
//
// A fight: { id, league, event, date, division, rounds (scheduled), period, clock (seconds into the last
// round), method, fighters: [{ id, name, winner }, ...] }
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fetchRetry } from '../../../libs/ranker/scripts/fetch.mjs';

const DIR = path.join(import.meta.dirname, 'fights');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/mma';
const CORE = 'https://sports.core.api.espn.com/v2/sports/mma/leagues';

// ESPN's MMA promotions, and the years each has fights in
export const LEAGUES = {
  ufc: [1997, null],
  pride: [1997, 2007],
  wec: [2001, 2010],
  strikeforce: [2006, 2013],
  bellator: [2009, null],
  pfl: [2012, null],
  rizin: [2015, null],
  ksw: [2004, null],
  'cage-warriors': [2002, null],
  lfa: [2017, null],
  // (Japan's and Russia's big shows, and the short-lived American ones between the UFC's eras)
  dream: [2008, 2012],
  'shooto-japan': [1997, null],
  pancrase: [1997, null],
  k1: [1997, 2010],
  m1: [1997, null],
  affliction: [2008, 2009],
  ifl: [2006, 2009],
  proelite: [2007, 2014],
};

// ESPN's methods (its slugs, "kotko", "decision---split", "submission-rear-naked-choke", "tko---doctor's
// stoppage"... or a code already kept) -> short codes
export function methodCode(name) {
  const m = String(name ?? '').toLowerCase();
  if (/^(kotko|ko|tko)($|-)/.test(m)) return 'KO';
  if (/^(sub|submission|technical-su)/.test(m)) return 'SUB';
  if (/^(ud|unanimous|decision---u)/.test(m)) return 'UD';
  if (/^(sd|split|decision---s)/.test(m)) return 'SD';
  if (/^(majority-dra|draw)/.test(m)) return 'DRAW';
  if (/^(md|majority|decision---m)/.test(m)) return 'MD';
  if (/^(dq|disqualification)/.test(m)) return 'DQ';
  if (/^(nc|no-contest|nocontest|overturned|could-not-co|match-cancel)/.test(m)) return 'NC';
  if (/^(dec|decision|technical-de)/.test(m)) return 'DEC';
  return m ? m.toUpperCase().slice(0, 12) : '?';
}

// A polite pace (several requests in flight, a few a second each), with retries (libs/ranker/scripts/fetch.mjs;
// a 404: null)
let gate = Promise.resolve();
async function get(url) {
  const turn = gate.then(() => new Promise((r) => setTimeout(r, 40)));
  gate = turn;
  await turn;
  return fetchRetry(url, { as: 'json', headers: { 'User-Agent': 'Mozilla/5.0 (sports-ranker data script)' }, attempts: 4, backoff: 2000, notFound: null });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// A year of a promotion's fights from its scoreboard (methods filled in from what's kept, or fetched)
async function yearOf(league, year, kept) {
  const board = await get(`${SITE}/${league}/scoreboard?dates=${year}&limit=1000`);
  const known = new Map(kept.map((f) => [f.id, f]));
  const out = [];
  const pending = [];
  for (const event of board?.events ?? []) {
    for (const c of event.competitions ?? []) {
      if (!c.status?.type?.completed || c.competitors?.length !== 2) continue;
      const fight = {
        id: c.id,
        league,
        event: event.name,
        eventId: event.id,
        date: (c.date ?? event.date).slice(0, 10),
        division: c.type?.abbreviation ?? c.type?.text ?? '',
        rounds: c.format?.regulation?.periods ?? 3,
        period: c.status.period ?? null,
        clock: c.status.clock ?? null,
        method: known.get(c.id)?.method ?? null,
        fighters: c.competitors.map((p) => ({ id: String(p.id), name: p.athlete?.displayName ?? '', winner: !!p.winner })),
      };
      if (!fight.method) pending.push(fight);
      out.push(fight);
    }
  }
  // (the methods, a few at a time)
  for (let i = 0; i < pending.length; i += 16) {
    await Promise.all(
      pending.slice(i, i + 16).map(async (fight) => {
        const status = await get(`${CORE}/${league}/events/${fight.eventId}/competitions/${fight.id}/status`).catch(() => null);
        const name = status?.result?.name ?? '';
        fight.method = methodCode(name);
      }),
    );
  }
  for (const f of out) delete f.eventId;
  // (a scoreboard that came back with nothing (a 404, or no events) where fights were kept: the kept year,
  // not an empty one written over it)
  if (!out.length && kept.length) {
    console.warn(`${league} ${year}: the scoreboard came back empty, the ${kept.length} fights kept stand`);
    return kept;
  }
  return out;
}

// Every fight, oldest first. A finished year already kept isn't fetched again (refresh: refetch every
// year this many years back from this one, to catch late corrections).
export async function allFights({ refresh = 1, log = console.log } = {}) {
  const thisYear = new Date().getUTCFullYear();
  const fights = [];
  for (const [league, [first, last]] of Object.entries(LEAGUES)) {
    let fetched = 0;
    for (let year = first; year <= (last ?? thisYear); year++) {
      const file = path.join(DIR, league, `${year}.json`);
      const kept = await readJson(file, null);
      const stale = !kept || year > thisYear - refresh || kept.some((f) => !f.method || f.method === '?');
      const rows = stale ? await yearOf(league, year, kept ?? []) : kept;
      if (stale) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(rows));
        fetched++;
      }
      for (const row of rows) row.method = methodCode(row.method);
      fights.push(...rows);
    }
    log(`${league}: ${fights.filter((f) => f.league === league).length} fights (${fetched} years fetched)`);
  }
  // (a fight can be listed by two promotions' scoreboards, a co-promoted card: kept once)
  const seen = new Set();
  return fights
    .filter((f) => !seen.has(f.id) && seen.add(f.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// Run on its own: fetch (or update) the archive
if (process.argv[1]?.endsWith('fights.mjs')) {
  const fights = await allFights();
  const methods = {};
  for (const f of fights) methods[f.method] = (methods[f.method] ?? 0) + 1;
  console.log(`${fights.length} fights`, methods);
}

// The archive as kept, without fetching (the backtest and tools)
export async function keptFights() {
  const fights = [];
  for (const league of Object.keys(LEAGUES)) {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(path.join(DIR, league)).catch(() => []);
    for (const file of files) fights.push(...(await readJson(path.join(DIR, league, file), [])).map((f) => ({ ...f, method: methodCode(f.method) })));
  }
  const seen = new Set();
  return fights
    .filter((f) => !seen.has(f.id) && seen.add(f.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
