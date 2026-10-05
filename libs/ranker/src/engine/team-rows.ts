// A Teams tab's rows built from the season's head coach rows (one per coach and team: a firing splits a
// season): each team's coaches' games added up, its stats (every coach row carries the team's season
// stats; the sport adds up or picks what's per coach), and its badges but the coaches' own awards
import { DATA } from '@ranker/engine/data';
import type { SkillPlayer } from '@sport/positions';

type Stats = SkillPlayer['stats'];

// stats: the sport's team stats from its coach rows (sum: a stat added up across them)
export function teamRowsFromCoaches(stats: (coaches: SkillPlayer[], sum: (key: string) => number) => Partial<Stats>): SkillPlayer[] {
  const coaches = (DATA.skillPlayers as Record<string, SkillPlayer[]>)['HC'] ?? [];
  const teams = new Map<string, SkillPlayer[]>();
  for (const coach of coaches) teams.set(coach.teamLogo, [...(teams.get(coach.teamLogo) ?? []), coach]);
  return [...teams].map(([logo, list]) => {
    const sum = (key: string) => list.reduce((total, c) => total + ((c.stats as Record<string, number | null>)[key] ?? 0), 0);
    return {
      id: null,
      gsisId: `TM-${logo.split('/').pop()!.replace('.svg', '')}`,
      name: list[0].teamName ?? logo,
      teamLogo: logo,
      teamName: list[0].teamName,
      games: list.reduce((total, c) => total + c.games, 0),
      // (the team's last five games, newest first, from its coaches' rows: the Recent column)
      lastFive: (list.find((c) => (c as { teamLastFive?: number[] }).teamLastFive) as { teamLastFive?: number[] } | undefined)?.teamLastFive,
      stats: { ...list[0].stats, ...stats(list, sum) },
      awards: [...new Set(list.flatMap((c) => (c.awards ?? []).filter((award) => award !== 'coy')))],
    } as SkillPlayer;
  });
}
