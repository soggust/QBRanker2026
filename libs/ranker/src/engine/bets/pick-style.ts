// A bet's pick dressed up, the same on the Algorithm desk and the Bets page: its one word that says what the bet
// is (a prop's or a total's over or under, a side's line or ML), in its team's color (never a green or a red:
// live-props.ts meterColor), from each sport's team colors (data/model/teams.json, ESPN's team list as the
// bettor keeps it: a browser can't ask ESPN's itself)
import { meterColor } from './live-props';

export type TeamColors = Map<string, { color?: string; alternateColor?: string }>;

// Each sport's teams' colors, by "sport:ABBR" and by "sport#espnId"
export async function loadTeamColors(sports: Iterable<string>): Promise<TeamColors> {
  const colors: TeamColors = new Map();
  for (const sport of new Set(sports)) {
    const file = (await fetch(`/${sport}/data/model/teams.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)) as { teams?: Record<string, { id: string; color: string | null; alt: string | null }> } | null;
    for (const [abbr, t] of Object.entries(file?.teams ?? {})) {
      const pair = { color: t.color ?? undefined, alternateColor: t.alt ?? undefined };
      colors.set(`${sport}:${abbr}`, pair);
      colors.set(`${sport}#${t.id}`, pair);
    }
  }
  return colors;
}

// A pick's color: a prop its player's team's (by his team's ESPN id), a side the team it took's (by its
// abbreviation); a total, no one's (null: the board's light, as with no team known)
export function pickTeamColor(colors: TeamColors, sport: string, pick: { total: boolean; teamId?: string | null; abbr?: string | null }): string | null {
  if (pick.total) return null;
  const pair = pick.teamId ? colors.get(`${sport}#${pick.teamId}`) : pick.abbr ? colors.get(`${sport}:${pick.abbr}`) : undefined;
  return pair ? meterColor(pair) : null;
}

// A pick split round that word: [before, the word, after]. A prop's text is what follows the player's name
// ("Under 7.5 Carries"); a total's its over or under first; a side's its line or ML last ("MIN +1.5")
export function splitPick(text: string, wordFirst: boolean): [string, string, string] {
  if (wordFirst) {
    const at = text.indexOf(' ');
    return at < 0 ? ['', text, ''] : ['', text.slice(0, at), text.slice(at)];
  }
  const at = text.lastIndexOf(' ');
  return at < 0 ? ['', text, ''] : [text.slice(0, at + 1), text.slice(at + 1), ''];
}
