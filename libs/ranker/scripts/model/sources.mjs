// The model desk's outside sources beyond ESPN's scoreboards: nflverse's schedule (quarterbacks, roofs,
// weather), MLB's StatsAPI (probable pitchers, their game logs, ballpark weather and coordinates), Open-Meteo
// (a place's coordinates, and the forecast there at a game's start). All free, no keys. Asked a few at a time,
// again after a refusal; anything slow kept under .cache/model (gitignored). A source that fails gives null,
// and whatever it fed is left neutral for that game.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
export const CACHE = path.join(ROOT, '.cache/model');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (sports-ranker model desk)' };
// (a day in milliseconds; a time as UTC to the second, as The Odds API takes it: "2026-10-09T17:00:00Z")
export const DAY = 864e5;
export const isoSecond = (t) => new Date(t).toISOString().slice(0, 19) + 'Z';

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

// A JSON file's contents (fallback when it's missing or unreadable), and one written (its folder made)
export function readJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

// A time as its UTC day, "2026-10-08"
export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

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

// A CSV's rows as objects by header (quoted fields may hold commas; a row a line)
export function csv(text) {
  const [head, ...body] = text.split('\n').filter((l) => l.replace('\r', '')).map(splitCsvLine);
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// nflverse's schedule: every game since 1999 and the coming ones, with ESPN's id for each (refreshed every 6 hours)
export async function nflverseGames() {
  const text = await cachedText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', 'nflverse-games.csv', 6);
  return text ? csv(text) : [];
}

// MLB's schedule between two days: each game's probable pitchers, lineups (once posted), weather, ballpark
// (which one, where, which way it faces, its roof) and umpires
export async function mlbSchedule(from, to) {
  const body = await get(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R,F,D,L,W&startDate=${from}&endDate=${to}&hydrate=probablePitcher,lineups,weather,venue(location,fieldInfo),team,officials`,
  );
  return body ? body.dates.flatMap((d) => d.games) : null;
}

// Pitchers' lines for a season, 40 to a call: a game log (each appearance) or the season's totals
export async function mlbPitching(ids, season, type) {
  const out = new Map();
  for (const p of (await mlbPeople(ids, 40, `stats(group=[pitching],type=[${type}],season=${season})`)).people) out.set(String(p.id), { name: p.fullName, splits: p.stats?.[0]?.splits ?? [] });
  return out;
}

// StatsAPI's people, size to a call, three calls at a time (hydrate: what to bring with each): every one
// found, and how many calls failed of how many
export async function mlbPeople(ids, size, hydrate = null) {
  const batches = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  const people = [];
  let failed = 0;
  await pool(batches, 3, async (batch) => {
    const body = await get(`https://statsapi.mlb.com/api/v1/people?personIds=${batch.join(',')}${hydrate ? `&hydrate=${hydrate}` : ''}`);
    if (!body) failed++;
    people.push(...(body?.people ?? []));
  });
  return { people, failed, calls: batches.length };
}

// Players' hands, 100 to a call: how each bats (L, R or S: both) and throws, as two letters ("SR")
export async function mlbHands(ids) {
  return new Map((await mlbPeople(ids, 100)).people.map((p) => [String(p.id), `${p.batSide?.code ?? 'R'}${p.pitchHand?.code ?? 'R'}`]));
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

// ---------------------------------------------------------------------------
// The second round's sources: nflverse's plays and snap counts, MoneyPuck's expected goals, Open-Meteo's
// weather history and elevations, OpenStreetMap's fields (which way each runs)
// ---------------------------------------------------------------------------

// A gzipped nflverse file's rows, only the columns asked for (its plays are hundreds of columns wide): read
// from the site's own nflverse cache when it has the file fresh, else asked for and kept here
export async function nflverseRows(release, file, columns, hours = 12) {
  const shared = path.join(ROOT, '.cache/nflverse', file);
  const mine = path.join(CACHE, file);
  const fresh = (f) => existsSync(f) && Date.now() - statSync(f).mtimeMs < hours * 36e5;
  let buf = null;
  for (const f of [shared, mine]) if (!buf && fresh(f)) buf = readFileSync(f);
  if (!buf) {
    const res = await fetch(`https://github.com/nflverse/nflverse-data/releases/download/${release}/${file}`, { headers: HEADERS, signal: AbortSignal.timeout(120e3) }).catch(() => null);
    if (res?.ok) {
      buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(mine, buf);
    } else for (const f of [shared, mine]) if (!buf && existsSync(f)) buf = readFileSync(f);
  }
  if (!buf) return null;
  const text = file.endsWith('.gz') ? gunzipSync(buf).toString() : buf.toString();
  const lines = text.split('\n');
  const head = splitCsvLine(lines[0]);
  const at = columns.map((c) => head.indexOf(c));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = splitCsvLine(lines[i]);
    out.push(Object.fromEntries(columns.map((c, j) => [c, f[at[j]] ?? ''])));
  }
  return out;
}

// (one CSV line's fields, quotes honored)
function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') out.push(field), (field = '');
    else if (ch !== '\r') field += ch;
  }
  out.push(field);
  return out;
}

// MoneyPuck's games for a team and season (2025 is 2025-26): each game's expected goals for and against and
// its goals, all situations (a season over is kept for good, the current one for 12 hours)
export async function moneypuckGames(team, season, part, done) {
  const text = await cachedText(`https://moneypuck.com/moneypuck/playerData/teamGameByGame/${season}/${part}/${team}.csv`, `moneypuck-${season}-${part}-${team}.csv`, done ? 24 * 365 : 12);
  if (!text) return null;
  return csv(text)
    .filter((r) => r.situation === 'all')
    .map((r) => ({ date: r.gameDate, home: r.home_or_away === 'HOME', opp: r.opposingTeam, xgf: Number(r.xGoalsFor), xga: Number(r.xGoalsAgainst), gf: Number(r.goalsFor), ga: Number(r.goalsAgainst) }));
}

// Places' elevations (meters), 100 to a call
export async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const body = await get(`https://api.open-meteo.com/v1/elevation?latitude=${batch.map((p) => p[0]).join(',')}&longitude=${batch.map((p) => p[1]).join(',')}`);
    out.push(...(body?.elevation ?? batch.map(() => null)));
  }
  return out;
}

// The weather's history at a place, hour by hour between two days (wind and where it blew from, dew point,
// surface pressure, temperature), as a function of a time; null when the archive can't say
export async function weatherHistory([lat, lon], from, to) {
  const body = await get(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${to}&hourly=wind_direction_10m,wind_speed_10m,dew_point_2m,surface_pressure,temperature_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT`,
  );
  const h = body?.hourly;
  if (!h?.time?.length) return null;
  const start = Date.parse(h.time[0] + 'Z');
  return (when) => {
    const i = Math.round((Date.parse(when) - start) / 36e5);
    if (i < 0 || i >= h.time.length) return null;
    const v = { from: h.wind_direction_10m[i], wind: h.wind_speed_10m[i], dew: h.dew_point_2m[i], pressure: h.surface_pressure[i], temp: h.temperature_2m[i] };
    return Object.values(v).every((x) => x !== null && x !== undefined) ? v : null;
  };
}

// The forecast's air at a place at a time: temperature and dew point (F), surface pressure (hPa), wind (mph)
// and where it blows from
export async function forecastAir([lat, lon], when) {
  const day = when.slice(0, 10);
  const body = await get(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,dew_point_2m,surface_pressure,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&start_date=${day}&end_date=${day}`,
  );
  const h = body?.hourly;
  if (!h?.time?.length) return null;
  const at = Math.min(23, new Date(when).getUTCHours());
  const v = { temp: h.temperature_2m?.[at], dew: h.dew_point_2m?.[at], pressure: h.surface_pressure?.[at], wind: h.wind_speed_10m?.[at], from: h.wind_direction_10m?.[at] };
  return Object.values(v).every(Number.isFinite) ? v : null;
}

// Air's density (kg per cubic meter) from its temperature (F), dew point (F) and pressure (hPa): thinner air
// (warm, humid, high up) carries a ball farther
export function airDensity(tempF, dewF, hPa) {
  const T = ((tempF - 32) * 5) / 9 + 273.15;
  const td = ((dewF - 32) * 5) / 9;
  const e = 6.112 * Math.exp((17.67 * td) / (td + 243.5));
  return ((hPa - e) * 100) / (287.05 * T) + (e * 100) / (461.495 * T);
}

// Which way a football field runs (degrees, 0-180) at a stadium, from OpenStreetMap: the field (a pitch) in
// the stadium of that name near the place, its long side's bearing, and where it is; null when the map
// hasn't one, undefined when the asking failed
export async function fieldBearing(name, [lat, lon]) {
  // (a box half a degree each way: much cheaper for the map's server than a radius)
  const box = [lat - 0.5, lon - 0.5, lat + 0.5, lon + 0.5].map((v) => v.toFixed(3)).join(',');
  const q = `[out:json][timeout:25];(wr["leisure"="stadium"]["name"="${name.replace(/"/g, '')}"](${box});)->.s;.s out center tags;(way(around.s:150)["leisure"="pitch"];);out geom tags;`;
  let body = null;
  // (the main server, then a mirror)
  for (const server of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    if (body) break;
    const res = await fetch(server, {
      method: 'POST',
      headers: { 'User-Agent': 'sports-ranker-model-desk/1.0', 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
      body: `data=${encodeURIComponent(q)}`,
      signal: AbortSignal.timeout(30e3),
    }).catch(() => null);
    if (res?.ok) body = await res.json().catch(() => null);
  }
  if (!body) return undefined;
  const pitches = (body.elements ?? []).filter((e) => e.geometry?.length >= 4);
  const stadium = (body.elements ?? []).find((e) => e.center);
  if (!pitches.length || !stadium) return null;
  // (the field: the pitch nearest the stadium's middle; practice fields sit beside it)
  const mid = (g) => g.reduce((s, p) => [s[0] + p.lat / g.length, s[1] + p.lon / g.length], [0, 0]);
  const off = (e) => {
    const [a, b] = mid(e.geometry);
    return Math.hypot(a - stadium.center.lat, b - stadium.center.lon);
  };
  const g = [...pitches].sort((a, b) => off(a) - off(b))[0].geometry;
  let best = { len: 0, bearing: null };
  for (let i = 0; i < g.length - 1; i++) {
    const dy = g[i + 1].lat - g[i].lat;
    const dx = (g[i + 1].lon - g[i].lon) * Math.cos((g[i].lat * Math.PI) / 180);
    const len = Math.hypot(dx, dy);
    if (len > best.len) best = { len, bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 180 };
  }
  const c = mid(g);
  return { bearing: Math.round(best.bearing), at: [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4] };
}
