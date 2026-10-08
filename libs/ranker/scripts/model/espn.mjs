// ESPN's public site API, for the model desk: a league's teams, a team's season schedule, a day's scoreboard
// (its games, their scores and DraftKings' current lines). Free; asked politely, again after a refusal.

import { get } from './sources.mjs';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

// (a URL's JSON: sources' get, four tries)
export const json = (url) => get(url);

export const ymd = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');

export async function teamIds(league) {
  const body = await json(`${ESPN}/${league}/teams?limit=100`);
  return (body?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t) => t.team.id);
}

// A league's teams with their names (ESPN's id, abbreviation, full name, nickname, place)
export async function teamNames(league) {
  const body = await json(`${ESPN}/${league}/teams?limit=100`);
  return (body?.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team: t }) => ({ id: t.id, abbr: t.abbreviation, name: t.displayName, nick: t.name, place: t.location }));
}

export async function teamSchedule(league, id, season, type) {
  return (await json(`${ESPN}/${league}/teams/${id}/schedule?season=${season}&seasontype=${type}`))?.events ?? [];
}

export async function scoreboard(league, day) {
  return (await json(`${ESPN}/${league}/scoreboard?dates=${day}&limit=200`))?.events ?? [];
}

// A schedule's or scoreboard's event as the desk keeps it: its id, when, which season and part of it (2 the
// regular season, 3 the playoffs), the two teams, a neutral site, where ("city|state|country", and whether
// it's indoors when ESPN says), and the final score once it's final
export function gameOf(e) {
  const c = e.competitions?.[0];
  const side = (where) => c?.competitors?.find((t) => t.homeAway === where);
  const home = side('home');
  const away = side('away');
  if (!c || !home || !away) return null;
  const score = (t) => {
    const v = t.score?.value ?? Number(t.score?.displayValue ?? t.score);
    return Number.isFinite(v) ? v : null;
  };
  const final = !!c.status?.type?.completed;
  return {
    id: e.id,
    date: e.date,
    season: e.season?.year ?? null,
    type: e.season?.type ?? e.seasonType?.type ?? null,
    home: home.team?.id ?? home.id,
    away: away.team?.id ?? away.id,
    homeAbbr: home.team?.abbreviation ?? '',
    awayAbbr: away.team?.abbreviation ?? '',
    neutral: !!c.neutralSite,
    ...(c.venue?.address?.city ? { venue: [c.venue.address.city, c.venue.address.state ?? '', c.venue.address.country ?? ''].join('|') } : {}),
    ...(typeof c.venue?.indoor === 'boolean' ? { indoor: c.venue.indoor } : {}),
    final,
    hs: final ? score(home) : null,
    as: final ? score(away) : null,
  };
}

// A scoreboard event's DraftKings lines as prices: each side's moneyline, spread (its line and price) and the
// total (its line, the over's and the under's prices); null when the book hasn't posted. And how far each has
// moved since it opened (move: the home spread's points, the total's points, the home side's fair chance)
export function linesOf(e) {
  const o = e.competitions?.[0]?.odds?.find((x) => x.moneyline || x.pointSpread || x.total);
  if (!o) return null;
  const price = (v) => {
    const n = Number(String(v ?? '').replace('+', ''));
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  const line = (v) => {
    const n = Number(String(v ?? '').replace(/^[ou]/, ''));
    return Number.isFinite(n) ? n : null;
  };
  const now = (x) => x?.close ?? x?.open ?? null;
  // (a line's move since it opened; null without both)
  const moved = (x) => {
    if (x?.open?.line === undefined || x?.close?.line === undefined) return null;
    const a = line(x.open.line);
    const b = line(x.close.line);
    return a !== null && b !== null ? Math.round((b - a) * 1000) / 1000 : null;
  };
  // (the home side's fair chance from a pair of moneylines)
  const fairHome = (h, a) => {
    const ph = price(h?.odds);
    const pa = price(a?.odds);
    if (!ph || !pa) return null;
    const imp = (v) => (v > 0 ? 100 / (v + 100) : -v / (-v + 100));
    return imp(ph) / (imp(ph) + imp(pa));
  };
  const mlOpen = fairHome(o.moneyline?.home?.open, o.moneyline?.away?.open);
  const mlNow = fairHome(now(o.moneyline?.home), now(o.moneyline?.away));
  return {
    move: {
      spread: moved(o.pointSpread?.home),
      total: moved(o.total?.over),
      ml: mlOpen !== null && mlNow !== null ? Math.round((mlNow - mlOpen) * 1000) / 1000 : null,
    },
    book: o.provider?.name ?? null,
    ml: { home: price(now(o.moneyline?.home)?.odds), away: price(now(o.moneyline?.away)?.odds) },
    spread: {
      home: { line: line(now(o.pointSpread?.home)?.line), odds: price(now(o.pointSpread?.home)?.odds) },
      away: { line: line(now(o.pointSpread?.away)?.line), odds: price(now(o.pointSpread?.away)?.odds) },
    },
    total: {
      line: line(now(o.total?.over)?.line) ?? (Number.isFinite(o.overUnder) ? o.overUnder : null),
      over: price(now(o.total?.over)?.odds),
      under: price(now(o.total?.under)?.odds),
    },
  };
}

// A game's summary (its box score: who played, and how much)
export async function summary(league, id) {
  return json(`${ESPN}/${league}/summary?event=${id}`);
}

// The league's injury report: each team's listed players (ESPN's athlete id, name, position, status)
export async function injuries(league) {
  const body = await json(`${ESPN}/${league}/injuries`);
  if (!body) return null;
  const out = new Map();
  for (const t of body.injuries ?? []) {
    out.set(
      String(t.id),
      (t.injuries ?? []).map((i) => ({
        id: i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ?? null,
        name: i.athlete?.displayName ?? '',
        pos: i.athlete?.position?.abbreviation ?? '',
        status: i.status ?? '',
      })),
    );
  }
  return out;
}
