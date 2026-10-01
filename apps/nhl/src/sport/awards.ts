import type { AwardInfo } from '@ranker/engine/awards';
import type { SkillPlayer, SkillPosition } from '@sport/positions';

// A season's honors under a player's name: the Stanley Cup in gold and both finalists' conference
// champion cup (a player by the team he finished the season with), then the trophies the data script
// reads from the NHL's award records (scripts/update-data.mjs).
export type AwardId = 'cup' | 'conf' | 'hart' | 'vezina' | 'norris' | 'calder' | 'selke' | 'conn' | 'lindsay' | 'rocket' | 'artross';

export const AWARD_INFO: Record<AwardId, AwardInfo> = {
  // (the Stanley Cup itself, the #1 rank's trophy, like the NFL's Lombardi)
  cup: { name: 'Stanley Cup Champion', short: 'Cup', icon: { name: 'trophy' } },
  conf: { name: 'Conference Champion', short: 'Conf', icon: { name: 'emoji_events' } },
  hart: { name: 'Hart Trophy (MVP)', short: 'HART' },
  vezina: { name: 'Vezina Trophy (best goalie)', short: 'VEZINA' },
  norris: { name: 'Norris Trophy (best defenseman)', short: 'NORRIS' },
  calder: { name: 'Calder Trophy (rookie of the year)', short: 'CALDER' },
  selke: { name: 'Selke Trophy (best defensive forward)', short: 'SELKE' },
  conn: { name: 'Conn Smythe Trophy (playoff MVP)', short: 'CONN' },
  lindsay: { name: 'Ted Lindsay Award (players\' MVP)', short: 'LINDSAY' },
  rocket: { name: 'Rocket Richard Trophy (goals leader)', short: 'ROCKET' },
  artross: { name: 'Art Ross Trophy (points leader)', short: 'ROSS' },
};

// The Western Conference's franchises (Detroit played in the West until 2013-14)
const WEST = new Set(['ANA', 'ARI', 'PHX', 'UTA', 'CGY', 'CHI', 'COL', 'DAL', 'EDM', 'LAK', 'MIN', 'NSH', 'SJS', 'SEA', 'STL', 'VAN', 'VGK', 'WPG']);

export interface AwardWin {
  id: AwardId;
  // Hover text: "2024-25 Stanley Cup Champion"
  title: string;
}

// Order the award badges read in
const ORDER: AwardId[] = ['hart', 'conn', 'vezina', 'norris', 'calder', 'selke', 'lindsay', 'rocket', 'artross'];

// "assets/NHL_Icons/ATL_19992000-20102011.svg" -> "ATL"
const teamCode = (teamLogo: string) => teamLogo.split('/').pop()!.replace('.svg', '').split('_')[0];

// "2026" -> "2025-26" (a season is named for the year it ends in)
export const seasonName = (season: number) => `${season - 1}-${String(season).slice(2)}`;

export function awardsFor(unit: SkillPlayer, _position: SkillPosition, season: number): AwardWin[] {
  const wins: AwardWin[] = [];
  const own = new Set(unit.awards ?? []);
  const name = seasonName(season);
  if (own.has('cup')) wins.push({ id: 'cup', title: `${name} Stanley Cup Champion` });
  if (own.has('conf')) {
    const code = teamCode(unit.teamLogo);
    const west = WEST.has(code) || (code === 'DET' && season <= 2013);
    wins.push({ id: 'conf', title: west ? `${name} Western Conference Champion (Clarence S. Campbell Bowl)` : `${name} Eastern Conference Champion (Prince of Wales Trophy)` });
  }
  for (const id of ORDER) {
    if (own.has(id)) wins.push({ id, title: `${name} ${AWARD_INFO[id].name}` });
  }
  return wins;
}
