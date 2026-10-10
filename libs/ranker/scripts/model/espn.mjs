// ESPN's public site API, for the model desk: a league's teams, a team's season schedule, a day's scoreboard
// (its games, their scores and DraftKings' current lines). Free; asked politely, again after a refusal.

import { get } from './sources.mjs';
import { BOOK } from './leagues.mjs';

// (ESPN's id for each book it carries lines from, on its core API)
export const ESPN_PROVIDER = { draftkings: 100 };

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
// it's indoors when ESPN says), and the final score once it's final. innings (MLB's): a final shortened, called
// before 9 innings (8 and a half with the home side ahead), is marked short (the innings it went: 6.5 is six
// and a half), its run line and total void (desk.mjs settle)
export function gameOf(e, { innings = false } = {}) {
  const c = e.competitions?.[0];
  const side = (where) => c?.competitors?.find((t) => t.homeAway === where);
  const home = side('home');
  const away = side('away');
  if (!c || !home || !away) return null;
  const score = (t) => {
    const v = t.score?.value ?? Number(t.score?.displayValue ?? t.score);
    return Number.isFinite(v) ? v : null;
  };
  // (a game called off is never final, whatever ESPN's flag: its 0-0 would grade its bets; it's kept as off,
  // postponed, suspended, canceled or forfeit, for its bets' void: desk.mjs voidOf)
  const called = (c.status?.type?.name ?? '').match(/postponed|cancel|suspended|forfeit/i)?.[0].toLowerCase();
  const off = called === 'cancel' ? 'canceled' : (called ?? null);
  const final = !!c.status?.type?.completed && !off;
  const short = innings && final ? shortOf(home, away, c.status?.period) : null;
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
    ...(off ? { off } : {}),
    hs: final ? score(home) : null,
    as: final ? score(away) : null,
    ...(short ? { short } : {}),
  };
}

// (an MLB final's innings when it was cut short, else null: by the two sides' line scores (the away side's
// count the innings begun, the home side's one fewer when it didn't bat in the last), else ESPN's period)
export function shortOf(home, away, period) {
  const a = away?.linescores?.length ?? 0;
  const h = home?.linescores?.length ?? 0;
  const hs = Number(home?.score?.value ?? home?.score);
  const as = Number(away?.score?.value ?? away?.score);
  if (a) {
    if (a >= 9 && (h >= 9 || hs > as)) return null;
    return h >= a ? a : a - 0.5;
  }
  return Number.isFinite(period) && period > 0 && period < 9 ? period : null;
}

// A scoreboard event's DraftKings lines as prices: each side's moneyline, spread (its line and price) and the
// total (its line, the over's and the under's prices); null when the book hasn't posted. And how far each has
// moved since it opened (move: the home spread's points, the total's points, the home side's fair chance)
export function linesOf(e) {
  // (the desk's book's lines only: BOOK, leagues.mjs)
  const o = e.competitions?.[0]?.odds?.find((x) => (x.moneyline || x.pointSpread || x.total) && String(x.provider?.name ?? '').toLowerCase().replace(/\s/g, '') === BOOK);
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

// An NHL side's goalies (a summary's goalies table: its athletes) in the order they went in, the starter
// first. ESPN lists the one in net at the end first (a pulled starter after his reliever), so its list read
// backwards; the game's story, when it says who came on in relief or who was pulled or replaced, decides
// instead (a story that says both ways, or names neither, leaves ESPN's order)
export function goaliesInOrder(athletes, story = '') {
  const list = [...(athletes ?? [])].reverse();
  if (list.length !== 2) return list;
  const sentences = String(story ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/);
  const lastOf = (a) => String(a?.athlete?.displayName ?? '').trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).at(-1) ?? '';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const says = (a, res) => {
    const last = lastOf(a);
    return last.length >= 3 && sentences.some((s) => s.includes(last) && res(esc(last)).some((re) => re.test(s)));
  };
  // (the one who came on: "... in relief", "replaced by (first) Last", "Last ... entering/came on/took over")
  const relieved = (L) => [new RegExp(`${L}[^.]*\\bin relief`), new RegExp(`replaced by (?:[^\\s.]+ )?${L}\\b`), new RegExp(`${L}\\b[^.]*\\b(?:entering|entered|came on|came in|took over)\\b`)];
  // (the one who went out: "Last ... pulled/replaced/chased", "pulled/replace/relieved (first) Last")
  const pulled = (L) => [new RegExp(`${L}\\b[^.]*\\b(?:was|getting|being|got) (?:pulled|replaced|chased|yanked)\\b`), new RegExp(`\\b(?:pulled|replace|replaced|relieved|chased|yanked) (?!by\\b)(?:[^\\s.]+ )?${L}\\b`)];
  const score = (a) => (says(a, pulled) ? 1 : 0) - (says(a, relieved) ? 1 : 0);
  const [x, y] = list;
  const sx = score(x);
  const sy = score(y);
  if (sy > 0 && sx <= 0) return [y, x];
  if (sx > 0 && sy <= 0) return list;
  if (sx < 0 && sy >= 0) return [y, x];
  return list;
}

// One game by its id as a scoreboard event (its summary's header): a game bet on that a run's scoreboards no
// longer show, moved off its day; null when ESPN doesn't say
export async function eventOf(league, id) {
  const h = (await summary(league, id))?.header;
  const c = h?.competitions?.[0];
  return c ? { ...h, date: c.date, status: c.status } : null;
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
