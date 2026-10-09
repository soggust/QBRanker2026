// The game view (game-view.component): one game, from ESPN's game summary (any league it covers: the
// NFL, the NBA, the NHL, MLB). Read once and shaped the same for every sport: the two teams and the
// score by period, the venue (its photo, its city's weather at game time: Open-Meteo, outdoors only), the
// sportsbook's line and how it came out, the win probability play by play, each team's leaders, the
// team stats side by side, every player's line, and the plays (the NFL's by drive, the rest by period;
// MLB's at-bats without their pitches).
//
// The rest of the view is in its own modules: the model (game.model.ts), ESPN's shapes (espn-summary.ts),
// finding a game (find-game.ts), the chart (game-chart.ts), fantasy points (fantasy.ts), the venue's
// weather and photo (venue.ts) and the teams' colors (team-color.ts).

import { ESPN_API } from '@ranker/core/game-logs';
import { awayFirst, EspnPlay, EspnSummary, headshotOf, logoOf, numberOf } from './espn-summary';
import { fantasyPoints } from './fantasy';
import { gameChart } from './game-chart';
import { GameBoxGroup, GameLeader, GamePlay, GamePlayGroup, GameTeam, GameTeamStat, GameView } from './game.model';
import { BLACK_TEAMS, teamColor } from './team-color';

// The roofed parks and stadiums (no weather): domes and fixed roofs, then the retractable roofs

const INDOORS = /mercedes-benz stadium|ford field|caesars superdome|superdome|u\.s\. bank stadium|allegiant|sofi stadium|tropicana field|edward jones dome|the dome at america's center|georgia dome|metrodome|rca dome|silverdome|kingdome|olympic stadium/i;
const RETRACTABLE = /at&t stadium|lucas oil|nrg stadium|state farm stadium|university of phoenix stadium|rogers centre|chase field|minute maid|daikin park|loandepot|marlins park|american family field|miller park|t-mobile park|safeco field|globe life field/i;

export async function loadGame(league: string, eventId: string): Promise<GameView> {
  const res = await fetch(`${ESPN_API}/${league}/summary?event=${eventId}`);
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
    .sort(awayFirst);

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
    .sort(awayFirst);

  // The players' headshots by ESPN id, and by the play-by-play's short name ("D.Henry")
  const shortKey = (name: string) => name.toLowerCase().replace(/[\s.]/g, '');
  type Face = { headshot: string; name: string };
  const faces = new Map<string, Face>();
  const facesByName = new Map<string, Face>();
  for (const t of box) {
    for (const g of t.groups) {
      for (const r of g.rows) {
        if (!r.headshot) continue;
        const face = { headshot: r.headshot, name: r.name };
        if (r.id) faces.set(r.id, face);
        facesByName.set(shortKey(r.short), face);
        // (and his first initial with his last name: "Derrick Henry" as the plays write him, "D.Henry")
        const [first, ...rest] = r.name.split(' ');
        if (first && rest.length) facesByName.set(shortKey(first[0] + rest.join('')), face);
      }
    }
  }
  // A scoring play's scorer: ESPN's scorer or batter, else the first named (the shooter); the NFL's from its
  // text (a return's defender, a catch's receiver, else the runner or kicker who starts it)
  const scorerFace = (p: EspnPlay): Face | null => {
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
    ...((face) => ({ headshot: face?.headshot ?? null, scorer: face?.name ?? null }))(scorerFace(p)),
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
  const drives = s.drives?.previous ?? [];
  if (drives.length) {
    plays = drives.map((d) => {
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
      const rows = fantasy
        .filter((p) => p.side === side)
        .slice(0, 3)
        .map((p) => ({ category: p.position ?? '', name: p.name, short: p.name, line: p.parts.join(', '), headshot: p.headshot }));
      if (rows.length) leaders.push({ side, rows });
    }
  }

  // (each player's team and name by ESPN id, for the pitches)
  const people = new Map<string, { side: 'away' | 'home'; name: string }>();
  for (const t of box) for (const g of t.groups) for (const r of g.rows) if (r.id) people.set(r.id, { side: t.side, name: r.name });
  const chart = gameChart(league, s, sideOf, people);

  // A preview's: the predictor, the injury report, each team's last five, the broadcast
  const preview = comp.status?.type?.state === 'pre';
  const projection = (x: { gameProjection?: string } | undefined) => (x?.gameProjection ? Number(x.gameProjection) / 100 : null);
  const awayChance = projection(s.predictor?.awayTeam?.id === home.id ? s.predictor?.homeTeam : s.predictor?.awayTeam);
  const homeChance = projection(s.predictor?.awayTeam?.id === home.id ? s.predictor?.awayTeam : s.predictor?.homeTeam);
  // (only the ones still in doubt for it: a player ESPN expects back before the game's day is left off;
  // its return date on the game's day itself is a questionable one, kept)
  const gameDay = comp.date ? new Date(comp.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null;
  const backInTime = (returnDate?: string) => !!returnDate && !!gameDay && returnDate.slice(0, 10) < gameDay;
  const injuries = (s.injuries ?? [])
    .map((t) => ({
      side: sideOf(t.team?.id),
      rows: (t.injuries ?? []).filter((i) => !backInTime(i.details?.returnDate)).map((i) => ({
        name: i.athlete?.displayName ?? '',
        position: i.athlete?.position?.abbreviation ?? null,
        status: i.status ?? '',
        detail: [i.details?.type, i.details?.returnDate ? `back ${new Date(i.details.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ') || null,
        headshot: headshotOf(i.athlete),
      })),
    }))
    .filter((t): t is GameView['injuries'][number] => !!t.side && t.rows.length > 0)
    .sort(awayFirst);
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
    .sort(awayFirst);

  return {
    id: eventId,
    league,
    date: comp.date ?? '',
    seasonYear: s.header?.season?.year ?? null,
    preview,
    predictor: awayChance !== null && homeChance !== null ? { away: awayChance, home: homeChance } : null,
    injuries,
    form,
    broadcast: comp.broadcasts?.[0]?.media?.shortName ?? null,
    status,
    label,
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
    fantasy,
    plays,
    videos: (s.videos ?? [])
      .filter((v) => v.links?.source?.href)
      .map((v) => ({ title: v.headline ?? '', src: v.links!.source!.href!, youtube: null, thumb: v.thumbnail ?? null, duration: v.duration ?? null }))
      .sort((a, b) => Number(/highlights/i.test(b.title)) - Number(/highlights/i.test(a.title))),
  };
}
