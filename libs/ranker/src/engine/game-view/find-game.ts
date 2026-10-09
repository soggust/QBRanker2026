// Finding a game: by its team, season and opponent (a Recent square: the nth meeting, newest first, on the
// team's schedule), or by its date and a team in it (a game log's row without ESPN's id)

import { espnSchedule, espnScoreboard } from '@ranker/core/game-logs';
import { memo } from '@ranker/core/http';

// A team's finished games that season, newest first (the regular season's and the playoffs'): each one's
// id, its opponent and where, and the score the team's way ("24-17"); read once a visit
export interface TeamResult {
  event: string;
  opponent: string;
  home: boolean;
  score: string;
}
const results = new Map<string, Promise<TeamResult[]>>();
export function teamResults(league: string, teamId: string, season: number): Promise<TeamResult[]> {
  return memo(results, `${league}/${teamId}/${season}`, () =>
    espnSchedule(league, teamId, season).then((events) =>
        events
          .filter((e) => e.competitions[0]?.status?.type?.completed)
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e) => {
            const us = e.competitions[0].competitors.find((c) => c.team.id === teamId);
            const them = e.competitions[0].competitors.find((c) => c.team.id !== teamId);
            const points = (c: typeof us) => c?.score?.displayValue ?? String(c?.score?.value ?? '');
            return { event: e.id, opponent: them?.team.id ?? '', home: us?.homeAway === 'home', score: `${points(us)}-${points(them)}` };
          }),
    ),
  );
}

// The nth game against an opponent (home or away), newest first: a Recent dot's
export function nthMeeting(list: TeamResult[], opponentId: string, home: boolean | null, nth: number): TeamResult | null {
  return list.filter((r) => r.opponent === opponentId && (home === null || r.home === home))[nth] ?? null;
}

// A Recent dot's game: its team's nth game against that opponent (home or away), newest first, among the
// season's finished games
export async function findGame(
  league: string,
  teamId: string,
  opponentId: string,
  home: boolean | null,
  season: number,
  nth: number,
): Promise<string | null> {
  return nthMeeting(await teamResults(league, teamId, season), opponentId, home, nth)?.event ?? null;
}

// A game by its date and a team in it (a game log's row without ESPN's id: MLB's and the NHL's player
// logs): that day's scoreboard, the game with that team's abbreviation or name
export async function findGameOn(league: string, date: string, names: string[]): Promise<string | null> {
  const day = date.slice(0, 10).replace(/-/g, '');
  const events = await espnScoreboard(league, day);
  const wanted = names.map((n) => n.toLowerCase());
  const event = events.find((e) =>
    e.competitions?.[0]?.competitors?.some((c) =>
      [c.team.abbreviation, c.team.displayName, c.team.shortDisplayName, c.team.name].some((x) => x && wanted.includes(x.toLowerCase())),
    ),
  );
  return event?.id ?? null;
}
