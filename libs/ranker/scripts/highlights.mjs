// The game view's highlights, kept for the season (ESPN keeps a game's videos only a few days, and has none
// of the NFL's): StaticData/highlights/<season>.json, { ESPN event id: [{ title, src, youtube, thumb,
// duration }] }, read by the site's game view (libs/ranker/src/engine/game-view/highlights.ts).
//
//   node libs/ranker/scripts/highlights.mjs <sport> [days]
//
// For the last few days' finished games (10 unless given) not kept yet: ESPN's videos in the game's summary
// (the NBA's and the NHL's), the game's highlights first. The NFL's from its YouTube channel: the channel's
// feed (its latest uploads; free, no key) and, with YOUTUBE_API_KEY set, a search for each game (the Data
// API's free quota covers a week's games many times over). MLB's need none of this: the site asks MLB's own
// API, any game, any season.

// (the keys: .env on this machine, the repo's secrets on GitHub)
import './env.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const LEAGUES = { nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const NFL_CHANNEL = 'UCDVYQ4Zhbm3S2dlz7P1GBDg';
const UA = { 'User-Agent': 'Mozilla/5.0 (sports-ranker highlights)' };

const sport = process.argv[2];
const days = Number(process.argv[3] ?? 10);
const league = LEAGUES[sport];
if (!league) throw new Error(`usage: highlights.mjs <${Object.keys(LEAGUES).join('|')}> [days]`);
const dir = path.join(ROOT, 'apps', sport, 'src/StaticData/highlights');
// (each season's file, by ESPN's season year for the game: the one the game view looks in)
const files = new Map();
const fileFor = (season) => {
  if (!files.has(season)) {
    const file = path.join(dir, `${season}.json`);
    files.set(season, { file, kept: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}, added: 0 });
  }
  return files.get(season);
};

const json = (url) => fetch(url, { headers: UA }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// The last few days' finished games, each with its teams' names (for matching a video's title)
const games = [];
for (let i = 0; i <= days; i++) {
  const board = await json(`${ESPN}/${league}/scoreboard?dates=${ymd(new Date(Date.now() - i * 864e5))}`);
  for (const e of board?.events ?? []) {
    const c = e.competitions?.[0];
    const season = e.season?.year ?? new Date(e.date).getFullYear();
    if (!c?.status?.type?.completed || fileFor(season).kept[e.id]) continue;
    games.push({ id: e.id, season, date: e.date, teams: (c.competitors ?? []).map((t) => [t.team?.displayName ?? '', t.team?.shortDisplayName ?? t.team?.name ?? '']) });
  }
}

// (ESPN's: the videos in each game's summary, the game's highlights first)
if (sport !== 'mlb') {
  for (const g of games) {
    const s = await json(`${ESPN}/${league}/summary?event=${g.id}`);
    const videos = (s?.videos ?? [])
      .filter((v) => v.links?.source?.href)
      .map((v) => ({ title: v.headline ?? '', src: v.links.source.href, youtube: null, thumb: v.thumbnail ?? null, duration: v.duration ?? null }))
      .sort((a, b) => Number(/highlights/i.test(b.title)) - Number(/highlights/i.test(a.title)))
      .slice(0, 8);
    if (videos.length) {
      fileFor(g.season).kept[g.id] = videos;
      fileFor(g.season).added++;
    }
  }
}

// (the NFL's: its YouTube channel's game highlights, matched to a game by both teams' names in the title)
if (sport === 'nfl') {
  const named = (title, g) => /highlights/i.test(title) && !/preview/i.test(title) && g.teams.every(([, nick]) => nick && title.toLowerCase().includes(nick.toLowerCase()));
  const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${NFL_CHANNEL}`, { headers: UA }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const uploads = [...feed.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>/g)].map((m) => ({ id: m[1], title: m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"') }));
  const key = process.env.YOUTUBE_API_KEY;
  for (const g of games.filter((x) => !fileFor(x.season).kept[x.id])) {
    let found = uploads.find((u) => named(u.title, g));
    if (!found && key) {
      const q = encodeURIComponent(`${g.teams.map(([full]) => full).join(' vs ')} highlights`);
      const after = new Date(Date.parse(g.date) - 864e5).toISOString();
      const r = await json(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&channelId=${NFL_CHANNEL}&publishedAfter=${after}&q=${q}&key=${key}`);
      const hit = (r?.items ?? []).find((it) => named(it.snippet?.title ?? '', g));
      if (hit) found = { id: hit.id.videoId, title: hit.snippet.title };
    }
    if (found) {
      fileFor(g.season).kept[g.id] = [{ title: found.title, src: null, youtube: found.id, thumb: `https://i.ytimg.com/vi/${found.id}/mqdefault.jpg`, duration: null }];
      fileFor(g.season).added++;
    }
  }
}

for (const [season, { file, kept, added }] of files) {
  if (added) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(kept));
  }
  if (added || games.some((g) => g.season === season)) console.log(`${sport} ${season}: ${added} games' highlights added (${Object.keys(kept).length} kept)`);
}
console.log(`${sport}: ${games.length} finished games in the last ${days} days not kept before`);
