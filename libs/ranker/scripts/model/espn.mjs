// ESPN's public site API, for the model desk: a league's teams, a team's season schedule, a day's scoreboard
// (its games, their scores and DraftKings' current lines). Free; asked politely, again after a refusal.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (sports-ranker model desk)' };

export async function json(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: HEADERS }).catch(() => null);
    if (res?.ok) return res.json();
    if (res?.status === 404) return null;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return null;
}

export const ymd = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');

export async function teamIds(league) {
  const body = await json(`${ESPN}/${league}/teams?limit=100`);
  return (body?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t) => t.team.id);
}

export async function teamSchedule(league, id, season, type) {
  return (await json(`${ESPN}/${league}/teams/${id}/schedule?season=${season}&seasontype=${type}`))?.events ?? [];
}

export async function scoreboard(league, day) {
  return (await json(`${ESPN}/${league}/scoreboard?dates=${day}&limit=200`))?.events ?? [];
}

// A schedule's or scoreboard's event as the desk keeps it: its id, when, which season and part of it (2 the
// regular season, 3 the playoffs), the two teams, a neutral site, and the final score once it's final
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
    final,
    hs: final ? score(home) : null,
    as: final ? score(away) : null,
  };
}

// A scoreboard event's DraftKings lines as prices: each side's moneyline, spread (its line and price) and the
// total (its line, the over's and the under's prices); null when the book hasn't posted
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
  return {
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
