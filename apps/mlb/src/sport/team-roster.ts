// MLB's Team tab (the card's Teams rows): the team's season from the site's own rows. Its everyday
// lineup on a diamond (the most plate appearances at each spot: three outfielders, center field to the
// fastest of them; its ace on the mound; behind each the rest at that spot), its pitching staff (the
// rotation by starts, the bullpen: its closer by saves, its setup man by holds, then by innings), its
// batting order (its latest game's that season, from MLB's stats API: postseason included), its manager
// and coaches (Wikipedia's: scripts/build-coaches.mjs), and everyone who played, by position, each with
// his share of the team's plate appearances (a starter: of its starts; a reliever: of its games).
import type { DepthLoadContext, DepthPlayer, DepthSide, DepthView } from '@ranker/engine/player-card/depth-chart';
import { depthPlayer, loadStaff, slot, teamGames, teamPlayers, usageGroups } from '@ranker/engine/player-card/team-roster';
import type { SkillPlayer } from './positions';

const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'];
const TITLES: Record<string, string> = {
  C: 'Catchers', '1B': 'First Base', '2B': 'Second Base', '3B': 'Third Base', SS: 'Shortstops',
  OF: 'Outfielders', DH: 'Designated Hitters', SP: 'Starting Pitchers', RP: 'Relief Pitchers',
};
// Where each spot sits on the diamond (x across, y down from the outfield wall, in percent)
const SPOT: Record<string, [number, number, string]> = {
  LF: [16, 18, 'Left Field'], CF: [50, 13, 'Center Field'], RF: [84, 18, 'Right Field'],
  SS: [38, 34, 'Shortstop'], '2B': [62, 34, 'Second Base'], '3B': [28, 60, 'Third Base'], '1B': [72, 60, 'First Base'],
  P: [50, 58, 'Pitcher'], C: [50, 88, 'Catcher'], DH: [88, 86, 'Designated Hitter'],
};
// (a full-time hitter's plate appearances a game)
const PA_PER_GAME = 4.2;
const STATS_API = 'https://statsapi.mlb.com/api/v1';

interface BoxPlayer {
  person: { id: number; fullName: string };
  battingOrder?: string;
  allPositions?: { abbreviation: string }[];
  position?: { abbreviation: string };
}

// The team's batting order in its latest game that season with one (postseason included): each spot's
// starter (MLB numbers them 100, 200...; a sub who took the spot over is 101), his position, and the date
async function battingOrder(teamId: number, season: number): Promise<{ date: string; order: { id: number; name: string; pos: string }[] } | null> {
  const schedule = await (await fetch(`${STATS_API}/schedule?sportId=1&teamId=${teamId}&season=${season}&gameType=R,F,D,L,W`)).json();
  const games = (schedule.dates ?? [])
    .flatMap((d: { games: unknown[] }) => d.games)
    .filter((g: { status: { abstractGameState: string } }) => g.status.abstractGameState === 'Final') as { gamePk: number; officialDate: string }[];
  // (the latest few: a game called off can be "final" with no lineup)
  for (const game of games.slice(-4).reverse()) {
    const box = await (await fetch(`${STATS_API}/game/${game.gamePk}/boxscore`)).json();
    const side = box.teams.home.team.id === teamId ? box.teams.home : box.teams.away;
    const order = (Object.values(side.players) as BoxPlayer[])
      .filter((p) => p.battingOrder && Number(p.battingOrder) % 100 === 0)
      .sort((a, b) => Number(a.battingOrder) - Number(b.battingOrder))
      .map((p) => ({ id: p.person.id, name: p.person.fullName, pos: p.allPositions?.[0]?.abbreviation ?? p.position?.abbreviation ?? '' }));
    if (order.length >= 9) return { date: game.officialDate, order };
  }
  return null;
}

export async function loadTeamRoster(team: SkillPlayer, season: number, current: boolean, context: DepthLoadContext): Promise<DepthView> {
  const logo = team.teamLogo;
  const byPos = teamPlayers(context.rows, logo, POSITIONS);
  const games = teamGames(context.rows, logo) || 1;
  const stat = (p: SkillPlayer, key: string) => ((p.stats as Record<string, number | null>)[key] ?? 0);
  const share = (p: SkillPlayer, pos: string) =>
    pos === 'SP' ? (stat(p, 'gamesStarted') * 5) / games : pos === 'RP' ? p.games / games : stat(p, 'pa') / (games * PA_PER_GAME);
  const chip = (p: SkillPlayer, pos: string) => depthPlayer(p, share(p, pos), context);
  const byUse = (pos: string, key: string) => [...byPos[pos]].sort((a, b) => stat(b, key) - stat(a, key) || b.games - a.games);

  // The lineup: each infield spot's most plate appearances, then the three outfielders (center field the
  // fastest), the designated hitter, and the ace on the mound
  const slots = (['C', '1B', '2B', '3B', 'SS'] as const).map((pos) => slot(pos, pos, SPOT[pos][2], SPOT[pos][0], SPOT[pos][1], byUse(pos, 'pa').map((p) => chip(p, pos))));
  const outfield = byUse('OF', 'pa');
  const three = outfield.slice(0, 3);
  const center = [...three].sort((a, b) => stat(b, 'sprintSpeed') - stat(a, 'sprintSpeed'))[0];
  const corners = three.filter((p) => p !== center);
  const rest = outfield.slice(3).map((p) => chip(p, 'OF'));
  for (const [key, p] of [['LF', corners[0]], ['CF', center], ['RF', corners[1]]] as const) {
    if (p) slots.push(slot(key, key, SPOT[key][2], SPOT[key][0], SPOT[key][1], [chip(p, 'OF'), ...rest]));
  }
  const dh = byUse('DH', 'pa');
  if (dh.length) slots.push(slot('DH', 'DH', SPOT['DH'][2], SPOT['DH'][0], SPOT['DH'][1], dh.map((p) => chip(p, 'DH'))));
  const rotation = byUse('SP', 'gamesStarted');
  if (rotation.length) slots.push(slot('P', 'SP', 'Starting Pitcher', SPOT['P'][0], SPOT['P'][1], rotation.map((p) => chip(p, 'SP'))));
  const diamond: DepthSide = { id: 'lineup', title: 'Lineup', icon: 'sports_baseball', set: null, los: null, surface: 'diamond', slots };

  // The pitching staff: the rotation across the top, the bullpen under it
  const staff: DepthSide = { id: 'pitching', title: 'Pitching Staff', icon: 'sports_baseball', set: null, los: null, surface: 'plain', height: 280, slots: [] };
  rotation.slice(0, 5).forEach((p, i) => staff.slots.push(slot(`SP${i}`, `SP${i + 1}`, `Starter ${i + 1}`, 14 + i * 18, 26, [chip(p, 'SP')])));
  const pen = [...byPos['RP']];
  const closer = [...pen].sort((a, b) => stat(b, 'saves') - stat(a, 'saves'))[0];
  const setup = pen.filter((p) => p !== closer).sort((a, b) => stat(b, 'holds') - stat(a, 'holds'))[0];
  const others = pen.filter((p) => p !== closer && p !== setup).sort((a, b) => stat(b, 'ip') - stat(a, 'ip')).slice(0, 3);
  [[closer, 'CL', 'Closer'], [setup, 'SU', 'Setup'], ...others.map((p) => [p, 'RP', 'Reliever'] as const)].forEach(([p, label, name], i) => {
    if (p) staff.slots.push(slot(`RP${i}`, label as string, name as string, 14 + i * 18, 74, [chip(p as SkillPlayer, 'RP')]));
  });

  // The batting order (none when MLB's API doesn't answer): each hitter as the site has him, or by name
  const teamId = Number(logo.match(/(\d+)\.svg$/)?.[1]);
  const [lineup, coaches] = await Promise.all([
    teamId ? battingOrder(teamId, season).catch(() => null) : Promise.resolve(null),
    loadStaff(season, current, team.teamName, ['Manager', 'Coaches']),
  ]);
  const hitters = new Map(POSITIONS.filter((pos) => !['SP', 'RP'].includes(pos)).flatMap((pos) => (context.rows[pos] ?? []).map((p) => [Number(p.id), [p, pos] as const])));
  const special = (lineup?.order ?? []).map((h, i) => {
    const found = hitters.get(h.id);
    const player: DepthPlayer = found
      ? chip(found[0], found[1])
      : depthPlayer({ id: h.id, gsisId: `H-${h.id}`, name: h.name, teamLogo: logo, games: 0, stats: {} } as unknown as SkillPlayer, null, context);
    return { label: `${i + 1} · ${h.pos}`, player };
  });
  const day = lineup ? new Date(`${lineup.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return {
    asOf: '',
    sides: [diamond, ...(staff.slots.length ? [staff] : [])],
    special,
    specialTitle: `Batting Order · ${day}`,
    usage: usageGroups(byPos, TITLES, share, context),
    timeline: [],
    coaches,
    teamGames: games,
  };
}
