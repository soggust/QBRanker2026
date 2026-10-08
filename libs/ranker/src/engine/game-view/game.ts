// The game view (game-view.component): one game, from ESPN's game summary (any league it covers: the
// NFL, the NBA, the NHL, MLB). Read once and shaped the same for every sport: the two teams and the
// score by period, the venue (its photo, its city's weather at game time: Open-Meteo, outdoors only), the
// sportsbook's line and how it came out, the win probability play by play, each team's leaders, the
// team stats side by side, every player's line, and the plays (the NFL's by drive, the rest by period;
// MLB's at-bats without their pitches).
//
// A game is found by ESPN's event id when the page has it (a game log's row), or by its team, season
// and opponent (a Recent dot: the nth game against that opponent, newest first, on the team's schedule).

// ---- what the view shows

export interface GameTeam {
  id: string;
  name: string;
  short: string;
  abbr: string;
  logo: string | null;
  color: string;
  score: string;
  winner: boolean;
  record: string | null;
  // its score by period (the innings', the quarters', the periods' and overtime)
  periods: string[];
}

export interface GameLeader {
  category: string;
  name: string;
  short: string;
  line: string;
  headshot: string | null;
}

export interface GameTeamStat {
  label: string;
  away: string;
  home: string;
  // (each side's share of the two, for the bar: null when it isn't a number to compare)
  awayShare: number | null;
}

export interface GameBoxGroup {
  // ESPN's name for it ("passing", "rushing"; "batting", "pitching"), for fantasy scoring
  key: string;
  title: string;
  labels: string[];
  rows: { id: string; name: string; short: string; position: string | null; headshot: string | null; starter: boolean; values: string[]; dnp: string | null }[];
  totals: string[] | null;
}

export interface GameFantasy {
  side: 'away' | 'home';
  name: string;
  position: string | null;
  headshot: string | null;
  points: number;
  // what scored it ("285 pass yds", "2 pass TD", "6 rec")
  parts: string[];
}

// The game's chart: where the shots were (a court's, a rink's), where the balls in play landed (a spray
// chart), or the passes by zone (the NFL's: short or deep, left, middle or right, from the play-by-play)
export interface GameMark {
  // on the chart's own scale: a half court in feet (0-50 across, the rim at 5.25 down), a rink in feet
  // (0-200 across, 0-85 down: away shooting left, home right), a field in Gameday's units (home plate
  // at 125, 200)
  x: number;
  y: number;
  side: 'away' | 'home';
  // made, missed (or blocked), a goal; a hit, a home run, an out
  result: 'made' | 'missed' | 'goal' | 'hit' | 'hr' | 'out';
  text: string;
}

export interface GamePassZone {
  key: string;
  att: number;
  comp: number;
  yds: number;
  td: number;
  int: number;
}

export type GameChart =
  | { kind: 'court' | 'rink' | 'diamond'; marks: GameMark[] }
  | { kind: 'football'; drives: GameDrive[]; teams: { side: 'away' | 'home'; passers: string[]; zones: GamePassZone[] }[] };

// A drive on the field: where it started and ended (0 the home team's goal line, 100 the away team's)
export interface GameDrive {
  side: 'away' | 'home';
  start: number;
  end: number;
  result: string;
  scoring: boolean;
  label: string;
}

export interface GamePlay {
  clock: string | null;
  text: string;
  score: string | null;
  scoring: boolean;
  // its team's side: 'away' or 'home' (the tint), when it's known
  side: 'away' | 'home' | null;
  // the kind (a goal, a penalty, a home run...), for the filter
  kind: string | null;
  // a scoring play's scorer's headshot (the shooter, the goal scorer, the batter; the NFL's from its text)
  headshot: string | null;
}

export interface GamePlayGroup {
  title: string;
  // (a drive's summary and its result: "8 plays, 75 yards, 4:12" / "Touchdown")
  sub: string | null;
  result: string | null;
  side: 'away' | 'home' | null;
  logo: string | null;
  scoring: boolean;
  plays: GamePlay[];
}

export interface GameView {
  id: string;
  league: string;
  date: string;
  // not played yet: a preview (the line, the predictor, the injuries, each team's form; no score or plays)
  preview: boolean;
  // (a preview's: ESPN's matchup predictor, each team's chance to win, 0-1)
  predictor: { away: number; home: number } | null;
  injuries: { side: 'away' | 'home'; rows: { name: string; position: string | null; status: string; detail: string | null; headshot: string | null }[] }[];
  // each team's last five games, newest first (ESPN's: each opens its game)
  form: { side: 'away' | 'home'; games: { event: string; result: string; score: string; vs: string; logo: string | null }[] }[];
  broadcast: string | null;
  // "Final", "Final/OT"
  status: string;
  // "Week 5", "Wild Card", "World Series - Game 3"
  label: string | null;
  neutral: boolean;
  away: GameTeam;
  home: GameTeam;
  periodLabels: string[];
  venue: { name: string; city: string | null; state: string | null; image: string | null; grass: boolean | null; roof: 'indoors' | 'retractable' | 'outdoors' } | null;
  attendance: number | null;
  officials: { name: string; role: string | null }[];
  duration: string | null;
  // the line before the game, and how the game came out against it
  line: { book: string | null; details: string; overUnder: number | null; spread: string | null; total: string | null } | null;
  // the home team's chance to win after each play (0-1), when ESPN has it
  winProbability: number[] | null;
  leaders: { side: 'away' | 'home'; rows: GameLeader[] }[];
  teamStats: GameTeamStat[];
  box: { side: 'away' | 'home'; groups: GameBoxGroup[] }[];
  // the chart (none when the play-by-play doesn't place anything)
  chart: GameChart | null;
  // each player's fantasy points from his line (the sport's usual scoring), best first, and the scoring
  fantasy: GameFantasy[];
  fantasyScoring: string;
  plays: GamePlayGroup[];
  // the plays are drives (the NFL's)
  drives: boolean;
}

// ---- ESPN's game summary, the parts read

interface EspnTeamRef {
  id: string;
  alternateColor?: string;
  abbreviation?: string;
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  color?: string;
  logos?: { href: string }[];
  logo?: string;
}
interface EspnAthlete {
  id?: string;
  displayName?: string;
  shortName?: string;
  headshot?: { href?: string } | string;
  position?: { abbreviation?: string };
}
interface EspnPlay {
  id?: string;
  type?: { text?: string; type?: string; abbreviation?: string };
  text?: string;
  awayScore?: number;
  homeScore?: number;
  period?: { number?: number; displayValue?: string; type?: string };
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  shootingPlay?: boolean;
  participants?: { type?: string; athlete?: { id?: string } }[];
  coordinate?: { x?: number; y?: number };
  hitCoordinate?: { x?: number; y?: number };
  team?: { id?: string };
}
interface EspnSummary {
  header?: {
    week?: number;
    season?: { year?: number; type?: number };
    gameNote?: string;
    competitions?: {
      date?: string;
      neutralSite?: boolean;
      status?: { type?: { detail?: string; shortDetail?: string; description?: string; completed?: boolean; state?: string } };
      broadcasts?: { media?: { shortName?: string } }[];
      competitors?: {
        homeAway: 'home' | 'away';
        winner?: boolean;
        score?: string;
        team: EspnTeamRef;
        record?: { type?: string; summary?: string; displayValue?: string }[];
        linescores?: { displayValue?: string }[];
      }[];
    }[];
  };
  gameInfo?: {
    venue?: { fullName?: string; address?: { city?: string; state?: string }; grass?: boolean; images?: { href?: string }[] };
    attendance?: number;
    officials?: { displayName?: string; position?: { displayName?: string } }[];
    gameDuration?: string;
  };
  pickcenter?: {
    provider?: { name?: string };
    details?: string;
    overUnder?: number;
    spread?: number;
    homeTeamOdds?: { favorite?: boolean };
    awayTeamOdds?: { favorite?: boolean };
  }[];
  winprobability?: { homeWinPercentage?: number }[];
  predictor?: { homeTeam?: { id?: string; gameProjection?: string }; awayTeam?: { id?: string; gameProjection?: string } };
  injuries?: {
    team?: { id?: string };
    injuries?: { status?: string; athlete?: EspnAthlete; details?: { type?: string; detail?: string; returnDate?: string } }[];
  }[];
  lastFiveGames?: {
    team?: { id?: string };
    events?: { id?: string; gameResult?: string; score?: string; atVs?: string; opponent?: { abbreviation?: string; logo?: string }; opponentLogo?: string }[];
  }[];
  leaders?: { team?: { id?: string }; leaders?: { displayName?: string; leaders?: { displayValue?: string; athlete?: EspnAthlete }[] }[] }[];
  boxscore?: {
    teams?: { team?: { id?: string }; statistics?: { name?: string; label?: string; displayName?: string; abbreviation?: string; displayValue?: string; stats?: { abbreviation?: string; displayName?: string; displayValue?: string }[] }[] }[];
    players?: {
      team?: { id?: string };
      statistics?: {
        name?: string;
        text?: string;
        type?: string;
        labels?: string[];
        totals?: string[];
        athletes?: { athlete?: EspnAthlete; starter?: boolean; didNotPlay?: boolean; reason?: string; stats?: string[] }[];
      }[];
    }[];
  };
  plays?: EspnPlay[];
  drives?: {
    previous?: {
      description?: string;
      displayResult?: string;
      result?: string;
      isScore?: boolean;
      team?: EspnTeamRef;
      start?: { period?: { number?: number }; clock?: { displayValue?: string }; yardLine?: number };
      end?: { yardLine?: number };
      yards?: number;
      offensivePlays?: number;
      plays?: EspnPlay[];
    }[];
  };
}

const API = 'https://site.api.espn.com/apis/site/v2/sports';

// ---- finding a game

// A Recent dot's game: its team's nth game against that opponent (home or away), newest first, among the
// season's finished games (the regular season's and the playoffs')
interface ScheduleEvent {
  id: string;
  date: string;
  competitions: { status?: { type?: { completed?: boolean } }; competitors: { homeAway: 'home' | 'away'; team: { id: string } }[] }[];
}

export async function findGame(
  league: string,
  teamId: string,
  opponentId: string,
  home: boolean | null,
  season: number,
  nth: number,
): Promise<string | null> {
  const pages = await Promise.all(
    [2, 3].map((type) =>
      fetch(`${API}/${league}/teams/${teamId}/schedule?season=${season}&seasontype=${type}`)
        .then((r) => (r.ok ? r.json() : { events: [] }))
        .catch(() => ({ events: [] })),
    ),
  );
  const games = pages
    .flatMap((p) => (p.events ?? []) as ScheduleEvent[])
    .filter((e) => e.competitions[0]?.status?.type?.completed)
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((e) => {
      const us = e.competitions[0].competitors.find((c) => c.team.id === teamId);
      const them = e.competitions[0].competitors.find((c) => c.team.id !== teamId);
      return them?.team.id === opponentId && (home === null || (us?.homeAway === 'home') === home);
    });
  return games[nth]?.id ?? null;
}

// A game by its date and a team in it (a game log's row without ESPN's id: MLB's and the NHL's player
// logs): that day's scoreboard, the game with that team's abbreviation or name
export async function findGameOn(league: string, date: string, names: string[]): Promise<string | null> {
  const day = date.slice(0, 10).replace(/-/g, '');
  const board = await fetch(`${API}/${league}/scoreboard?dates=${day}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const wanted = names.map((n) => n.toLowerCase());
  const events = (board?.events ?? []) as { id: string; competitions: { competitors: { team: EspnTeamRef }[] }[] }[];
  const event = events.find((e) =>
    e.competitions[0]?.competitors.some((c) =>
      [c.team.abbreviation, c.team.displayName, c.team.shortDisplayName, c.team.name].some((x) => x && wanted.includes(x.toLowerCase())),
    ),
  );
  return event?.id ?? null;
}

// ---- reading it

const headshotOf = (a: EspnAthlete | undefined): string | null => (typeof a?.headshot === 'string' ? a.headshot : (a?.headshot?.href ?? null));
const logoOf = (t: EspnTeamRef | undefined): string | null => t?.logos?.[0]?.href ?? t?.logo ?? null;
const numberOf = (text: string): number | null => {
  const m = text.match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// The roofed parks and stadiums (no weather): domes and fixed roofs, then the retractable roofs
const INDOORS = /mercedes-benz stadium|ford field|caesars superdome|superdome|u\.s\. bank stadium|allegiant|sofi stadium|tropicana field|edward jones dome|the dome at america's center|georgia dome|metrodome|rca dome|silverdome|kingdome|olympic stadium/i;
const RETRACTABLE = /at&t stadium|lucas oil|nrg stadium|state farm stadium|university of phoenix stadium|rogers centre|chase field|minute maid|daikin park|loandepot|marlins park|american family field|miller park|t-mobile park|safeco field|globe life field/i;

export async function loadGame(league: string, eventId: string): Promise<GameView> {
  const res = await fetch(`${API}/${league}/summary?event=${eventId}`);
  if (!res.ok) throw new Error(`game ${eventId}: ${res.status}`);
  const s = (await res.json()) as EspnSummary;
  const comp = s.header?.competitions?.[0];
  if (!comp?.competitors?.length) throw new Error(`game ${eventId}: no teams`);

  const team = (side: 'home' | 'away'): GameTeam => {
    const c = comp.competitors!.find((x) => x.homeAway === side)!;
    return {
      id: c.team.id,
      name: c.team.displayName ?? c.team.name ?? c.team.abbreviation ?? '',
      short: c.team.shortDisplayName ?? c.team.name ?? c.team.abbreviation ?? '',
      abbr: c.team.abbreviation ?? '',
      logo: logoOf(c.team),
      color: teamColor(c.team.color, c.team.alternateColor ?? BLACK_TEAMS[c.team.abbreviation ?? '']),
      score: c.score ?? '',
      winner: !!c.winner,
      record: c.record?.find((r) => r.type === 'total')?.summary ?? c.record?.[0]?.summary ?? c.record?.[0]?.displayValue ?? null,
      periods: (c.linescores ?? []).map((l) => l.displayValue ?? ''),
    };
  };
  const away = team('away');
  const home = team('home');
  const sideOf = (id: string | undefined): 'away' | 'home' | null => (id === away.id ? 'away' : id === home.id ? 'home' : null);

  // The periods' names: quarters, periods, innings, then overtime
  const count = Math.max(away.periods.length, home.periods.length);
  const regulation = league.includes('hockey') ? 3 : league.includes('baseball') ? 9 : 4;
  const periodLabels = Array.from({ length: count }, (_, i) => {
    if (i < regulation || league.includes('baseball')) return String(i + 1);
    // (hockey: one overtime, then the shootout; the others: OT, 2OT, 3OT...)
    if (league.includes('hockey')) return i === regulation ? 'OT' : 'SO';
    return i === regulation ? 'OT' : `${i - regulation + 1}OT`;
  });

  const info = s.gameInfo;
  const venueName = info?.venue?.fullName ?? null;
  const indoorSport = league.includes('basketball') || league.includes('hockey');
  const venue = venueName
    ? {
        name: venueName,
        city: info?.venue?.address?.city ?? null,
        state: info?.venue?.address?.state ?? null,
        image: info?.venue?.images?.[0]?.href ?? null,
        grass: info?.venue?.grass ?? null,
        roof: (indoorSport || INDOORS.test(venueName) ? 'indoors' : RETRACTABLE.test(venueName) ? 'retractable' : 'outdoors') as 'indoors' | 'retractable' | 'outdoors',
      }
    : null;

  // The line, and how it came out: the favorite covered or not, the total over or under
  const pick = s.pickcenter?.[0];
  let line: GameView['line'] = null;
  const played = !!comp.status?.type?.completed;
  if (pick?.details) {
    const total = Number(away.score) + Number(home.score);
    let spread: string | null = null;
    // (the line names its favorite: "BAL -6.5"; the favorite covers by winning by more than that)
    const fav = pick.details.match(/^(\S+)\s+(-\d+(?:\.\d+)?)/);
    const favorite = fav ? [home, away].find((t) => t.abbr === fav[1]) : undefined;
    if (favorite && fav && played) {
      const dog = favorite === home ? away : home;
      const against = Number(favorite.score) - Number(dog.score) + Number(fav[2]);
      // (hockey's and baseball's lines are moneylines: who won, the favorite or an upset)
      const moneyline = league.includes('hockey') || league.includes('baseball');
      if (moneyline) spread = Number(favorite.score) > Number(dog.score) ? `${favorite.abbr} won` : `${dog.abbr} upset`;
      else if (Number.isFinite(against)) spread = against === 0 ? 'Push' : `${against > 0 ? favorite.abbr : dog.abbr} covered`;
    }
    const ou = typeof pick.overUnder === 'number' ? pick.overUnder : null;
    line = {
      book: pick.provider?.name ?? null,
      details: pick.details,
      overUnder: ou,
      spread,
      total: ou === null || !played || !Number.isFinite(total) ? null : total > ou ? 'Over' : total < ou ? 'Under' : 'Push',
    };
  }

  // Each team's leaders (ESPN's categories: passing, rushing, receiving; points, rebounds, assists...)
  const leaders = (s.leaders ?? [])
    .map((t) => ({
      side: sideOf(t.team?.id),
      rows: (t.leaders ?? [])
        .map((cat) => {
          const top = cat.leaders?.[0];
          return top?.athlete
            ? { category: cat.displayName ?? '', name: top.athlete.displayName ?? '', short: top.athlete.shortName ?? top.athlete.displayName ?? '', line: top.displayValue ?? '', headshot: headshotOf(top.athlete) }
            : null;
        })
        .filter((r): r is GameLeader => !!r),
    }))
    .filter((t): t is { side: 'away' | 'home'; rows: GameLeader[] } => !!t.side && t.rows.length > 0)
    .sort((a) => (a.side === 'away' ? -1 : 1));

  // The team stats side by side (MLB's in groups: its batting and fielding lines that matter)
  const MLB_STATS = ['R', 'H', 'HR', 'RBI', 'BB', 'K', 'SB', 'LOB', 'E'];
  const statsOf = (id: string): Map<string, string> => {
    const t = s.boxscore?.teams?.find((x) => x.team?.id === id);
    const out = new Map<string, string>();
    for (const st of t?.statistics ?? []) {
      if (st.stats) {
        for (const x of st.stats) if (x.abbreviation && MLB_STATS.includes(x.abbreviation) && !out.has(x.abbreviation)) out.set(x.abbreviation, x.displayValue ?? '');
      } else if (st.label ?? st.displayName) out.set(st.label ?? st.displayName ?? '', st.displayValue ?? '');
    }
    return out;
  };
  const awayStats = statsOf(away.id);
  const homeStats = statsOf(home.id);
  const order = league.includes('baseball') ? MLB_STATS.filter((k) => awayStats.has(k)) : [...awayStats.keys()];
  const teamStats: GameTeamStat[] = order
    .filter((label) => homeStats.has(label))
    .map((label) => {
      const a = awayStats.get(label)!;
      const h = homeStats.get(label)!;
      const an = numberOf(a);
      const hn = numberOf(h);
      // (a share only for plain counts and rates, not "5-12" or "31:04")
      const plain = /^-?\d+(\.\d+)?%?$/;
      return { label, away: a, home: h, awayShare: an !== null && hn !== null && plain.test(a) && plain.test(h) && an + hn > 0 ? an / (an + hn) : null };
    });

  // Every player's line, by the box score's groups (passing, rushing...; one group for basketball)
  const box = (s.boxscore?.players ?? [])
    .map((t) => ({
      side: sideOf(t.team?.id),
      groups: (t.statistics ?? [])
        .filter((g) => (g.athletes ?? []).length)
        .map((g) => ({
          key: (g.name ?? g.type ?? '').toLowerCase(),
          title: g.text ?? (g.name ? g.name[0].toUpperCase() + g.name.slice(1) : g.type ? g.type[0].toUpperCase() + g.type.slice(1) : ''),
          labels: g.labels ?? [],
          rows: (g.athletes ?? []).map((a) => ({
            id: a.athlete?.id ?? '',
            name: a.athlete?.displayName ?? '',
            short: a.athlete?.shortName ?? a.athlete?.displayName ?? '',
            position: a.athlete?.position?.abbreviation ?? null,
            // (ESPN's headshot, or its picture by his id: the NFL's box score names none)
            headshot: headshotOf(a.athlete) ?? (a.athlete?.id ? `https://a.espncdn.com/i/headshots/${league.split('/')[1]}/players/full/${a.athlete.id}.png` : null),
            starter: !!a.starter,
            values: a.stats ?? [],
            dnp: a.didNotPlay ? (a.reason ?? 'DNP') : null,
          })),
          totals: g.totals?.length ? g.totals : null,
        })),
    }))
    .filter((t): t is { side: 'away' | 'home'; groups: GameBoxGroup[] } => !!t.side)
    .sort((a) => (a.side === 'away' ? -1 : 1));

  // The players' headshots by ESPN id, and by the play-by-play's short name ("D.Henry")
  const shortKey = (name: string) => name.toLowerCase().replace(/[\s.]/g, '');
  const faces = new Map<string, string>();
  const facesByName = new Map<string, string>();
  for (const t of box) {
    for (const g of t.groups) {
      for (const r of g.rows) {
        if (!r.headshot) continue;
        if (r.id) faces.set(r.id, r.headshot);
        facesByName.set(shortKey(r.short), r.headshot);
        // (and his first initial with his last name: "Derrick Henry" as the plays write him, "D.Henry")
        const [first, ...rest] = r.name.split(' ');
        if (first && rest.length) facesByName.set(shortKey(first[0] + rest.join('')), r.headshot);
      }
    }
  }
  // A scoring play's scorer: ESPN's scorer or batter, else the first named (the shooter); the NFL's from its
  // text (a return's defender, a catch's receiver, else the runner or kicker who starts it)
  const scorerFace = (p: EspnPlay): string | null => {
    if (!p.scoringPlay) return null;
    const parts = p.participants ?? [];
    const scorer = parts.find((x) => x.type === 'scorer' || x.type === 'batter') ?? parts[0];
    if (scorer?.athlete?.id) return faces.get(scorer.athlete.id) ?? null;
    const text = p.text ?? '';
    const name =
      text.match(/(?:INTERCEPTED|RECOVERED|returned) by ([A-Z]\.\s?[\w'-]+)/i)?.[1] ??
      text.match(/ pass .*? to ([A-Z]\.\s?[\w'-]+)/)?.[1] ??
      text.match(/^(?:\([^)]*\)\s*)*([A-Z]\.\s?[\w'-]+)/)?.[1];
    return name ? (facesByName.get(shortKey(name)) ?? null) : null;
  };

  // The plays
  const baseball = league.includes('baseball');
  const toPlay = (p: EspnPlay): GamePlay => ({
    clock: baseball ? null : (p.clock?.displayValue ?? null),
    text: p.text ?? '',
    score: p.awayScore !== undefined && p.homeScore !== undefined ? `${p.awayScore}-${p.homeScore}` : null,
    scoring: !!p.scoringPlay,
    side: sideOf(p.team?.id),
    kind: p.type?.text ?? null,
    headshot: scorerFace(p),
  });
  // (a play's period by name: ESPN's, or from its number: the NFL's scoring plays carry just that)
  const ORDINAL = ['1st', '2nd', '3rd', '4th'];
  const periodName = (p: EspnPlay): string => {
    if (baseball) return `${p.period?.type ?? ''} ${p.period?.displayValue ?? ''}`.trim();
    if (p.period?.displayValue) return p.period.displayValue;
    const n = p.period?.number ?? 0;
    const word = league.includes('hockey') ? 'Period' : 'Quarter';
    return n >= 1 && n <= regulation ? `${ORDINAL[n - 1]} ${word}` : 'Overtime';
  };

  let plays: GamePlayGroup[] = [];
  const drives = !!s.drives?.previous?.length;
  if (drives) {
    plays = s.drives!.previous!.map((d) => {
      const side = sideOf(d.team?.id);
      return {
        title: `${d.team?.abbreviation ?? ''} · Q${d.start?.period?.number ?? ''} ${d.start?.clock?.displayValue ?? ''}`.trim(),
        sub: d.description ?? null,
        result: d.displayResult ?? d.result ?? null,
        side,
        logo: logoOf(d.team),
        scoring: !!d.isScore,
        plays: (d.plays ?? []).filter((p) => p.text).map(toPlay),
      };
    });
  } else {
    // (MLB's: the at-bats' results and the events between them, not each pitch)
    const SKIP = /^(start|end)-(batterpitcher|inning)$/;
    const list = (s.plays ?? []).filter((p) => p.text && !(baseball && (SKIP.test(p.type?.type ?? '') || /^Pitch \d/.test(p.text ?? ''))));
    const groups = new Map<string, GamePlayGroup>();
    for (const p of list) {
      const title = periodName(p);
      if (!groups.has(title)) groups.set(title, { title, sub: null, result: null, side: null, logo: null, scoring: false, plays: [] });
      const g = groups.get(title)!;
      g.plays.push(toPlay(p));
      if (p.scoringPlay) g.scoring = true;
    }
    plays = [...groups.values()];
  }

  const status = comp.status?.type?.detail ?? comp.status?.type?.description ?? '';
  const week = s.header?.week;
  // (the NFL's games by week; the others' playoff games by their round, ESPN's note)
  const label = s.header?.gameNote ?? (s.header?.season?.type === 3 ? 'Playoffs' : week && league.includes('football') ? `Week ${week}` : null);

  // Fantasy points from the box score; and where ESPN names no leaders (baseball), each team's top three by them
  const fantasy = fantasyPoints(league, box);
  if (!leaders.length) {
    for (const side of ['away', 'home'] as const) {
      const rows = fantasy.fantasy
        .filter((p) => p.side === side)
        .slice(0, 3)
        .map((p) => ({ category: p.position ?? '', name: p.name, short: p.name, line: p.parts.join(', '), headshot: p.headshot }));
      if (rows.length) leaders.push({ side, rows });
    }
  }

  const chart = gameChart(league, s, sideOf);

  // A preview's: the predictor, the injury report, each team's last five, the broadcast
  const preview = comp.status?.type?.state === 'pre';
  const projection = (x: { gameProjection?: string } | undefined) => (x?.gameProjection ? Number(x.gameProjection) / 100 : null);
  const awayChance = projection(s.predictor?.awayTeam?.id === home.id ? s.predictor?.homeTeam : s.predictor?.awayTeam);
  const homeChance = projection(s.predictor?.awayTeam?.id === home.id ? s.predictor?.awayTeam : s.predictor?.homeTeam);
  const injuries = (s.injuries ?? [])
    .map((t) => ({
      side: sideOf(t.team?.id),
      rows: (t.injuries ?? []).map((i) => ({
        name: i.athlete?.displayName ?? '',
        position: i.athlete?.position?.abbreviation ?? null,
        status: i.status ?? '',
        detail: [i.details?.type, i.details?.returnDate ? `back ${new Date(i.details.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ') || null,
        headshot: headshotOf(i.athlete),
      })),
    }))
    .filter((t): t is GameView['injuries'][number] => !!t.side && t.rows.length > 0)
    .sort((a) => (a.side === 'away' ? -1 : 1));
  const form = (s.lastFiveGames ?? [])
    .map((t) => ({
      side: sideOf(t.team?.id),
      games: (t.events ?? []).map((e) => ({
        event: e.id ?? '',
        result: e.gameResult ?? '',
        score: e.score ?? '',
        vs: `${e.atVs === '@' ? '@' : 'vs'} ${e.opponent?.abbreviation ?? ''}`,
        logo: e.opponentLogo ?? e.opponent?.logo ?? null,
      })),
    }))
    .filter((t): t is GameView['form'][number] => !!t.side && t.games.length > 0)
    .sort((a) => (a.side === 'away' ? -1 : 1));

  return {
    id: eventId,
    league,
    date: comp.date ?? '',
    preview,
    predictor: awayChance !== null && homeChance !== null ? { away: awayChance, home: homeChance } : null,
    injuries,
    form,
    broadcast: comp.broadcasts?.[0]?.media?.shortName ?? null,
    status,
    label,
    neutral: !!comp.neutralSite,
    away,
    home,
    periodLabels,
    venue,
    attendance: info?.attendance || null,
    officials: (info?.officials ?? []).map((o) => ({ name: o.displayName ?? '', role: o.position?.displayName ?? null })),
    duration: info?.gameDuration ?? null,
    line,
    winProbability: s.winprobability?.length ? s.winprobability.map((w) => w.homeWinPercentage ?? 0.5) : null,
    leaders,
    teamStats,
    box,
    chart,
    ...fantasy,
    plays,
    drives,
  };
}

// ---- the weather at game time (outdoors only): the city's, from Open-Meteo (its geocoding, then the
// hours of the game: its archive for older games, its forecast's past days for recent ones)

export interface GameWeather {
  tempF: number | null;
  windMph: number | null;
  precipIn: number | null;
  sky: string;
}

const SKY = (code: number): string =>
  code >= 95 ? 'Thunderstorms' : code >= 85 ? 'Snow showers' : code >= 80 ? 'Rain showers' : code >= 71 ? 'Snow' : code >= 61 ? 'Rain' : code >= 51 ? 'Drizzle' : code >= 45 ? 'Fog' : code >= 3 ? 'Overcast' : code >= 1 ? 'Partly cloudy' : 'Clear';

export async function loadWeather(game: GameView): Promise<GameWeather | null> {
  if (!game.venue || game.venue.roof === 'indoors' || !game.venue.city || !game.date) return null;
  const place = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(game.venue.city)}&count=5`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const results = (place?.results ?? []) as { latitude: number; longitude: number; admin1?: string; country_code?: string }[];
  const state = (game.venue.state ?? '').toLowerCase();
  const at = results.find((r) => state && (r.admin1 ?? '').toLowerCase().startsWith(state.slice(0, 4))) ?? results[0];
  if (!at) return null;
  const start = new Date(game.date);
  const end = new Date(start.getTime() + 3 * 36e5);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const recent = Date.now() - start.getTime() < 60 * 864e5;
  const base = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const url =
    `${base}?latitude=${at.latitude}&longitude=${at.longitude}&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&start_date=${day(start)}&end_date=${day(end)}`;
  const data = await fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const h = data?.hourly as { time: string[]; temperature_2m: (number | null)[]; precipitation: (number | null)[]; wind_speed_10m: (number | null)[]; weather_code: (number | null)[] } | undefined;
  if (!h?.time?.length) return null;
  const hours = h.time.map((t, i) => ({ t: new Date(`${t}:00Z`), i })).filter(({ t }) => t >= new Date(start.getTime() - 36e5 + 1) && t < end).map(({ i }) => i);
  if (!hours.length) return null;
  const values = (key: 'temperature_2m' | 'precipitation' | 'wind_speed_10m' | 'weather_code') => hours.map((i) => h[key][i]).filter((v): v is number => v !== null && v !== undefined);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const temp = avg(values('temperature_2m'));
  const wind = avg(values('wind_speed_10m'));
  const precip = values('precipitation').reduce((a, b) => a + b, 0);
  const codes = values('weather_code');
  return {
    tempF: temp === null ? null : Math.round(temp),
    windMph: wind === null ? null : Math.round(wind),
    precipIn: Math.round(precip * 100) / 100,
    sky: codes.length ? SKY(Math.max(...codes)) : '',
  };
}

// ---- fantasy points from the box score: the NFL's PPR scoring; DraftKings' for the NBA, the NHL and MLB
// (a hit that isn't a home run counts as a single: the box score doesn't split them)

const FANTASY_SCORING: Record<string, string> = {
  football: 'PPR: 1 pt per 25 pass yds, 4 per pass TD, -2 per INT, 1 per 10 rush or rec yds, 6 per TD, 1 per catch, -2 per fumble lost; kickers 3 per FG, 1 per XP',
  basketball: 'DraftKings: 1 per pt, +0.5 per 3, 1.25 per reb, 1.5 per ast, 2 per stl or blk, -0.5 per TO, +1.5 double-double, +3 triple-double',
  hockey: 'DraftKings: 8.5 per goal, 5 per assist, 1.5 per shot, 1.3 per block; goalies 0.7 per save, -3.5 per goal against',
  baseball: 'DraftKings: 3 per hit (10 a HR), 2 per RBI, run or walk; pitchers 2.25 per inning, 2 per K, -2 per ER, -0.6 per hit or walk',
};

function fantasyPoints(league: string, box: GameView['box']): { fantasy: GameFantasy[]; fantasyScoring: string } {
  const sport = Object.keys(FANTASY_SCORING).find((k) => league.includes(k)) ?? '';
  const players = new Map<string, GameFantasy>();
  const num = (v: string | undefined) => {
    const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  // "17/25" or "3-7": the made part
  const made = (v: string | undefined) => num(String(v ?? '').split(/[/-]/)[0]);
  // innings: "6.1" is six and a third
  const innings = (v: string | undefined) => {
    const [whole, outs] = String(v ?? '0').split('.');
    return num(whole) + num(outs) / 3;
  };
  for (const team of box) {
    for (const g of team.groups) {
      for (const row of g.rows) {
        if (row.dnp) continue;
        const v = (label: string) => {
          const i = g.labels.indexOf(label);
          return i < 0 ? undefined : row.values[i];
        };
        const p = players.get(team.side + row.name) ?? { side: team.side, name: row.name, position: row.position, headshot: row.headshot, points: 0, parts: [] };
        // (its points, and the line as the box score writes it: "6.1 IP" for 6 1/3 innings)
        const add = (pts: number, amount: number, label: string, shown?: string) => {
          if (!amount) return;
          p.points += pts;
          p.parts.push(`${shown ?? (Number.isInteger(amount) ? amount : amount.toFixed(1))} ${label}`);
        };
        if (sport === 'football') {
          if (g.key === 'passing') {
            add(num(v('YDS')) * 0.04, num(v('YDS')), 'pass yds');
            add(num(v('TD')) * 4, num(v('TD')), 'pass TD');
            add(num(v('INT')) * -2, num(v('INT')), 'INT');
          } else if (g.key === 'rushing') {
            add(num(v('YDS')) * 0.1, num(v('YDS')), 'rush yds');
            add(num(v('TD')) * 6, num(v('TD')), 'rush TD');
          } else if (g.key === 'receiving') {
            add(num(v('REC')), num(v('REC')), 'rec');
            add(num(v('YDS')) * 0.1, num(v('YDS')), 'rec yds');
            add(num(v('TD')) * 6, num(v('TD')), 'rec TD');
          } else if (g.key === 'fumbles') {
            add(num(v('LOST')) * -2, num(v('LOST')), 'fum lost');
          } else if (g.key === 'kicking') {
            add(made(v('FG')) * 3, made(v('FG')), 'FG');
            add(made(v('XP')), made(v('XP')), 'XP');
          } else continue;
        } else if (sport === 'basketball') {
          const pts = num(v('PTS'));
          const reb = num(v('REB'));
          const ast = num(v('AST'));
          const stl = num(v('STL'));
          const blk = num(v('BLK'));
          add(pts, pts, 'pts');
          add(made(v('3PT')) * 0.5, made(v('3PT')), '3PM');
          add(reb * 1.25, reb, 'reb');
          add(ast * 1.5, ast, 'ast');
          add(stl * 2, stl, 'stl');
          add(blk * 2, blk, 'blk');
          add(num(v('TO')) * -0.5, num(v('TO')), 'TO');
          const doubles = [pts, reb, ast, stl, blk].filter((x) => x >= 10).length;
          if (doubles >= 3) add(3, 1, 'triple-double');
          else if (doubles === 2) add(1.5, 1, 'double-double');
        } else if (sport === 'hockey') {
          if (g.labels.includes('SV')) {
            add(num(v('SV')) * 0.7, num(v('SV')), 'saves');
            add(num(v('GA')) * -3.5, num(v('GA')), 'GA');
          } else {
            add(num(v('G')) * 8.5, num(v('G')), 'G');
            add(num(v('A')) * 5, num(v('A')), 'A');
            add(num(v('SOG')) * 1.5, num(v('SOG')), 'SOG');
            add(num(v('BS')) * 1.3, num(v('BS')), 'blk');
          }
        } else if (sport === 'baseball') {
          if (g.labels.includes('IP')) {
            const ip = innings(v('IP'));
            add(ip * 2.25, ip, 'IP', v('IP'));
            add(num(v('K')) * 2, num(v('K')), 'K');
            add(num(v('ER')) * -2, num(v('ER')), 'ER');
            add((num(v('H')) + num(v('BB'))) * -0.6, num(v('H')) + num(v('BB')), 'H+BB');
          } else {
            const hr = num(v('HR'));
            add((num(v('H')) - hr) * 3, num(v('H')) - hr, 'H');
            add(hr * 10, hr, 'HR');
            add(num(v('RBI')) * 2, num(v('RBI')), 'RBI');
            add(num(v('R')) * 2, num(v('R')), 'R');
            add(num(v('BB')) * 2, num(v('BB')), 'BB');
          }
        }
        players.set(team.side + row.name, p);
      }
    }
  }
  const fantasy = [...players.values()]
    .filter((p) => p.parts.length)
    .map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 }))
    .sort((a, b) => b.points - a.points);
  return { fantasy, fantasyScoring: FANTASY_SCORING[sport] ?? '' };
}

// ---- the chart, by sport

const PASS_ZONES = ['deep left', 'deep middle', 'deep right', 'short left', 'short middle', 'short right'];

function gameChart(league: string, s: EspnSummary, sideOf: (id: string | undefined) => 'away' | 'home' | null): GameChart | null {
  // (ESPN marks a play it couldn't place far off the board)
  const placed = (c: { x?: number; y?: number } | undefined): c is { x: number; y: number } =>
    !!c && typeof c.x === 'number' && typeof c.y === 'number' && Math.abs(c.x) < 1000 && Math.abs(c.y) < 1000;

  if (league.includes('basketball')) {
    const marks: GameMark[] = [];
    for (const p of s.plays ?? []) {
      const side = sideOf(p.team?.id);
      // (free throws are placed at the line: not shots from the floor)
      if (!p.shootingPlay || !side || !placed(p.coordinate) || /free throw/i.test(p.text ?? '')) continue;
      marks.push({ x: p.coordinate.x, y: p.coordinate.y + 4, side, result: p.scoringPlay ? 'made' : 'missed', text: p.text ?? '' });
    }
    return marks.length ? { kind: 'court', marks } : null;
  }

  if (league.includes('hockey')) {
    const marks: GameMark[] = [];
    for (const p of s.plays ?? []) {
      const kind = p.type?.text ?? '';
      const side = sideOf(p.team?.id);
      if (!/^(Shot|Goal|Missed|Blocked)$/.test(kind) || !side || !placed(p.coordinate)) continue;
      // (each team attacking its own end: away to the left, home to the right)
      let { x, y } = p.coordinate;
      if ((side === 'home' && x < 0) || (side === 'away' && x > 0)) {
        x = -x;
        y = -y;
      }
      marks.push({ x: x + 100, y: 42.5 - y, side, result: kind === 'Goal' ? 'goal' : 'missed', text: p.text ?? '' });
    }
    return marks.length ? { kind: 'rink', marks } : null;
  }

  if (league.includes('baseball')) {
    const marks: GameMark[] = [];
    for (const p of s.plays ?? []) {
      const side = sideOf(p.team?.id);
      if (!side || !placed(p.hitCoordinate)) continue;
      const kind = p.type?.text ?? '';
      const result = /home run/i.test(kind) ? 'hr' : /single|double|triple/i.test(kind) ? 'hit' : 'out';
      marks.push({ x: p.hitCoordinate.x, y: p.hitCoordinate.y, side, result, text: kind });
    }
    return marks.length ? { kind: 'diamond', marks } : null;
  }

  if (league.includes('football')) {
    // Every pass in the play-by-play, by its zone ("D.Jones pass short left to K.Allen ... for 7 yards")
    const teams = new Map<'away' | 'home', { passers: Set<string>; zones: Map<string, GamePassZone> }>();
    for (const d of s.drives?.previous ?? []) {
      const side = sideOf(d.team?.id);
      if (!side) continue;
      for (const p of d.plays ?? []) {
        const text = p.text ?? '';
        const m = text.match(/([A-Z][\w'.-]*\.?\s?[A-Z][\w'.-]+) pass (incomplete )?(short|deep) (left|middle|right)/);
        if (!m || /no play/i.test(text)) continue;
        const team = teams.get(side) ?? { passers: new Set<string>(), zones: new Map(PASS_ZONES.map((key) => [key, { key, att: 0, comp: 0, yds: 0, td: 0, int: 0 }])) };
        teams.set(side, team);
        team.passers.add(m[1]);
        const zone = team.zones.get(`${m[3]} ${m[4]}`)!;
        zone.att++;
        if (/INTERCEPTED/i.test(text)) zone.int++;
        else if (!m[2]) {
          zone.comp++;
          const yds = text.match(/for (-?\d+) yards?/);
          zone.yds += yds ? Number(yds[1]) : 0;
          if (/TOUCHDOWN/i.test(text)) zone.td++;
        }
      }
    }
    // Every drive, start to end
    const drives: GameDrive[] = (s.drives?.previous ?? [])
      .map((d) => ({
        side: sideOf(d.team?.id),
        start: d.start?.yardLine,
        end: d.end?.yardLine,
        result: d.displayResult ?? d.result ?? '',
        scoring: !!d.isScore,
        label: `Q${d.start?.period?.number ?? ''} ${d.start?.clock?.displayValue ?? ''} · ${d.offensivePlays ?? 0} plays, ${d.yards ?? 0} yds`,
      }))
      .filter((d): d is GameDrive => !!d.side && typeof d.start === 'number' && typeof d.end === 'number');
    const out = (['away', 'home'] as const)
      .filter((side) => teams.has(side))
      .map((side) => ({ side, passers: [...teams.get(side)!.passers], zones: [...teams.get(side)!.zones.values()] }));
    return out.length || drives.length ? { kind: 'football', drives, teams: out } : null;
  }
  return null;
}

// The black-clad teams' second colors, for when ESPN names no alternate (the NHL's): by its abbreviation
const BLACK_TEAMS: Record<string, string> = {
  BOS: 'ffb81c', // the Bruins' gold
  PIT: 'fcb514', // the Penguins' gold
  LA: 'a2aaad', // the Kings' silver
  ANA: 'f47a38', // the Ducks' orange
  VGK: 'b4975a', // the Golden Knights' gold
  LV: 'a5acaf', // the Raiders' silver
  SF: 'fd5a1e', // the Giants' orange
  CHW: 'c4ced4', // the White Sox's silver
  SA: 'c4ced4', // the Spurs' silver
};

// A team's color that reads on the dark board: its own; a dark one lightened, keeping its hue (the Ravens'
// purple, the Yankees' navy); a colorless black (the Bruins', the Giants') swapped for its alternate when
// that has a color (their gold, their orange)
function teamColor(main: string | undefined, alt: string | undefined): string {
  const rgb = (hex: string | undefined) => {
    const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? m.slice(1).map((x) => parseInt(x, 16)) : null;
  };
  const light = ([r, g, b]: number[]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const colorful = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b) > 40;
  const hex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  // (toward white, a step at a time, until it reads)
  const lift = (c: number[]) => {
    let out = c;
    for (let i = 0; i < 12 && light(out) < 0.2; i++) out = out.map((x) => x + (255 - x) * 0.12);
    return hex(out);
  };
  const m = rgb(main);
  const a = rgb(alt);
  if (!m) return a ? lift(a) : '#8a8f8c';
  if (light(m) >= 0.2) return hex(m);
  if (!colorful(m) && a && colorful(a)) return lift(a);
  return lift(m);
}
