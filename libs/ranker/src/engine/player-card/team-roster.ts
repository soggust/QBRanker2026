// The Team tab for a sport without its own depth-chart data (the NBA, the NHL, MLB): built from the
// season's rows the site already has. A team's players are the rows with its logo that season; each one's
// usage (the sport's: minutes, ice time, plate appearances, starts) orders them, the most-used at each
// spot starting; the sport places the spots on its surface (apps/<sport>/src/sport/team-roster.ts).
// The coaching staff comes from the sport's staff file (scripts/build-coaches.mjs: Wikipedia's), or
// from the head coaches' rows.
import type { SkillPlayer } from '@sport/positions';
import type { DepthCoachGroup, DepthLoadContext, DepthPlayer, DepthSlot, DepthUsageGroup } from './depth-chart';

// The injury report's words, short (the chip's corner flag)
const STATUS: Record<string, string> = {
  questionable: 'Q',
  doubtful: 'D',
  out: 'O',
  'day-to-day': 'DTD',
  'injured reserve': 'IR',
  suspension: 'SUSP',
};

// "LeBron James" -> "L. James" (a suffix kept with the last name)
export function shortName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(parts.at(-1)!) ? parts.pop() : null;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}${suffix ? ' ' + suffix : ''}`;
}

// A team's players that season, tab by tab (each tab's rows with the team's logo), and its games played
export function teamPlayers(rows: Record<string, SkillPlayer[]>, logo: string, positions: string[]): Record<string, SkillPlayer[]> {
  return Object.fromEntries(positions.map((pos) => [pos, (rows[pos] ?? []).filter((p) => p.teamLogo === logo)]));
}

export function teamGames(rows: Record<string, SkillPlayer[]>, logo: string): number {
  let games = 0;
  for (const list of Object.values(rows)) for (const p of list ?? []) if (p.teamLogo === logo) games = Math.max(games, p.games);
  return games;
}

// A row as a chip's player: its usage share (0-1), and its injury report flag (this season's rows carry it)
export function depthPlayer(p: SkillPlayer, share: number | null, context: DepthLoadContext): DepthPlayer {
  const words = (p as { injuryStatus?: string | null }).injuryStatus ?? null;
  const injured = (p as { injured?: boolean }).injured;
  const status = words ? (STATUS[words.toLowerCase()] ?? (/\bil\b|injured list/i.test(words) ? 'IL' : words.slice(0, 3).toUpperCase())) : injured ? 'O' : null;
  return {
    id: p.gsisId,
    espnId: null,
    name: p.name,
    short: shortName(p.name),
    headshot: context.headshot(p),
    snaps: share === null ? null : Math.max(0, Math.min(1, share)),
    games: p.games,
    status,
    statusText: words ?? (injured ? 'Injured' : null),
    injury: null,
  };
}

// A spot on the surface: its players by depth (the first starts)
export function slot(key: string, label: string, name: string, x: number, y: number, depth: DepthPlayer[]): DepthSlot {
  return { key, label, name, x, y, depth };
}

// The usage list: a group per tab (its name: "Point Guards"), the most-used first
export function usageGroups(
  byPosition: Record<string, SkillPlayer[]>,
  titles: Record<string, string>,
  share: (p: SkillPlayer, position: string) => number | null,
  context: DepthLoadContext,
): DepthUsageGroup[] {
  const groups: DepthUsageGroup[] = [];
  for (const [pos, list] of Object.entries(byPosition)) {
    const rows = list
      .map((p) => ({ ...depthPlayer(p, share(p, pos), context), pos, onChart: true }))
      .sort((a, b) => (b.snaps ?? -1) - (a.snaps ?? -1));
    if (rows.length) groups.push({ title: titles[pos] ?? pos, rows });
  }
  return groups;
}

// A season's staffs (build-coaches.mjs), every team by its name that season
interface StaffFile {
  teams: Record<string, { head: { role: string; name: string }[]; staff: { role: string; name: string }[] }>;
}

// The team's coaching staff that season: its head coach (or manager) and his assistants, when the file
// has it (none when it isn't there)
export async function loadStaff(season: number, current: boolean, teamName: string | null | undefined, titles: [string, string]): Promise<DepthCoachGroup[]> {
  if (!teamName) return [];
  const file = await fetch(current ? 'data/coaches.json' : `data/seasons/${season}/coaches.json`, { cache: current ? 'no-cache' : 'default' })
    .then((r) => (r.ok ? (r.json() as Promise<StaffFile>) : null))
    .catch(() => null);
  const team = file?.teams[teamName];
  if (!team) return [];
  return [
    { title: titles[0], rows: team.head.map((c) => ({ ...c })) },
    { title: titles[1], rows: team.staff.map((c) => ({ ...c })) },
  ].filter((g) => g.rows.length);
}
