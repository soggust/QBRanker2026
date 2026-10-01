import type { AwardInfo } from '@ranker/engine/awards';
import type { SkillPlayer, SkillPosition } from '@sport/positions';

// A season's honors under a player's name: the World Series champion's trophy and the pennant winners'
// silver cup (a player by the team he finished the season with), then the award badges the data
// script reads from the MLB Stats API (scripts/update-data.mjs).
export type AwardId = 'ws' | 'pennant' | 'mvp' | 'cy' | 'roy' | 'gg' | 'ss' | 'as';

export const AWARD_INFO: Record<AwardId, AwardInfo> = {
  // (the Commissioner's Trophy, the #1 rank's trophy, like the NFL's Lombardi)
  ws: { name: 'World Series Champion', short: 'WS Champ', icon: { name: 'trophy' } },
  pennant: { name: 'Pennant Winner', short: 'Pennant', icon: { name: 'flag' } },
  mvp: { name: 'Most Valuable Player', short: 'MVP' },
  cy: { name: 'Cy Young Award', short: 'CY' },
  roy: { name: 'Rookie of the Year', short: 'ROY' },
  gg: { name: 'Gold Glove', short: 'GG' },
  ss: { name: 'Silver Slugger', short: 'SS' },
  as: { name: 'All-Star', short: 'AS', icon: { name: 'star', metal: 'bronze' } },
};

// World Series [champion, runner-up] by season, as MLB team ids (the franchise's current id: the
// 2003 Marlins are 146, the 2002 Angels 108)
const WORLD_SERIES: Record<number, [number, number]> = {
  2000: [147, 121],
  2001: [109, 147],
  2002: [108, 137],
  2003: [146, 147],
  2004: [111, 138],
  2005: [145, 117],
  2006: [138, 116],
  2007: [111, 115],
  2008: [143, 139],
  2009: [147, 143],
  2010: [137, 140],
  2011: [138, 140],
  2012: [137, 116],
  2013: [111, 138],
  2014: [137, 118],
  2015: [118, 121],
  2016: [112, 114],
  2017: [117, 119],
  2018: [111, 119],
  2019: [120, 117],
  2020: [119, 139],
  2021: [144, 117],
  2022: [117, 143],
  2023: [140, 109],
  2024: [119, 147],
  2025: [119, 141],
};

const LEAGUES: Record<number, 'AL' | 'NL'> = {
  108: 'AL', 110: 'AL', 111: 'AL', 114: 'AL', 116: 'AL', 117: 'AL', 118: 'AL', 133: 'AL', 136: 'AL', 139: 'AL',
  140: 'AL', 141: 'AL', 142: 'AL', 145: 'AL', 147: 'AL',
  109: 'NL', 112: 'NL', 113: 'NL', 115: 'NL', 119: 'NL', 120: 'NL', 121: 'NL', 134: 'NL', 135: 'NL', 137: 'NL',
  138: 'NL', 143: 'NL', 144: 'NL', 146: 'NL', 158: 'NL',
};

export interface AwardWin {
  id: AwardId;
  // Hover text: "2016 World Series Champion"
  title: string;
}

// Order the award badges read in
const ORDER: AwardId[] = ['mvp', 'cy', 'roy', 'gg', 'ss', 'as'];

// "assets/MLB_Icons/112.svg" -> 112
const teamId = (teamLogo: string) => Number(teamLogo.split('/').pop()!.replace('.svg', ''));

export function awardsFor(unit: SkillPlayer, _position: SkillPosition, season: number): AwardWin[] {
  const wins: AwardWin[] = [];
  const series = WORLD_SERIES[season];
  const team = teamId(unit.teamLogo);
  if (series?.[0] === team) wins.push({ id: 'ws', title: `${season} World Series Champion` });
  if (series?.includes(team)) {
    const league = LEAGUES[team] === 'AL' ? 'American League' : 'National League';
    wins.push({ id: 'pennant', title: `${season} ${league} Pennant` });
  }
  const own = new Set(unit.awards ?? []);
  for (const id of ORDER) {
    if (own.has(id)) wins.push({ id, title: `${season} ${AWARD_INFO[id].name}` });
  }
  return wins;
}
