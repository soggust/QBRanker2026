import type { SkillPlayer, SkillPosition } from 'app/positions';

// A season's honors under a player's name: the champion's gold trophy and both finalists' conference
// champion flag (a player by the team he finished the season with), then the award badges the data
// script reads from Basketball-Reference's award columns (scripts/update-data.mjs).
export type AwardId =
  | 'champ'
  | 'conf'
  | 'mvp'
  | 'dpoy'
  | 'roy'
  | 'smoy'
  | 'mip'
  | 'cpoy'
  | 'nba1'
  | 'nba2'
  | 'nba3'
  | 'def1'
  | 'def2'
  | 'as'
  | 'coy';

export const AWARD_INFO: Record<AwardId, { name: string; short: string }> = {
  champ: { name: 'NBA Champion', short: 'Champ' },
  conf: { name: 'Conference Champion', short: 'Conf' },
  mvp: { name: 'Most Valuable Player', short: 'MVP' },
  dpoy: { name: 'Defensive Player of the Year', short: 'DPOY' },
  roy: { name: 'Rookie of the Year', short: 'ROY' },
  smoy: { name: 'Sixth Man of the Year', short: '6MOY' },
  mip: { name: 'Most Improved Player', short: 'MIP' },
  cpoy: { name: 'Clutch Player of the Year', short: 'CPOY' },
  nba1: { name: 'All-NBA First Team', short: 'NBA1' },
  nba2: { name: 'All-NBA Second Team', short: 'NBA2' },
  nba3: { name: 'All-NBA Third Team', short: 'NBA3' },
  def1: { name: 'All-Defensive First Team', short: 'DEF1' },
  def2: { name: 'All-Defensive Second Team', short: 'DEF2' },
  as: { name: 'All-Star', short: 'AS' },
  coy: { name: 'Coach of the Year', short: 'COY' },
};

// Each franchise's conference (the NBA Finals teams since 2001 all played where their franchise does now)
const WEST = new Set(['DAL', 'DEN', 'GSW', 'HOU', 'LAC', 'LAL', 'MEM', 'MIN', 'NOP', 'OKC', 'PHO', 'POR', 'SAC', 'SAS', 'UTA']);

export interface AwardWin {
  id: AwardId;
  // Hover text: "2016 NBA Champion"
  title: string;
}

// Order the award badges read in
const ORDER: AwardId[] = ['coy', 'mvp', 'dpoy', 'roy', 'smoy', 'mip', 'cpoy', 'nba1', 'nba2', 'nba3', 'def1', 'def2', 'as'];

// "assets/NBA_Icons/BOS.svg" -> "BOS"
const teamCode = (teamLogo: string) => teamLogo.split('/').pop()!.replace('.svg', '');

// "2026" -> "2025-26" (a season is named for the year it ends in)
export const seasonName = (season: number) => `${season - 1}-${String(season).slice(2)}`;

export function awardsFor(unit: SkillPlayer, _position: SkillPosition, season: number): AwardWin[] {
  const wins: AwardWin[] = [];
  const own = new Set(unit.awards ?? []);
  const name = seasonName(season);
  if (own.has('champ')) wins.push({ id: 'champ', title: `${name} NBA Champion` });
  if (own.has('champ') || own.has('finals')) {
    const conference = WEST.has(teamCode(unit.teamLogo)) ? 'Western' : 'Eastern';
    wins.push({ id: 'conf', title: `${name} ${conference} Conference Champion` });
  }
  for (const id of ORDER) {
    if (own.has(id)) wins.push({ id, title: `${name} ${AWARD_INFO[id].name}` });
  }
  return wins;
}
