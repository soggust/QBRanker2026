// The model desk's outside sources beyond ESPN's scoreboards: nflverse's schedule (quarterbacks, roofs,
// weather), MLB's StatsAPI (probable pitchers, their game logs, ballpark weather and coordinates), Open-Meteo
// (a place's coordinates, and the forecast there at a game's start). All free, no keys. Asked a few at a time,
// again after a refusal; anything slow kept under .cache/model (gitignored). A source that fails gives null,
// and whatever it fed is left neutral for that game.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
export const CACHE = path.join(ROOT, '.cache/model');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (sports-ranker model desk)' };

// A URL's body (JSON unless text), four tries, a pause after each refusal; null when it never comes
export async function get(url, { text = false } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30e3) }).catch(() => null);
    if (res?.ok) return (text ? res.text() : res.json()).catch(() => null);
    if (res?.status === 404 || res?.status === 400) return null;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return null;
}

// Every item through fn, a few at a time (polite), in order; an item that throws gives null
export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// A URL's text, kept in the cache for some hours (stale beats nothing when the source is down)
export async function cachedText(url, name, hours) {
  const file = path.join(CACHE, name);
  const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < hours * 36e5;
  if (fresh) return readFileSync(file, 'utf8');
  const body = await get(url, { text: true });
  if (body) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, body);
    return body;
  }
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

// A CSV's rows as objects by header (quoted fields may hold commas)
export function csv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// nflverse's schedule: every game since 1999 and the coming ones, with ESPN's id for each (refreshed every 6 hours)
export async function nflverseGames() {
  const text = await cachedText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', 'nflverse-games.csv', 6);
  return text ? csv(text) : [];
}

// MLB's schedule between two days: each game's probable pitchers, lineups (once posted), weather and ballpark
// (which one, where, which way it faces, its roof)
export async function mlbSchedule(from, to) {
  const body = await get(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R,F,D,L,W&startDate=${from}&endDate=${to}&hydrate=probablePitcher,lineups,weather,venue(location,fieldInfo),team`,
  );
  return body ? body.dates.flatMap((d) => d.games) : null;
}

// Pitchers' lines for a season, 40 to a call: a game log (each appearance) or the season's totals
export async function mlbPitching(ids, season, type) {
  const out = new Map();
  const batches = [];
  for (let i = 0; i < ids.length; i += 40) batches.push(ids.slice(i, i + 40));
  await pool(batches, 3, async (batch) => {
    const body = await get(`https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}&hydrate=stats(group=[pitching],type=[${type}],season=${season})`);
    for (const p of body?.people ?? []) out.set(String(p.id), { name: p.fullName, splits: p.stats?.[0]?.splits ?? [] });
  });
  return out;
}

// Players' hands, 100 to a call: how each bats (L, R or S: both) and throws, as two letters ("SR")
export async function mlbHands(ids) {
  const out = new Map();
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  await pool(batches, 3, async (batch) => {
    const body = await get(`https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}`);
    for (const p of body?.people ?? []) out.set(String(p.id), `${p.batSide?.code ?? 'R'}${p.pitchHand?.code ?? 'R'}`);
  });
  return out;
}

// A pitching line as the desk keeps it: outs, runs, earned runs, strikeouts, walks, hit batters, home runs
export const pitchLine = (s) => [s.outs ?? 0, s.runs ?? 0, s.earnedRuns ?? 0, s.strikeOuts ?? 0, s.baseOnBalls ?? 0, s.hitByPitch ?? 0, s.homeRuns ?? 0];

// (US states and Canadian provinces by their abbreviations, for matching a place's name to the right one)
const REGIONS = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', ON: 'Ontario', QC: 'Quebec', AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba',
};

// A place ("city|state|country", as ESPN's venues give it) as [latitude, longitude]: Open-Meteo's best match
// in that state or country, else its biggest by the name; null when nothing matches, undefined when the
// asking failed (so it's asked again next time)
export async function geocode(place) {
  const [city, state, country] = place.split('|');
  if (!city) return null;
  const body = await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`);
  if (!body) return undefined;
  const results = body.results ?? [];
  if (!results.length) return null;
  const region = (REGIONS[state] ?? state ?? '').toLowerCase();
  const nation = (country ?? '').toLowerCase().replace('usa', 'united states').replace('england', 'united kingdom');
  const hit =
    (region && results.find((r) => (r.admin1 ?? '').toLowerCase() === region)) ||
    (nation && results.find((r) => (r.country ?? '').toLowerCase() === nation)) ||
    [...results].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  return [Math.round(hit.latitude * 1e4) / 1e4, Math.round(hit.longitude * 1e4) / 1e4];
}

// The forecast at a place at a time: temperature (F), wind speed (mph) and where it blows from (degrees);
// null past the forecast's reach or when it fails
export async function forecast([lat, lon], when) {
  const day = when.slice(0, 10);
  const body = await get(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&start_date=${day}&end_date=${day}`,
  );
  const h = body?.hourly;
  if (!h?.time?.length) return null;
  const at = Math.min(23, new Date(when).getUTCHours());
  const temp = h.temperature_2m?.[at];
  const wind = h.wind_speed_10m?.[at];
  return Number.isFinite(temp) && Number.isFinite(wind) ? { temp: Math.round(temp), wind: Math.round(wind), from: h.wind_direction_10m?.[at] ?? null } : null;
}

// Miles between two [latitude, longitude] points (great circle)
export function miles(a, b) {
  if (!a || !b) return 0;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
