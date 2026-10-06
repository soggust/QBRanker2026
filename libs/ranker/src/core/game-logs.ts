import type { GameLog, GameLogRow } from '@ranker/engine/sport';

// Game logs for the card's Game Log tab, read live from the leagues' public APIs when the tab opens:
// ESPN's (the NFL and NBA players, by their ESPN ids) and MLB's stats API. Both allow the site to ask.

// "Sep 13" (a game's date, in the viewer's time)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// The category a repeated label belongs to, as a prefix ("Pass YDS", "Rush YDS")
const CATEGORY_SHORT: Record<string, string> = { passing: 'Pass', rushing: 'Rush', receiving: 'Rec', defensive: 'Def', kicking: 'Kick', punting: 'Punt' };

interface EspnGameLog {
  labels?: string[];
  categories?: { name: string; displayName: string; count: number }[];
  events?: Record<string, { gameDate: string; atVs: string; gameResult?: string; score?: string; opponent?: { abbreviation?: string } }>;
  seasonTypes?: { displayName: string; categories: { events?: { eventId: string; stats: string[] }[] }[] }[];
}

// An ESPN athlete's game log for a season (sport and league as ESPN names them: "football/nfl"),
// regular season and playoffs (not the preseason), newest first
export async function espnGameLog(league: string, id: number | string, season: number): Promise<GameLog> {
  const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${league}/athletes/${id}/gamelog?season=${season}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as EspnGameLog;
  const labels = data.labels ?? [];
  // (a label that repeats takes its category's name: passing yards and rushing yards apart)
  const owners: string[] = [];
  for (const c of data.categories ?? []) for (let i = 0; i < c.count; i++) owners.push(c.name);
  const columns = labels.map((label, i) =>
    labels.filter((l) => l === label).length > 1 && owners[i] ? `${CATEGORY_SHORT[owners[i]] ?? owners[i]} ${label}` : label,
  );
  const rows: (GameLogRow & { at: string })[] = [];
  for (const type of data.seasonTypes ?? []) {
    if (/preseason/i.test(type.displayName)) continue;
    for (const category of type.categories) {
      for (const line of category.events ?? []) {
        const game = data.events?.[line.eventId];
        if (!game) continue;
        rows.push({
          at: game.gameDate,
          date: day(game.gameDate),
          vs: `${game.atVs === '@' ? '@' : 'vs'} ${game.opponent?.abbreviation ?? ''}`.trim(),
          result: [game.gameResult, game.score].filter(Boolean).join(' '),
          values: line.stats,
        });
      }
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return { columns, rows: rows.map(({ at: _at, ...row }) => row) };
}

interface MlbSplit {
  date: string;
  isHome: boolean;
  isWin: boolean;
  opponent?: { name?: string; abbreviation?: string };
  stat: Record<string, string | number>;
}

// An MLB player's game log for a season (MLB's stats API: hitting or pitching), the columns given as
// [label, the API's stat], newest first
export async function mlbGameLog(id: number | string, season: number, group: 'hitting' | 'pitching', columns: [string, string][]): Promise<GameLog> {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&season=${season}&group=${group}&hydrate=team`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as { stats?: { splits?: MlbSplit[] }[] };
  const splits = [...(data.stats?.[0]?.splits ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return {
    columns: columns.map(([label]) => label),
    rows: splits.map((split) => ({
      date: day(`${split.date}T12:00:00`),
      vs: `${split.isHome ? 'vs' : '@'} ${split.opponent?.abbreviation ?? split.opponent?.name ?? ''}`.trim(),
      result: split.isWin ? 'W' : 'L',
      values: columns.map(([, key]) => String(split.stat[key] ?? '-')),
    })),
  };
}
