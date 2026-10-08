// The NHL's Team tab (the card's Teams and Head Coach rows): the team's season from the site's own rows.
// Its top unit on a rink (the first line, the top pair, the starting goalie; behind each the rest at that
// spot, by ice time), then all its lines on the chalkboard (four lines, three pairs, two goalies), its head
// coaches (the coaches' rows: a team that changed coaches has both), and everyone who played, by spot,
// each with his share of the team's minutes (a goalie: of its starts).
import type { DepthLoadContext, DepthSide, DepthView } from '@ranker/engine/player-card/depth-chart';
import { depthPlayer, slot, teamGames, teamPlayers, usageGroups } from '@ranker/engine/player-card/team-roster';
import type { SkillPlayer } from './positions';

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'];
const TITLES: Record<string, string> = { C: 'Centers', LW: 'Left Wings', RW: 'Right Wings', D: 'Defensemen', G: 'Goalies' };

export function loadTeamRoster(team: SkillPlayer, context: DepthLoadContext): DepthView {
  const logo = team.teamLogo;
  const byPos = teamPlayers(context.rows, logo, POSITIONS);
  const games = teamGames(context.rows, logo) || 1;
  // (a skater's whole season on the ice; a goalie's starts)
  const used = (p: SkillPlayer, pos: string) => (pos === 'G' ? (p.stats.gamesStarted ?? p.games) : (p.stats.toi ?? 0) * p.games);
  const share = (p: SkillPlayer, pos: string) => (pos === 'G' ? used(p, pos) / games : p.stats.toi == null ? null : used(p, pos) / (games * 60));
  const order = Object.fromEntries(POSITIONS.map((pos) => [pos, [...byPos[pos]].sort((a, b) => used(b, pos) - used(a, pos))]));
  const chip = (p: SkillPlayer, pos: string) => depthPlayer(p, share(p, pos), context);
  // (the pairs: the top two defensemen together, then the next two)
  const left = order['D'].filter((_, i) => i % 2 === 0);
  const right = order['D'].filter((_, i) => i % 2 === 1);

  // The top unit, attacking right: the goalie in his crease, the pair at the blue line, the line deep
  const rink: DepthSide = {
    id: 'lineup',
    title: 'Top Unit',
    icon: 'sports_hockey',
    set: null,
    los: null,
    surface: 'rink',
    slots: [
      slot('G', 'G', 'Goalie', 7, 50, order['G'].map((p) => chip(p, 'G'))),
      slot('LD', 'LD', 'Left Defense', 62, 24, left.map((p) => chip(p, 'D'))),
      slot('RD', 'RD', 'Right Defense', 62, 76, right.map((p) => chip(p, 'D'))),
      slot('LW', 'LW', 'Left Wing', 84, 18, order['LW'].map((p) => chip(p, 'LW'))),
      slot('C', 'C', 'Center', 80, 50, order['C'].map((p) => chip(p, 'C'))),
      slot('RW', 'RW', 'Right Wing', 84, 82, order['RW'].map((p) => chip(p, 'RW'))),
    ],
  };

  // Every line: four forward lines down the left, three pairs, then the goalies
  const lines: DepthSide = {
    id: 'lines',
    title: 'Lines',
    icon: 'format_list_numbered',
    set: null,
    los: null,
    surface: 'plain',
    height: 420,
    slots: [],
  };
  for (let i = 0; i < 4; i++) {
    const y = 12 + i * 25;
    (['LW', 'C', 'RW'] as const).forEach((pos, j) => {
      const p = order[pos][i];
      if (p) lines.slots.push(slot(`${pos}${i}`, `${pos}${i + 1}`, `${['First', 'Second', 'Third', 'Fourth'][i]} Line ${pos}`, 10 + j * 16, y, [chip(p, pos)]));
    });
  }
  for (let i = 0; i < 3; i++) {
    const y = 12 + i * 25;
    [left[i], right[i]].forEach((p, j) => {
      if (p) lines.slots.push(slot(`D${i}${j}`, `${j ? 'RD' : 'LD'}${i + 1}`, `Pair ${i + 1}`, 64 + j * 16, y, [chip(p, 'D')]));
    });
  }
  order['G'].slice(0, 2).forEach((p, i) => lines.slots.push(slot(`G${i}`, i ? 'G2' : 'G1', i ? 'Backup Goalie' : 'Starting Goalie', 64 + i * 16, 87, [chip(p, 'G')])));

  // The head coaches: whoever coached it that season (their games, when it changed hands)
  const coachRows = (context.rows['HC'] ?? []).filter((c) => c.teamLogo === logo);
  const coaches = coachRows.length
    ? [{ title: 'Head Coach', rows: coachRows.map((c) => ({ role: coachRows.length > 1 ? `Head coach (${c.games} GP)` : 'Head coach', name: c.name })) }]
    : [];

  return {
    asOf: '',
    sides: [rink, lines],
    special: [],
    usage: usageGroups(byPos, TITLES, share, context),
    timeline: [],
    coaches,
    teamGames: games,
  };
}
