// Team colors as the game view draws them (ESPN's, made to read on the dark board), and a player card
// hero's

import { ESPN_API, findEspnTeamId } from '@ranker/core/game-logs';
import { fetchJson, memo } from '@ranker/core/http';
import { teamColor } from '../colors';

// The black-clad teams' second colors, for when ESPN names no alternate (the NHL's): by its abbreviation
export const BLACK_TEAMS: Record<string, string> = {
  BOS: 'ffb81c', // the Bruins' gold
  PIT: 'fcb514', // the Penguins' gold
  LA: 'a2aaad', // the Kings' silver
  ANA: 'f47a38', // the Ducks' orange
  VGK: 'b4975a', // the Golden Knights' gold
  LV: 'a5acaf', // the Raiders' silver
  SF: 'fd5a1e', // the Giants' orange
  CHW: 'c4ced4', // the White Sox's silver
  SA: 'c4ced4', // the Spurs' silver
};

// A team's color on the dark board, as everywhere in the app (colors.ts teamColor: its own, softened and
// lifted to read; a colorless black its alternate's color); a grey when it has none
export const NO_COLOR = '#8a8f8c';
export function gameColor(main: string | undefined, alt: string | undefined): string {
  return teamColor([main, alt]) ?? NO_COLOR;
}

// A team's color as the game view draws it (ESPN's, made to read on the dark board), for a player card's
// hero: the team found by the names the row knows (its team's name, its own, its logo's file), then ESPN's
// page for it (once a visit); null when it isn't found
const teamColors = new Map<string, Promise<string | null>>();
export function heroColor(league: string, names: (string | undefined)[]): Promise<string | null> {
  const id = findEspnTeamId(league, names);
  if (id === null) return Promise.resolve(null);
  return memo(teamColors, `${league}/${id}`, () =>
    fetchJson<{ team?: { color?: string; alternateColor?: string; abbreviation?: string } }>(`${ESPN_API}/${league}/teams/${id}`, {}).then(({ team: t }) =>
      t?.color ? gameColor(t.color, t.alternateColor ?? BLACK_TEAMS[t.abbreviation ?? '']) : null,
    ),
  );
}
