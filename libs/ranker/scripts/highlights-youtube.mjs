// The leagues' YouTube channels for highlights.mjs, spending the Data API's quota (10,000 units a day, free)
// sparingly: a channel's uploads paged through (playlistItems.list, 1 unit per 50 videos), each page kept in
// .cache/highlights/ so a later run reads only the new ones, the matched videos' lengths asked for 50 at a
// time (videos.list, 1 unit), and a search (search.list, 100 units) only for a game still missing, within a
// daily budget. The units spent are counted per day in .cache/highlights/units-<day>.json. The key is never
// printed: any URL logged has it cut out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CACHE = path.join(ROOT, '.cache/highlights');
const API = 'https://www.googleapis.com/youtube/v3';

// The leagues' own channels (each verified by its handle: @NFL, @NBA, @NHL); a channel's uploads playlist
// is its id with UU for UC
export const CHANNELS = { nfl: 'UCDVYQ4Zhbm3S2dlz7P1GBDg', nba: 'UCWJ2lWNubArHWmf3FIHbfcQ', nhl: 'UCqFMzb-4AUf6WAIbl132QKA' };
// (searches a day for each sport, at 100 units each)
export const SEARCH_BUDGET = 30;

const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};
export const redact = (s) => String(s).replace(/key=[^&\s"']+/g, 'key=REDACTED');

// The day's units, by sport and kind (Pacific time: the day YouTube's quota resets on)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const unitsFile = path.join(CACHE, `units-${today}.json`);
export const units = readJson(unitsFile, {});
function spend(sport, kind, n) {
  const s = (units[sport] ??= {});
  s[kind] = (s[kind] ?? 0) + n;
  writeJson(unitsFile, units);
}
export const spentToday = (sport, kind) => units[sport]?.[kind] ?? 0;

async function call(sport, kind, cost, url) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  spend(sport, kind, cost);
  try {
    const r = await fetch(`${url}&key=${encodeURIComponent(key)}`);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.warn(redact(`youtube ${kind} ${r.status}: ${url} ${body.slice(0, 200)}`));
      return null;
    }
    return await r.json();
  } catch (err) {
    console.warn(redact(`youtube ${kind} failed: ${url} ${err.message}`));
    return null;
  }
}

// The channel's uploads back to `since` (a Date): [{ id, title, published }], newest first. The kept pages
// are read first; the playlist is paged from its newest until it reaches videos already kept (when the kept
// ones go back far enough) or ones older than `since`.
export async function uploads(sport, since) {
  const channel = CHANNELS[sport];
  const file = path.join(CACHE, `uploads-${sport}.json`);
  const cache = readJson(file, { oldest: null, videos: {} });
  const covered = cache.oldest && Date.parse(cache.oldest) <= since.getTime();
  let token = '';
  let pages = 0;
  // (how far back this run reached, and whether it met videos kept before: the kept ones then join on)
  let reached = Infinity;
  let joined = false;
  for (;;) {
    const page = await call(sport, 'playlist', 1, `${API}/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=UU${channel.slice(2)}${token ? `&pageToken=${token}` : ''}`);
    if (!page) break;
    pages++;
    let known = false;
    for (const it of page.items ?? []) {
      const id = it.contentDetails?.videoId;
      const published = it.contentDetails?.videoPublishedAt;
      if (!id || !published) continue;
      if (cache.videos[id]) known = true;
      cache.videos[id] = [decode(it.snippet?.title ?? ''), published];
      reached = Math.min(reached, Date.parse(published));
    }
    joined ||= known;
    token = page.nextPageToken;
    if (!token || reached < since.getTime() || (known && covered)) break;
  }
  if (Number.isFinite(reached)) {
    const before = cache.oldest ? Date.parse(cache.oldest) : Infinity;
    cache.oldest = new Date(joined ? Math.min(before, reached) : reached).toISOString();
  }
  if (pages) writeJson(file, cache);
  if (!covered && cache.oldest && Date.parse(cache.oldest) > since.getTime()) console.warn(`${sport}: the channel's uploads reach back only to ${cache.oldest}`);
  return Object.entries(cache.videos)
    .map(([id, [title, published]]) => ({ id, title, published: Date.parse(published) }))
    .filter((v) => v.published >= since.getTime() && !/^(private|deleted) video$/i.test(v.title))
    .sort((a, b) => b.published - a.published);
}

// Videos' lengths in seconds, and whether they can be played on the site (videos.list, 50 ids a unit),
// kept in the cache so a video's asked for once
export async function details(sport, ids) {
  const file = path.join(CACHE, 'videos.json');
  const cache = readJson(file, {});
  const missing = [...new Set(ids)].filter((id) => !cache[id]);
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const r = await call(sport, 'videos', 1, `${API}/videos?part=contentDetails,status&id=${batch.join(',')}`);
    if (!r) break;
    for (const id of batch) cache[id] = { duration: null, embeddable: false };
    for (const v of r.items ?? []) cache[v.id] = { duration: isoSeconds(v.contentDetails?.duration), embeddable: v.status?.embeddable !== false && v.status?.privacyStatus !== 'private' };
  }
  if (missing.length) writeJson(file, cache);
  return cache;
}
const isoSeconds = (iso) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  return m ? ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60 + Number(m[4] ?? 0) : null;
};

// A search of the channel for one game (100 units), while the sport's day has budget left; [] once it hasn't
export async function search(sport, q, after, before) {
  if (spentToday(sport, 'search') + 100 > SEARCH_BUDGET * 100) return null;
  const r = await call(
    sport,
    'search',
    100,
    `${API}/search?part=snippet&type=video&maxResults=10&order=date&channelId=${CHANNELS[sport]}&publishedAfter=${after.toISOString()}&publishedBefore=${before.toISOString()}&q=${encodeURIComponent(q)}`,
  );
  return (r?.items ?? []).map((it) => ({ id: it.id?.videoId, title: decode(it.snippet?.title ?? ''), published: Date.parse(it.snippet?.publishedAt) })).filter((v) => v.id);
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
