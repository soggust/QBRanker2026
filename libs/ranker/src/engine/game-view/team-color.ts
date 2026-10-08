// Team colors as the game view draws them (ESPN's, made to read on the dark board), and a player card
// hero's

// The black-clad teams' second colors, for when ESPN names no alternate (the NHL's): by its abbreviation

import { ESPN_API, findEspnTeamId } from '@ranker/core/game-logs';
import { fetchJson, memo } from '@ranker/core/http';

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

// A team's color that reads on the dark board: its own; a dark one lightened, keeping its hue (the Ravens'
// purple, the Yankees' navy); a colorless black (the Bruins', the Giants') swapped for its alternate when
// that has a color (their gold, their orange)
export function teamColor(main: string | undefined, alt: string | undefined): string {
  const rgb = (hex: string | undefined) => {
    const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? m.slice(1).map((x) => parseInt(x, 16)) : null;
  };
  const light = ([r, g, b]: number[]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const colorful = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b) > 40;
  const hex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  // (toward white, a step at a time, until it reads)
  const lift = (c: number[]) => {
    let out = c;
    for (let i = 0; i < 12 && light(out) < 0.2; i++) out = out.map((x) => x + (255 - x) * 0.12);
    return hex(out);
  };
  const m = rgb(main);
  const a = rgb(alt);
  if (!m) return a ? lift(a) : '#8a8f8c';
  if (light(m) >= 0.2) return hex(m);
  if (!colorful(m) && a && colorful(a)) return lift(a);
  return lift(m);
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
      t?.color ? teamColor(t.color, t.alternateColor ?? BLACK_TEAMS[t.abbreviation ?? '']) : null,
    ),
  );
}
