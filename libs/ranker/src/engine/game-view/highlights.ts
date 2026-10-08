// A finished game's highlights: ESPN's videos in its summary when it has them (the NBA's and the NHL's, for
// a few days), else the ones kept for the season (StaticData/highlights/<season>.json, written nightly by
// libs/ranker/scripts/highlights.mjs: ESPN's before they go, the NFL's from its YouTube channel), else, for
// MLB, MLB's own (every game's, any season: its stats API, free and open to the page).
import { fetchJson, memo } from '@ranker/core/http';
import { GameVideo, GameView } from './game.model';

type SeasonHighlights = Record<string, GameVideo[]>;
const seasons = new Map<number, Promise<SeasonHighlights>>();
function seasonFile(season: number): Promise<SeasonHighlights> {
  return memo(seasons, season, () => fetchJson<SeasonHighlights>(`data/highlights/${season}.json`, {}, { cache: 'no-cache' }).catch(() => ({})));
}

export async function loadHighlights(game: GameView): Promise<GameVideo[]> {
  if (game.preview) return [];
  if (game.videos.length) return game.videos;
  const season = game.seasonYear ?? new Date(game.date).getFullYear();
  const kept = (await seasonFile(season))[game.id];
  if (kept?.length) return kept;
  if (game.league.includes('baseball')) return mlbHighlights(game);
  return [];
}

// ---- MLB's: the game found on its schedule by the day and the two teams, then its content's highlights
// (the recap first, then the plays as MLB lists them)
const MLB = 'https://statsapi.mlb.com/api/v1';
interface MlbSchedule {
  dates?: { games?: { gamePk: number; teams: { home: { team: { name: string } }; away: { team: { name: string } } } }[] }[];
}
interface MlbContent {
  highlights?: { highlights?: { items?: { headline?: string; duration?: string; image?: { cuts?: { width?: number; src?: string }[] }; playbacks?: { name?: string; url?: string }[] }[] } };
}

async function mlbHighlights(game: GameView): Promise<GameVideo[]> {
  // (the day as MLB files it, the home park's: close enough in New York's)
  const day = new Date(game.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const schedule = await fetchJson<MlbSchedule>(`${MLB}/schedule?sportId=1&date=${day}`, {});
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() || a.split(' ').at(-1)?.toLowerCase() === b.split(' ').at(-1)?.toLowerCase();
  const found = (schedule.dates ?? [])
    .flatMap((d) => d.games ?? [])
    .find((g) => same(g.teams.home.team.name, game.home.name) && same(g.teams.away.team.name, game.away.name));
  if (!found) return [];
  const content = await fetchJson<MlbContent>(`${MLB}/game/${found.gamePk}/content`, {});
  const videos = (content.highlights?.highlights?.items ?? [])
    .map((item) => {
      const src = item.playbacks?.find((p) => p.name === 'mp4Avc')?.url ?? null;
      const cuts = item.image?.cuts ?? [];
      const thumb = cuts.find((c) => (c.width ?? 0) >= 640)?.src ?? cuts.at(-1)?.src ?? null;
      const [m, s] = (item.duration ?? '').split(':').slice(-2).map(Number);
      return { title: item.headline ?? '', src, youtube: null, thumb, duration: Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null };
    })
    .filter((v) => v.src);
  return videos.sort((a, b) => Number(/highlights|recap/i.test(b.title)) - Number(/highlights|recap/i.test(a.title)));
}
