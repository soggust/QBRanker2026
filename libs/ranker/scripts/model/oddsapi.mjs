// The Odds API (the-odds-api.com, v4), for the model desk: game lines and player props from the desk's one
// book (BOOK, leagues.mjs: DraftKings) with its prices, Pinnacle's sharp line for the fair chance, and the
// past's lines for the backtest. Paid by the credit (20,000 a month), so every call is accounted for and
// budgeted:
//
//   cost   /odds: markets x regions; /events/{id}/odds: the markets it returns x regions; /historical/...: ten
//          times that. Up to 10 bookmakers named count as one region (the docs: "every group of 10 bookmakers
//          is the equivalent of 1 region"), so the desk names just its book and Pinnacle (one region's cost,
//          and Pinnacle sits in the eu region, which asking by region would add as a second) and never asks by
//          region
//   usage  each call's cost and the balance after it (the API's x-requests-last and x-requests-remaining) land
//          in .cache/model/odds-usage.json, by feature (lines, props, history); each sport's state gets a summary
//   budget the cycle is a month from its first call here (an assumption: the API resets on the plan's billing
//          day, which it doesn't say; a balance that jumps back up starts a new cycle early); 2,000 credits are
//          held back, history has its own 6,000 this cycle, and the rest is split a day at a time between lines
//          and props by what's left and the days left (lines the larger share: they're the last to be cut)
//   cuts   when credits run low: history first, then props, then lines; with none, or no key, or the API down,
//          the desk prices from ESPN's free board as before
//
// The key (ODDS_API_KEY: the repo's .env, or the workflow's secret) is never printed, logged or written: a URL
// is only ever shown with it taken out.

import path from 'node:path';
import { CACHE, readJson, writeJson } from './sources.mjs';
import { BOOK } from './leagues.mjs';

const API = 'https://api.the-odds-api.com/v4';
const USAGE = path.join(CACHE, 'odds-usage.json');
export const MONTHLY = 20000;
export const RESERVE = 2000;
export const HISTORY_BUDGET = 6000;
// (the daily split of what's left for the live features, after the reserve and history's share)
const SHARES = { lines: 0.3, props: 0.7 };

// The sports' keys, and the books: the desk's own (its prices are the ones it bets) and Pinnacle (its line, the
// vig taken out, is the fair chance); for props, the desk's book alone (Pinnacle's props are thin)
export const SPORT_KEYS = { nfl: 'americanfootball_nfl', nba: 'basketball_nba', nhl: 'icehockey_nhl', mlb: 'baseball_mlb' };
export const SHARP = 'pinnacle';
export const LINE_BOOKS = [BOOK, SHARP];
export const PROP_BOOKS = [BOOK];

// (a URL with its key taken out, for anything shown)
export const redact = (s) => String(s).replace(/apiKey=[^&\s"']+/gi, 'apiKey=***');

// (a --dry run, a check on the code, prices from ESPN's free board and spends nothing, unless --paid asks
// for The Odds API's lines too)
const DRY_FREE = process.argv.includes('--dry') && !process.argv.includes('--paid');
export const hasKey = () => !!process.env.ODDS_API_KEY && !DRY_FREE;

// The usage file: the cycle, the calls, the balance
function usage() {
  const u = readJson(USAGE, null) ?? { cycleStart: null, remaining: null, used: null, calls: [], features: {} };
  return u;
}
function saveUsage(u) {
  u.calls = u.calls.slice(-3000);
  writeJson(USAGE, u);
}

// (the cycle's start: the first call here, a month at a time after it)
function cycleOf(u, now = Date.now()) {
  if (!u.cycleStart) return null;
  let start = new Date(u.cycleStart);
  for (;;) {
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.getTime() > now) return { start, end: next };
    start = next;
  }
}

// What this cycle has spent, by feature, and what's left
export function budget(now = Date.now()) {
  const u = usage();
  const cycle = cycleOf(u, now);
  const spent = { lines: 0, props: 0, history: 0, other: 0 };
  const today = { lines: 0, props: 0, history: 0, other: 0 };
  const day = new Date(now).toISOString().slice(0, 10);
  for (const c of u.calls) {
    if (cycle && Date.parse(c.at) < cycle.start.getTime()) continue;
    spent[c.feature] = (spent[c.feature] ?? 0) + c.cost;
    if (c.at.slice(0, 10) === day) today[c.feature] = (today[c.feature] ?? 0) + c.cost;
  }
  const remaining = u.remaining ?? MONTHLY;
  const daysLeft = cycle ? Math.max(1, Math.ceil((cycle.end.getTime() - now) / 864e5)) : 30;
  // (what the live features may spend today: what's left past the reserve and history's unspent share, over
  // the days left, split by share)
  const historyLeft = Math.max(0, HISTORY_BUDGET - spent.history);
  const free = Math.max(0, remaining - RESERVE - historyLeft);
  const allowance = Object.fromEntries(Object.entries(SHARES).map(([f, s]) => [f, Math.floor((free * s) / daysLeft)]));
  return {
    cycleStart: cycle?.start.toISOString() ?? null,
    cycleEnd: cycle?.end.toISOString() ?? null,
    daysLeft,
    remaining,
    used: u.used,
    spent,
    today,
    allowance,
    historyLeft: Math.min(historyLeft, Math.max(0, remaining - RESERVE)),
  };
}

// Whether a feature may spend cost credits now: history from its own budget, while the reserve holds; lines and
// props from today's allowance (cut in that order as credits run low: history, props, lines)
export function canSpend(feature, cost) {
  if (!hasKey()) return false;
  const b = budget();
  if (b.remaining - cost < RESERVE) return false;
  if (feature === 'history') return b.historyLeft >= cost;
  return (b.today[feature] ?? 0) + cost <= (b.allowance[feature] ?? 0);
}

// A call: the JSON body (null on any failure, the reason shown with the key taken out), its cost and the
// balance recorded under the feature
export async function call(feature, route, params = {}) {
  if (!hasKey()) return null;
  const query = new URLSearchParams({ ...params, apiKey: process.env.ODDS_API_KEY });
  const url = `${API}${route}?${query}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res = null;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30e3) });
    } catch (err) {
      console.warn(`odds api: ${redact(route)} failed (${redact(err?.message ?? err)})`);
    }
    if (res) {
      const last = Number(res.headers.get('x-requests-last') ?? 0);
      const remaining = res.headers.get('x-requests-remaining');
      const used = res.headers.get('x-requests-used');
      record(feature, route, last, remaining === null ? null : Number(remaining), used === null ? null : Number(used));
      if (res.ok) return res.json().catch(() => null);
      if (res.status === 401 || res.status === 422 || res.status === 404) {
        console.warn(`odds api: ${redact(route)} refused (${res.status})`);
        return null;
      }
      // (429: too many at once, or out of credits; 5xx: try again shortly)
      if (res.status === 429 && remaining !== null && Number(remaining) <= 0) return null;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return null;
}

// (a call's cost and the balance after it; a balance that's grown back starts a new cycle)
function record(feature, route, cost, remaining, used) {
  const u = usage();
  const at = new Date().toISOString();
  if (!u.cycleStart || (u.remaining !== null && remaining !== null && remaining > u.remaining + 1000)) u.cycleStart = at;
  if (remaining !== null) u.remaining = remaining;
  if (used !== null) u.used = used;
  u.calls.push({ at, feature, route: route.replace(/\/events\/[^/]+\//, '/events/{id}/'), cost });
  saveUsage(u);
}

// The summary a sport's state shows: the cycle, what's spent by feature and today, the allowance
export function usageSummary() {
  const b = budget();
  return { monthly: MONTHLY, reserve: RESERVE, historyBudget: HISTORY_BUDGET, ...b, assumed: 'the cycle runs a month from the first call (the API resets monthly; its day is assumed)' };
}

// ---------------------------------------------------------------------------
// Reading what comes back: an event's books' prices, the best US price and the fair chance for each market
// ---------------------------------------------------------------------------

// American odds from decimal
export const american = (dec) => (dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)));
const implied = (american_) => (american_ > 0 ? 100 / (american_ + 100) : -american_ / (-american_ + 100));
// (both sides' fair chances from a pair of prices: the vig taken out)
const devig = (a, b) => {
  const x = implied(a);
  const y = implied(b);
  return [x / (x + y), y / (x + y)];
};

// An event's game lines as the desk prices them: for each market, the desk's book's line and both sides'
// prices there, and the fair chance of the home (or over) side: Pinnacle's at that same line, the vig taken
// out, when it posts it; else the desk's book's own, de-vigged (both kept: the backtest compares them)
export function linesFromEvent(ev) {
  const book = (ev.bookmakers ?? []).find((b) => b.key === BOOK);
  const sharp = (ev.bookmakers ?? []).find((b) => b.key === SHARP);
  if (!book) return null;
  const sideOf = (m, o) => (m.key === 'totals' ? o.name.toLowerCase() : o.name === ev.home_team ? 'home' : 'away');
  // (a market's two sides: each one's line (a spread's is its own side's) and price)
  const read = (b, key) => {
    const m = b?.markets?.find((x) => x.key === key);
    if (!m) return null;
    const out = {};
    for (const o of m.outcomes ?? []) out[sideOf(m, o)] = { line: o.point ?? null, odds: american(o.price) };
    return out;
  };
  const out = { book: BOOK };
  for (const key of ['h2h', 'spreads', 'totals']) {
    const mine = read(book, key);
    const sides = key === 'totals' ? ['over', 'under'] : ['home', 'away'];
    if (!mine?.[sides[0]] || !mine?.[sides[1]]) continue;
    const own = devig(mine[sides[0]].odds, mine[sides[1]].odds)[0];
    const theirs = read(sharp, key);
    const same = theirs?.[sides[0]] && theirs?.[sides[1]] && theirs[sides[0]].line === mine[sides[0]].line;
    const pin = same ? devig(theirs[sides[0]].odds, theirs[sides[1]].odds)[0] : null;
    out[key] = { line: mine[sides[0]].line, prices: Object.fromEntries(sides.map((s) => [s, mine[s].odds])), fair: pin ?? own, own, sharp: pin };
  }
  return out;
}
