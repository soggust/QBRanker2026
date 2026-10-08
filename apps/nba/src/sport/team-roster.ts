// The NBA's Team tab (the card's Teams and Head Coach rows): the team's season from the site's own rows.
// Its starting five on a half court (the five with the most starts, each at his own spot, or the
// nearest one open; behind him the rest at that spot, by minutes), the next five by minutes as its second
// unit, its coaching staff (Wikipedia's: scripts/build-coaches.mjs), and everyone who played, by spot,
// each with his share of the team's minutes.
import type { DepthLoadContext, DepthView } from '@ranker/engine/player-card/depth-chart';
import { depthPlayer, loadStaff, slot, teamGames, teamPlayers, usageGroups } from '@ranker/engine/player-card/team-roster';
import type { SkillPlayer } from './positions';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const NAMES: Record<string, string> = { PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward', C: 'Center' };
const TITLES: Record<string, string> = { PG: 'Point Guards', SG: 'Shooting Guards', SF: 'Small Forwards', PF: 'Power Forwards', C: 'Centers' };
// Where each spot sits on the half court (x across, y down from the baseline, in percent): the bigs in
// close, the wings out wide, the point guard up top
const SPOT: Record<string, [number, number]> = { C: [36, 22], PF: [66, 30], SG: [14, 52], SF: [86, 52], PG: [50, 78] };

export async function loadTeamRoster(team: SkillPlayer, season: number, current: boolean, context: DepthLoadContext): Promise<DepthView> {
  const logo = team.teamLogo;
  const byPos = teamPlayers(context.rows, logo, POSITIONS);
  const games = teamGames(context.rows, logo) || 1;
  const minutes = (p: SkillPlayer) => p.stats.minutes ?? 0;
  const share = (p: SkillPlayer) => (p.stats.minutes == null ? null : minutes(p) / (games * 48));
  const everyone = POSITIONS.flatMap((pos) => byPos[pos].map((p) => ({ p, pos })));

  // The starting five: the most starts (minutes break a tie), each at his own spot or the nearest open
  const starters = [...everyone].sort((a, b) => (b.p.stats.gamesStarted ?? 0) - (a.p.stats.gamesStarted ?? 0) || minutes(b.p) - minutes(a.p)).slice(0, 5);
  const at = new Map<string, SkillPlayer>();
  for (const { p, pos } of starters) {
    const i = POSITIONS.indexOf(pos);
    const open = POSITIONS.filter((s) => !at.has(s)).sort((a, b) => Math.abs(POSITIONS.indexOf(a) - i) - Math.abs(POSITIONS.indexOf(b) - i))[0];
    if (open) at.set(open, p);
  }
  const starting = new Set(at.values());
  const slots = POSITIONS.map((pos) => {
    const first = at.get(pos);
    const behind = byPos[pos].filter((p) => !starting.has(p)).sort((a, b) => minutes(b) - minutes(a));
    return slot(pos, pos, NAMES[pos], SPOT[pos][0], SPOT[pos][1], [...(first ? [first] : []), ...behind].map((p) => depthPlayer(p, share(p), context)));
  });

  // The second unit: the next five by minutes
  const bench = everyone
    .filter(({ p }) => !starting.has(p))
    .sort((a, b) => minutes(b.p) - minutes(a.p))
    .slice(0, 5)
    .map(({ p, pos }) => ({ label: pos, player: depthPlayer(p, share(p), context) }));

  const coaches = await loadStaff(season, current, team.teamName, ['Head Coach', 'Assistants']);
  return {
    asOf: '',
    sides: [{ id: 'lineup', title: 'Starting Five', icon: 'sports_basketball', set: null, los: null, surface: 'court', slots }],
    special: bench,
    specialTitle: 'Second Unit',
    usage: usageGroups(byPos, TITLES, share, context),
    timeline: [],
    coaches,
    teamGames: games,
  };
}
