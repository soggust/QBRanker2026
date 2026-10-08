import type { GameLog, GameLogChart, GameLogColumn, GameLogRow, UpcomingGame } from '@ranker/engine/sport';
import { fetchJson, memo } from '@ranker/core/http';

// Game logs for the card's Game Log tab, read live from the leagues' public APIs when the tab opens:
// ESPN's (the NFL and NBA players by their ESPN ids, and every sport's teams) and MLB's stats API. Both
// allow the site to ask.

// "Sep 13" (a game's date, in the viewer's time)
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// How a sport shapes ESPN's columns: a column's new label (null drops it), the chart above the table, and
// fumbles lost as an FL column at the end of a group (fumblesLost: "Rushing"; from each game's box score
// when ESPN's log hasn't its own, a QB's)
export interface EspnLogOptions {
  label?: (group: string, label: string) => string | null;
  fumblesLost?: string;
  chart?: GameLogChart;
}

interface EspnGameLog {
  labels?: string[];
  categories?: { name: string; displayName: string; count: number }[];
  events?: Record<string, { gameDate: string; atVs: string; gameResult?: string; score?: string; opponent?: { abbreviation?: string; displayName?: string; logo?: string } }>;
  seasonTypes?: { displayName: string; categories: { events?: { eventId: string; stats: string[] }[] }[] }[];
}

// An ESPN athlete's game log for a season (sport and league as ESPN names them: "football/nfl"),
// regular season and playoffs (not the preseason), newest first
export async function espnGameLog(league: string, id: number | string, season: number, options: EspnLogOptions = {}): Promise<GameLog> {
  const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${league}/athletes/${id}/gamelog?season=${season}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as EspnGameLog;
  const labels = data.labels ?? [];
  // each label's category ("Passing"), then the sport's say on keeping and naming it
  const groups: string[] = [];
  for (const c of data.categories ?? []) for (let i = 0; i < c.count; i++) groups.push(c.displayName);
  const keep: number[] = [];
  const columns: GameLogColumn[] = [];
  labels.forEach((raw, i) => {
    const group = groups[i] ?? '';
    const label = options.label ? options.label(group, raw) : raw;
    if (label === null) return;
    keep.push(i);
    columns.push({ label, group: new Set(groups).size > 1 ? group : undefined });
  });
  const rows: (GameLogRow & { at: string; event: string })[] = [];
  for (const type of data.seasonTypes ?? []) {
    if (/preseason/i.test(type.displayName)) continue;
    for (const category of type.categories) {
      for (const line of category.events ?? []) {
        const game = data.events?.[line.eventId];
        // (not an all-star game: the Pro Bowl, filed with the playoffs)
        if (!game || /^(AFC|NFC)$/.test(game.opponent?.abbreviation ?? '') || /all-star/i.test(game.opponent?.displayName ?? '')) continue;
        rows.push({
          at: game.gameDate,
          event: line.eventId,
          playoff: /post/i.test(type.displayName),
          date: day(game.gameDate),
          vs: `${game.atVs === '@' ? '@' : 'vs'} ${game.opponent?.abbreviation ?? ''}`.trim(),
          logo: game.opponent?.logo,
          result: [game.gameResult, game.score].filter(Boolean).join(' '),
          values: keep.map((i) => line.stats[i] ?? '-'),
        });
      }
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  if (options.fumblesLost) {
    // ESPN's own fumbles-lost column (LST), or one read from the box scores, moved to the end of the group
    let from = labels.length ? keep.findIndex((i) => labels[i] === 'LST') : -1;
    if (from < 0) {
      const lost = await espnFumblesLost(league, id, season);
      columns.push({ label: 'FL' });
      for (const row of rows) row.values.push(lost?.get(row.event) ?? '-');
      from = columns.length - 1;
    }
    // (no such group, a receiver who hasn't run it: it stays last)
    const lastInGroup = columns.reduce((at, c, i) => (c.group === options.fumblesLost && i !== from ? i : at), -1);
    const to = lastInGroup < 0 ? columns.length - 1 : lastInGroup < from ? lastInGroup + 1 : lastInGroup;
    const move = <T>(list: T[]) => list.splice(to, 0, list.splice(from, 1)[0]);
    move(columns);
    columns[to] = { label: 'FL', group: lastInGroup < 0 ? (columns.some((c) => c.group) ? 'Fumbles' : undefined) : options.fumblesLost };
    for (const row of rows) move(row.values);
  }
  return { columns, rows: rows.map(({ at, ...row }) => ({ ...row, when: at })), chart: options.chart };
}

// An athlete's fumbles lost each game this season, by ESPN event id, from ESPN's per-game box scores
// (null when they can't be read)
async function espnFumblesLost(league: string, id: number | string, season: number): Promise<Map<string, string> | null> {
  const [sport, code] = league.split('/');
  const base = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${code}`;
  try {
    const log = await (await fetch(`${base}/seasons/${season}/athletes/${id}/eventlog?limit=50`)).json();
    const items: { event?: { $ref?: string }; statistics?: { $ref?: string }; played?: boolean }[] = log.events?.items ?? [];
    const pairs = await Promise.all(
      items
        .filter((item) => item.played && item.statistics?.$ref)
        .map(async (item) => {
          const event = item.event?.$ref?.match(/events\/(\d+)/)?.[1] ?? '';
          const stats = await (await fetch(item.statistics!.$ref!.replace(/^http:/, 'https:'))).json();
          const general = (stats.splits?.categories ?? []).find((c: { name: string }) => c.name === 'general');
          const lost = general?.stats?.find((s: { name: string }) => s.name === 'fumblesLost')?.value;
          return [event, lost === undefined ? '-' : String(lost)] as [string, string];
        }),
    );
    return new Map(pairs);
  } catch {
    return null;
  }
}

interface MlbSplit {
  date: string;
  isHome: boolean;
  isWin: boolean;
  opponent?: { id?: number; name?: string; abbreviation?: string };
  stat: Record<string, string | number>;
}

// An MLB player's game log for a season (MLB's stats API: hitting or pitching), the columns given as
// [label, the API's stat], newest first
export async function mlbGameLog(
  id: number | string,
  season: number,
  group: 'hitting' | 'pitching',
  columns: [string, string][],
  options: { chart?: GameLogChart } = {},
): Promise<GameLog> {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&season=${season}&group=${group}&hydrate=team`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as { stats?: { splits?: MlbSplit[] }[] };
  const splits = [...(data.stats?.[0]?.splits ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const cols = columns.map(([label]) => ({ label }));
  return {
    columns: cols,
    rows: splits.map((split) => ({
      date: day(`${split.date}T12:00:00`),
      when: split.date,
      vs: `${split.isHome ? 'vs' : '@'} ${split.opponent?.abbreviation ?? split.opponent?.name ?? ''}`.trim(),
      logo: split.opponent?.id ? `https://www.mlbstatic.com/team-logos/${split.opponent.id}.svg` : undefined,
      result: split.isWin ? 'W' : 'L',
      values: columns.map(([, key]) => String(split.stat[key] ?? '-')),
    })),
    chart: options.chart,
  };
}

// ---- teams: ESPN's schedule, the games played (regular season and playoffs), each with the score, the
// record after it and the team's leader that game

// ESPN's teams (the teams list doesn't let the site ask, the schedules do): [id, abbreviation, name, nickname]
const ESPN_TEAMS: Record<string, [string, string, string, string][]> = {
  'football/nfl': [
    ['22', 'ARI', 'Arizona Cardinals', 'Cardinals'],
    ['1', 'ATL', 'Atlanta Falcons', 'Falcons'],
    ['33', 'BAL', 'Baltimore Ravens', 'Ravens'],
    ['2', 'BUF', 'Buffalo Bills', 'Bills'],
    ['29', 'CAR', 'Carolina Panthers', 'Panthers'],
    ['3', 'CHI', 'Chicago Bears', 'Bears'],
    ['4', 'CIN', 'Cincinnati Bengals', 'Bengals'],
    ['5', 'CLE', 'Cleveland Browns', 'Browns'],
    ['6', 'DAL', 'Dallas Cowboys', 'Cowboys'],
    ['7', 'DEN', 'Denver Broncos', 'Broncos'],
    ['8', 'DET', 'Detroit Lions', 'Lions'],
    ['9', 'GB', 'Green Bay Packers', 'Packers'],
    ['34', 'HOU', 'Houston Texans', 'Texans'],
    ['11', 'IND', 'Indianapolis Colts', 'Colts'],
    ['30', 'JAX', 'Jacksonville Jaguars', 'Jaguars'],
    ['12', 'KC', 'Kansas City Chiefs', 'Chiefs'],
    ['13', 'LV', 'Las Vegas Raiders', 'Raiders'],
    ['24', 'LAC', 'Los Angeles Chargers', 'Chargers'],
    ['14', 'LAR', 'Los Angeles Rams', 'Rams'],
    ['15', 'MIA', 'Miami Dolphins', 'Dolphins'],
    ['16', 'MIN', 'Minnesota Vikings', 'Vikings'],
    ['17', 'NE', 'New England Patriots', 'Patriots'],
    ['18', 'NO', 'New Orleans Saints', 'Saints'],
    ['19', 'NYG', 'New York Giants', 'Giants'],
    ['20', 'NYJ', 'New York Jets', 'Jets'],
    ['21', 'PHI', 'Philadelphia Eagles', 'Eagles'],
    ['23', 'PIT', 'Pittsburgh Steelers', 'Steelers'],
    ['25', 'SF', 'San Francisco 49ers', '49ers'],
    ['26', 'SEA', 'Seattle Seahawks', 'Seahawks'],
    ['27', 'TB', 'Tampa Bay Buccaneers', 'Buccaneers'],
    ['10', 'TEN', 'Tennessee Titans', 'Titans'],
    ['28', 'WSH', 'Washington Commanders', 'Commanders'],
  ],
  'basketball/nba': [
    ['1', 'ATL', 'Atlanta Hawks', 'Hawks'],
    ['2', 'BOS', 'Boston Celtics', 'Celtics'],
    ['17', 'BKN', 'Brooklyn Nets', 'Nets'],
    ['30', 'CHA', 'Charlotte Hornets', 'Hornets'],
    ['4', 'CHI', 'Chicago Bulls', 'Bulls'],
    ['5', 'CLE', 'Cleveland Cavaliers', 'Cavaliers'],
    ['6', 'DAL', 'Dallas Mavericks', 'Mavericks'],
    ['7', 'DEN', 'Denver Nuggets', 'Nuggets'],
    ['8', 'DET', 'Detroit Pistons', 'Pistons'],
    ['9', 'GS', 'Golden State Warriors', 'Warriors'],
    ['10', 'HOU', 'Houston Rockets', 'Rockets'],
    ['11', 'IND', 'Indiana Pacers', 'Pacers'],
    ['12', 'LAC', 'LA Clippers', 'Clippers'],
    ['13', 'LAL', 'Los Angeles Lakers', 'Lakers'],
    ['29', 'MEM', 'Memphis Grizzlies', 'Grizzlies'],
    ['14', 'MIA', 'Miami Heat', 'Heat'],
    ['15', 'MIL', 'Milwaukee Bucks', 'Bucks'],
    ['16', 'MIN', 'Minnesota Timberwolves', 'Timberwolves'],
    ['3', 'NO', 'New Orleans Pelicans', 'Pelicans'],
    ['18', 'NY', 'New York Knicks', 'Knicks'],
    ['25', 'OKC', 'Oklahoma City Thunder', 'Thunder'],
    ['19', 'ORL', 'Orlando Magic', 'Magic'],
    ['20', 'PHI', 'Philadelphia 76ers', '76ers'],
    ['21', 'PHX', 'Phoenix Suns', 'Suns'],
    ['22', 'POR', 'Portland Trail Blazers', 'Trail Blazers'],
    ['23', 'SAC', 'Sacramento Kings', 'Kings'],
    ['24', 'SA', 'San Antonio Spurs', 'Spurs'],
    ['28', 'TOR', 'Toronto Raptors', 'Raptors'],
    ['26', 'UTAH', 'Utah Jazz', 'Jazz'],
    ['27', 'WSH', 'Washington Wizards', 'Wizards'],
  ],
  'baseball/mlb': [
    ['29', 'ARI', 'Arizona Diamondbacks', 'Diamondbacks'],
    ['11', 'ATH', 'Athletics', 'Athletics'],
    ['15', 'ATL', 'Atlanta Braves', 'Braves'],
    ['1', 'BAL', 'Baltimore Orioles', 'Orioles'],
    ['2', 'BOS', 'Boston Red Sox', 'Red Sox'],
    ['16', 'CHC', 'Chicago Cubs', 'Cubs'],
    ['4', 'CHW', 'Chicago White Sox', 'White Sox'],
    ['17', 'CIN', 'Cincinnati Reds', 'Reds'],
    ['5', 'CLE', 'Cleveland Guardians', 'Guardians'],
    ['27', 'COL', 'Colorado Rockies', 'Rockies'],
    ['6', 'DET', 'Detroit Tigers', 'Tigers'],
    ['18', 'HOU', 'Houston Astros', 'Astros'],
    ['7', 'KC', 'Kansas City Royals', 'Royals'],
    ['3', 'LAA', 'Los Angeles Angels', 'Angels'],
    ['19', 'LAD', 'Los Angeles Dodgers', 'Dodgers'],
    ['28', 'MIA', 'Miami Marlins', 'Marlins'],
    ['8', 'MIL', 'Milwaukee Brewers', 'Brewers'],
    ['9', 'MIN', 'Minnesota Twins', 'Twins'],
    ['21', 'NYM', 'New York Mets', 'Mets'],
    ['10', 'NYY', 'New York Yankees', 'Yankees'],
    ['22', 'PHI', 'Philadelphia Phillies', 'Phillies'],
    ['23', 'PIT', 'Pittsburgh Pirates', 'Pirates'],
    ['25', 'SD', 'San Diego Padres', 'Padres'],
    ['26', 'SF', 'San Francisco Giants', 'Giants'],
    ['12', 'SEA', 'Seattle Mariners', 'Mariners'],
    ['24', 'STL', 'St. Louis Cardinals', 'Cardinals'],
    ['30', 'TB', 'Tampa Bay Rays', 'Rays'],
    ['13', 'TEX', 'Texas Rangers', 'Rangers'],
    ['14', 'TOR', 'Toronto Blue Jays', 'Blue Jays'],
    ['20', 'WSH', 'Washington Nationals', 'Nationals'],
  ],
  'hockey/nhl': [
    ['25', 'ANA', 'Anaheim Ducks', 'Ducks'],
    ['1', 'BOS', 'Boston Bruins', 'Bruins'],
    ['2', 'BUF', 'Buffalo Sabres', 'Sabres'],
    ['3', 'CGY', 'Calgary Flames', 'Flames'],
    ['7', 'CAR', 'Carolina Hurricanes', 'Hurricanes'],
    ['4', 'CHI', 'Chicago Blackhawks', 'Blackhawks'],
    ['17', 'COL', 'Colorado Avalanche', 'Avalanche'],
    ['29', 'CBJ', 'Columbus Blue Jackets', 'Blue Jackets'],
    ['9', 'DAL', 'Dallas Stars', 'Stars'],
    ['5', 'DET', 'Detroit Red Wings', 'Red Wings'],
    ['6', 'EDM', 'Edmonton Oilers', 'Oilers'],
    ['26', 'FLA', 'Florida Panthers', 'Panthers'],
    ['8', 'LA', 'Los Angeles Kings', 'Kings'],
    ['30', 'MIN', 'Minnesota Wild', 'Wild'],
    ['10', 'MTL', 'Montreal Canadiens', 'Canadiens'],
    ['27', 'NSH', 'Nashville Predators', 'Predators'],
    ['11', 'NJ', 'New Jersey Devils', 'Devils'],
    ['12', 'NYI', 'New York Islanders', 'Islanders'],
    ['13', 'NYR', 'New York Rangers', 'Rangers'],
    ['14', 'OTT', 'Ottawa Senators', 'Senators'],
    ['15', 'PHI', 'Philadelphia Flyers', 'Flyers'],
    ['16', 'PIT', 'Pittsburgh Penguins', 'Penguins'],
    ['18', 'SJ', 'San Jose Sharks', 'Sharks'],
    ['124292', 'SEA', 'Seattle Kraken', 'Kraken'],
    ['19', 'STL', 'St. Louis Blues', 'Blues'],
    ['20', 'TB', 'Tampa Bay Lightning', 'Lightning'],
    ['21', 'TOR', 'Toronto Maple Leafs', 'Maple Leafs'],
    ['129764', 'UTAH', 'Utah Mammoth', 'Mammoth'],
    ['22', 'VAN', 'Vancouver Canucks', 'Canucks'],
    ['37', 'VGK', 'Vegas Golden Knights', 'Golden Knights'],
    ['23', 'WSH', 'Washington Capitals', 'Capitals'],
    ['28', 'WPG', 'Winnipeg Jets', 'Jets'],
  ],
};

// A row's team on ESPN, from what the row knows: its team's full name, its own name (a team row's), or
// its logo's file name (a nickname, or an abbreviation). Earlier seasons' names are today's franchise
// (ESPN keeps a franchise's past seasons under its current team), or ESPN's own id for one it moved on
// from (the Coyotes, before Utah)
const NICKNAMES: Record<string, string> = {
  bucs: 'buccaneers',
  // NBA
  'seattle supersonics': 'oklahoma city thunder',
  'new jersey nets': 'brooklyn nets',
  'charlotte bobcats': 'charlotte hornets',
  'new orleans hornets': 'new orleans pelicans',
  'new orleans/oklahoma city hornets': 'new orleans pelicans',
  'vancouver grizzlies': 'memphis grizzlies',
  // MLB
  'montreal expos': 'washington nationals',
  'florida marlins': 'miami marlins',
  'anaheim angels': 'los angeles angels',
  'los angeles angels of anaheim': 'los angeles angels',
  'tampa bay devil rays': 'tampa bay rays',
  'cleveland indians': 'cleveland guardians',
  'oakland athletics': 'athletics',
  // NHL
  'atlanta thrashers': 'winnipeg jets',
  'mighty ducks of anaheim': 'anaheim ducks',
  'phoenix coyotes': 'id:24',
  'arizona coyotes': 'id:24',
};
// A team's names on ESPN (its full name and its nickname) by its abbreviation, or none
export function espnTeamNames(league: string, abbreviation: string): string[] {
  const team = (ESPN_TEAMS[league] ?? []).find((t) => t[1].toLowerCase() === abbreviation.toLowerCase());
  return team ? [team[2], team[3]] : [];
}

export function espnTeamId(league: string, names: (string | undefined)[]): string {
  const id = findEspnTeamId(league, names);
  if (id === null) throw new Error(`no ESPN team for ${names.join(' / ')}`);
  return id;
}

// (null when none matches: for the places that just do without)
export function findEspnTeamId(league: string, names: (string | undefined)[]): string | null {
  const teams = ESPN_TEAMS[league] ?? [];
  const wanted = names.filter((n): n is string => !!n).map((n) => NICKNAMES[n.toLowerCase()] ?? n.toLowerCase());
  for (const name of wanted) {
    if (name.startsWith('id:')) return name.slice(3);
    const team = teams.find((t) => t.slice(1).some((x) => x.toLowerCase() === name));
    if (team) return team[0];
  }
  return null;
}

export interface EspnScheduleEvent {
  id: string;
  date: string;
  seasonType?: { type?: number };
  competitions: {
    status?: { period?: number; type?: { completed?: boolean } };
    broadcasts?: { media?: { shortName?: string } }[];
    competitors: {
      homeAway: 'home' | 'away';
      winner?: boolean;
      score?: { value?: number; displayValue?: string };
      record?: { type?: string; displayValue?: string }[];
      team: { id: string; abbreviation: string; logos?: { href: string }[]; logo?: string };
      leaders?: { displayName?: string; abbreviation?: string; leaders?: { displayValue?: string; athlete?: { shortName?: string } }[] }[];
    }[];
  }[];
}

export const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports';

// A team's schedule this season, regular season and playoffs (each team's asked once a visit, for its
// game log, its games to come, its Recent squares and the game view alike)
const schedules = new Map<string, Promise<EspnScheduleEvent[]>>();
export function espnSchedule(league: string, id: string, season: number): Promise<EspnScheduleEvent[]> {
  return memo(schedules, `${league}/${id}/${season}`, () =>
    Promise.all(
      [2, 3].map((type) => fetchJson<{ events?: EspnScheduleEvent[] }>(`${ESPN_API}/${league}/teams/${id}/schedule?season=${season}&seasontype=${type}`, { events: [] })),
    ).then((pages) => pages.flatMap((p) => p.events ?? [])),
  );
}

// A team's games this season, newest first: PF, PA, the record after the game and its leader (the first
// of ESPN's leaders: points, or passing); regulation decides "OT" (4 periods, or 3 for hockey, 9 innings)
export async function espnTeamGameLog(league: string, names: (string | undefined)[], season: number, regulation: number): Promise<GameLog> {
  const id = espnTeamId(league, names);
  const events = await espnSchedule(league, id, season);
  const rows: (GameLogRow & { at: string })[] = [];
  for (const event of events) {
    const game = event.competitions[0];
    if (!game?.status?.type?.completed) continue;
    const us = game.competitors.find((c) => c.team.id === id);
    const them = game.competitors.find((c) => c.team.id !== id);
    if (!us || !them) continue;
    const pf = us.score?.value ?? Number(us.score?.displayValue);
    const pa = them.score?.value ?? Number(them.score?.displayValue);
    const outcome = pf > pa ? 'W' : pf < pa ? 'L' : 'T';
    const ot = (game.status?.period ?? 0) > regulation ? ' OT' : '';
    const leader = us.leaders?.[0]?.leaders?.[0];
    rows.push({
      at: event.date,
      event: event.id,
      when: event.date,
      playoff: event.seasonType?.type === 3,
      date: day(event.date),
      vs: `${us.homeAway === 'home' ? 'vs' : '@'} ${them.team.abbreviation}`,
      logo: them.team.logos?.[0]?.href ?? them.team.logo,
      result: `${outcome} ${pf}-${pa}${ot}`,
      margin: pf - pa,
      values: [String(pf), String(pa), us.record?.find((r) => r.type === 'total')?.displayValue ?? us.record?.[0]?.displayValue ?? '-', leader ? `${leader.athlete?.shortName ?? ''} ${leader.displayValue ?? ''}`.trim() : '-'],
    });
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  // (ESPN names no leaders for baseball: no column)
  const leaders = rows.some((row) => row.values[3] !== '-');
  return {
    columns: [{ label: 'PF' }, { label: 'PA' }, { label: 'Record' }, ...(leaders ? [{ label: 'Leader', wide: true }] : [])],
    rows: rows.map(({ at: _at, ...row }) => ({ ...row, values: leaders ? row.values : row.values.slice(0, 3) })),
    chartLabel: league.startsWith('baseball') ? 'Run margin' : league.startsWith('hockey') ? 'Goal margin' : 'Point margin',
  };
}

// ---- the games to come: a team's rest of the season, the nearest with the sportsbook's line (ESPN's scoreboard
// carries DraftKings' once it's posted, usually the week of the game)

interface EspnOdds {
  details?: string;
  overUnder?: number;
  moneyline?: { home?: { close?: { odds?: string } }; away?: { close?: { odds?: string } } };
}
// A day's scoreboard (by its date in New York, as ESPN files games), each game's odds by its id
const boards = new Map<string, Promise<Map<string, EspnOdds>>>();
function oddsOn(league: string, date: Date): Promise<Map<string, EspnOdds>> {
  const day = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  return memo(boards, `${league}/${day}`, () =>
    fetchJson<{ events?: { id: string; competitions?: { odds?: EspnOdds[] }[] }[] }>(`${ESPN_API}/${league}/scoreboard?dates=${day}`, { events: [] }).then(
      (data) => new Map<string, EspnOdds>((data.events ?? []).map((e) => [e.id, e.competitions?.[0]?.odds?.[0] ?? {}])),
    ),
  );
}

// The rest of a row's team's season (by the names it knows, as for its log), soonest first; the games in
// the coming week with their line
export async function espnUpcoming(league: string, names: (string | undefined)[], season: number, count = Infinity): Promise<UpcomingGame[]> {
  const id = espnTeamId(league, names);
  const now = Date.now();
  const games = (await espnSchedule(league, id, season))
    .filter((e) => !e.competitions[0]?.status?.type?.completed && Date.parse(e.date) > now - 4 * 3600e3)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
  return Promise.all(
    games.map(async (event) => {
      const game = event.competitions[0];
      const us = game.competitors.find((c) => c.team.id === id);
      const them = game.competitors.find((c) => c.team.id !== id);
      const when = new Date(event.date);
      const upcoming: UpcomingGame = {
        event: event.id,
        date: day(event.date),
        time: when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        vs: `${us?.homeAway === 'home' ? 'vs' : '@'} ${them?.team.abbreviation ?? ''}`.trim(),
        logo: them?.team.logos?.[0]?.href ?? them?.team.logo,
        tv: game.broadcasts?.[0]?.media?.shortName,
      };
      if (Date.parse(event.date) - now < 8 * 864e5) {
        const odds = (await oddsOn(league, when)).get(event.id);
        if (odds?.details) {
          upcoming.line = odds.details;
          if (odds.overUnder) upcoming.total = `O/U ${odds.overUnder}`;
          upcoming.moneyline = (us?.homeAway === 'home' ? odds.moneyline?.home : odds.moneyline?.away)?.close?.odds;
        }
      }
      return upcoming;
    }),
  );
}
