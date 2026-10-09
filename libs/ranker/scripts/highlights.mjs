// The game view's highlights, kept for the season (ESPN keeps a game's videos only a few days, and has none
// of the NFL's): StaticData/highlights/<season>.json, { ESPN event id: [{ title, src, youtube, thumb,
// duration }] }, read by the site's game view (libs/ranker/src/engine/game-view/highlights.ts). The season
// is ESPN's for the game (the NBA's and the NHL's by the year they end), its playoffs in the same file.
//
//   node libs/ranker/scripts/highlights.mjs <sport> [days] [--since=YYYY-MM-DD]
//
// The finished games not kept yet, from `since` (a season's start, to fill one in) or the last few days (10
// unless given), each from the first of these that has the game's:
//   1. ESPN's videos in the game's summary (the NBA's and the NHL's; asked for only for the last few days'
//      games, all ESPN keeps), the game's highlights first;
//   2. the league's YouTube channel's uploads (highlights-youtube.mjs: paged through for a unit per 50
//      videos, kept in .cache/highlights so a later run reads only the new ones): the videos naming both
//      teams, put up within a couple of days of the game, its full highlights first;
//   3. a search of the channel for the game (100 units), for a game of the last few days still missing,
//      within a daily budget (SEARCH_BUDGET a sport); once that's spent the game waits for tomorrow.
// With no YOUTUBE_API_KEY, the channel's feed (its latest uploads; free) stands in for 2 and there's no 3.
// MLB's need none of this: the site asks MLB's own API, any game, any season.

// (the keys: .env on this machine, the repo's secrets on GitHub)
import './env.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHANNELS, details, search, spentToday, units, uploads } from './highlights-youtube.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const LEAGUES = { nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const UA = { 'User-Agent': 'Mozilla/5.0 (sports-ranker highlights)' };
const DAY = 864e5;
// (a video counts for a game put up within this long of its start; a search only for a game this recent)
const AFTER = 2.5 * DAY;
const SEARCH_WITHIN = 4 * DAY;
// (the clips kept for a game)
const CLIPS = 4;

const args = process.argv.slice(2);
const sport = args[0];
const sinceArg = args.find((a) => a.startsWith('--since='))?.slice(8);
const days = Number(args.slice(1).find((a) => !a.startsWith('--')) ?? 10);
const league = LEAGUES[sport];
if (!league) throw new Error(`usage: highlights.mjs <${Object.keys(LEAGUES).join('|')}> [days] [--since=YYYY-MM-DD]`);
const now = Date.now();
const recent = new Date(now - days * DAY);
const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : recent;
if (Number.isNaN(since.getTime())) throw new Error(`--since: not a date: ${sinceArg}`);

const dir = path.join(ROOT, 'apps', sport, 'src/StaticData/highlights');
// (each season's file, by ESPN's season year for the game: the one the game view looks in)
const files = new Map();
const fileFor = (season) => {
  if (!files.has(season)) {
    const file = path.join(dir, `${season}.json`);
    files.set(season, { file, kept: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}, added: 0, from: { espn: 0, channel: 0, search: 0 } });
  }
  return files.get(season);
};
const keep = (g, videos, how) => {
  const f = fileFor(g.season);
  f.kept[g.id] = videos;
  f.added++;
  f.from[how]++;
};
const isKept = (g) => !!fileFor(g.season).kept[g.id]?.length;

const json = (url) => fetch(url, { headers: UA }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// Every finished game since then, each with its teams' names (for matching a video's title): ESPN's
// scoreboard a day at a time, a few days at once
const dates = [];
for (let t = Date.parse(since.toISOString().slice(0, 10)); t <= now; t += DAY) dates.push(ymd(new Date(t)));
const games = [];
const seen = new Set();
for (let i = 0; i < dates.length; i += 8) {
  const boards = await Promise.all(dates.slice(i, i + 8).map((d) => json(`${ESPN}/${league}/scoreboard?dates=${d}`)));
  for (const e of boards.flatMap((b) => b?.events ?? [])) {
    const c = e.competitions?.[0];
    if (!c?.status?.type?.completed || seen.has(e.id)) continue;
    seen.add(e.id);
    const teams = (c.competitors ?? []).map((t) => ({
      home: t.homeAway === 'home',
      full: t.team?.displayName ?? '',
      names: [...new Set([t.team?.name, t.team?.shortDisplayName].filter(Boolean).map((n) => n.toLowerCase()))],
    }));
    games.push({ id: e.id, season: e.season?.year ?? new Date(e.date).getFullYear(), start: Date.parse(e.date), teams });
  }
}

// 1. ESPN's: the videos in each recent game's summary, the game's highlights first
if (sport !== 'mlb') {
  for (const g of games.filter((x) => !isKept(x) && x.start >= recent.getTime() - DAY)) {
    const s = await json(`${ESPN}/${league}/summary?event=${g.id}`);
    const videos = (s?.videos ?? [])
      .filter((v) => v.links?.source?.href)
      .map((v) => ({ title: v.headline ?? '', src: v.links.source.href, youtube: null, thumb: v.thumbnail ?? null, duration: v.duration ?? null }))
      .sort((a, b) => Number(/highlights/i.test(b.title)) - Number(/highlights/i.test(a.title)))
      .slice(0, 8);
    if (videos.length) keep(g, videos, 'espn');
  }
}

// A video's title naming both of a game's teams (whole words: the Nets aren't the Hornets), and not a
// preview, a press conference or the French broadcast's
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRes = new Map();
const nameRe = (n) => {
  if (!nameRes.has(n)) nameRes.set(n, new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, 'iu'));
  return nameRes.get(n);
};
const NOT = /preview|press conference|presser|pregame|postgame|podcast|picks|predict|faits saillants|interview|reaction|mic'?d up|trailer|watch party|all[- ]access|\bdraft\b|\blive\b|ranking|every highlight|endings\b/i;
const names = (title, g) => !NOT.test(title) && g.teams.length === 2 && g.teams.every((t) => t.names.some((n) => nameRe(n).test(title)));
// (the game's full highlights first, then any highlights, then the other clips)
const rank = (title) => (/full game.*highlights|game highlights|\b(nhl|nba|nfl) highlights|condensed/i.test(title) ? 3 : /highlights|recap/i.test(title) ? 2 : 1);

// The day a title gives ("Oct 7, 2026", "October 7, 2026"), as YYYY-MM-DD, if it gives one
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const titleDay = (title) => {
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2}),? (20\d\d)\b/i.exec(title);
  return m ? `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};
// (a game's day in New York, and the day after: a game abroad is dated where it's played)
const gameDays = (g) => [0, DAY].map((d) => new Date(g.start + d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));

// The videos found for each game: each video given to a game it names that had begun when it went up (on
// the day its title gives, when it gives one): one that has no video as good yet first (a split squad's two
// games, the same two teams, get one each), then the latest
async function matchVideos(videos, pool) {
  const found = new Map();
  const best = new Map();
  const leftover = [];
  for (const v of [...videos].sort((a, b) => a.published - b.published)) {
    const day = titleDay(v.title);
    const r = rank(v.title);
    const g = pool
      .filter((x) => x.start <= v.published && v.published <= x.start + AFTER && names(v.title, x) && (!day || gameDays(x).includes(day)))
      .sort((a, b) => Number(day === gameDays(b)[0]) - Number(day === gameDays(a)[0]) || Number((best.get(a) ?? 0) >= r) - Number((best.get(b) ?? 0) >= r) || b.start - a.start)[0];
    if (!g) {
      if (r === 3 && day) leftover.push(v);
      continue;
    }
    found.set(g, [...(found.get(g) ?? []), v]);
    best.set(g, Math.max(best.get(g) ?? 0, r));
  }
  // (a game's full highlights with a slip in the title, "MAGIC at HAWKS" for the Magic at the Heat or
  // "GRIZZLES": one team named right, on the day the title gives, the only game that fits still without any)
  for (const v of leftover) {
    const day = titleDay(v.title);
    const fits = pool.filter(
      (x) => !found.has(x) && !isKept(x) && !NOT.test(v.title) && x.start <= v.published && v.published <= x.start + AFTER && gameDays(x).includes(day) && x.teams.some((t) => t.names.some((n) => nameRe(n).test(v.title))),
    );
    if (fits.length === 1) found.set(fits[0], [v]);
  }
  // (their lengths, and the ones that won't play embedded or are only Shorts left out)
  const info = process.env.YOUTUBE_API_KEY ? await details(sport, [...found.values()].flat().map((v) => v.id)) : {};
  const out = new Map();
  for (const [g, list] of found) {
    const clips = list
      .map((v) => ({ ...v, duration: info[v.id]?.duration ?? null, ok: info[v.id]?.embeddable ?? true }))
      .filter((v) => v.ok && !(v.duration != null && v.duration < 60 && rank(v.title) < 3))
      .sort((a, b) => rank(b.title) - rank(a.title) || a.published - b.published)
      .slice(0, CLIPS)
      .map((v) => ({ title: v.title, src: null, youtube: v.id, thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, duration: v.duration }));
    if (clips.length) out.set(g, clips);
  }
  return out;
}

const key = process.env.YOUTUBE_API_KEY;
if (CHANNELS[sport] && games.some((g) => !isKept(g))) {
  // 2. the channel's uploads (or, with no key, its feed's latest)
  const missing = games.filter((g) => !isKept(g));
  const oldest = Math.min(...missing.map((g) => g.start));
  let videos;
  if (key) {
    videos = await uploads(sport, new Date(oldest));
  } else {
    const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNELS[sport]}`, { headers: UA }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
    videos = [...feed.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<published>([^<]+)<\/published>/g)].map((m) => ({
      id: m[1],
      title: m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      published: Date.parse(m[3]),
    }));
  }
  for (const [g, clips] of await matchVideos(videos, games)) if (!isKept(g)) keep(g, clips, 'channel');

  // 3. a search for each recent game still missing (not before it's had a few hours for its video to go up)
  if (key) {
    for (const g of games.filter((x) => !isKept(x) && x.start >= now - SEARCH_WITHIN && x.start <= now - 6 * 36e5)) {
      const [away, home] = [...g.teams].sort((a, b) => Number(a.home) - Number(b.home));
      const hits = await search(sport, `${away.names[0]} ${home.names[0]} highlights`, new Date(g.start), new Date(Math.min(now, g.start + AFTER)));
      if (hits === null) {
        console.log(`${sport}: today's searches spent; the rest wait for tomorrow`);
        break;
      }
      const clips = (await matchVideos(hits, [g])).get(g);
      if (clips) keep(g, clips, 'search');
    }
  }
}

for (const [season, { file, kept, added, from }] of files) {
  if (added) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(kept));
  }
  const finished = games.filter((g) => g.season === season);
  if (!finished.length && !added) continue;
  const have = finished.filter((g) => kept[g.id]?.length).length;
  console.log(`${sport} ${season}: ${added} games' highlights added (ESPN ${from.espn}, channel ${from.channel}, search ${from.search}); ${have} of ${finished.length} finished games since ${since.toISOString().slice(0, 10)} have them (${Object.keys(kept).length} kept)`);
}
const spent = units[sport] ?? {};
console.log(`${sport}: YouTube units today: ${Object.entries(spent).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'} (searches ${spentToday(sport, 'search') / 100} of the day's budget)`);
