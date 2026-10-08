import { Injectable } from '@angular/core';
import { SPORT } from '@sport/sport';
import { espnTeamId } from '@ranker/core/game-logs';
import { GameView, GameWeather, TeamResult, findGame, findGameOn, loadGame, loadWeather, nthMeeting, teamResults } from './game';

// Which game to open: ESPN's id (a game log's row), a date and a team in it (a row without one), or a
// Recent dot (its team, the opponent and where, the season, and which meeting: 0 the latest)
export type GameRef =
  | { event: string }
  | { date: string; names: string[] }
  | { team: (string | undefined)[]; opponent: string; home: boolean | null; season: number; nth: number };

export type GameTab = 'summary' | 'box' | 'plays' | 'chart' | 'fantasy' | 'info' | 'preview' | 'injuries' | 'pitches';

// The game view's state: the game open (or finding it, or failed), its tab, its weather. One at a time,
// in a player card's place when opened from one (the card is set aside; closing the game brings it back).
@Injectable({ providedIn: 'root' })
export class GameViewService {
  game: GameView | 'loading' | 'error' | null = null;
  tab: GameTab = 'summary';
  weather: GameWeather | 'loading' | null = null;
  // (the play groups open on the Plays tab, and its filter)
  openPlays = new Set<number>();
  scoringOnly = false;
  // (the chart's team: both, or one)
  chartSide: 'both' | 'away' | 'home' = 'both';
  // (the chart's or the Pitches tab's player: one, or all of them)
  player: string | null = null;
  // (a team's card for a season: the page that shows the cards hands it over; the game closes for it)
  openTeam: ((abbreviation: string, season: number) => void) | null = null;
  // (a player's card for a season, the same way; and the players the site has that season, by name, to link)
  openPlayer: ((link: { position: string; gsisId: string }, season: number) => void) | null = null;
  findPlayers: ((season: number) => Promise<Map<string, { position: string; gsisId: string }>>) | null = null;
  players: Map<string, { position: string; gsisId: string }> | null = null;
  // The game a card was opened from (its back arrow reopens it), and the one open now
  backTo: GameRef | null = null;
  private current: GameRef | null = null;
  private opened = 0;

  // The sport has games to open (ESPN's league: the game log's)
  get available(): boolean {
    return !!SPORT.gameLog?.league;
  }

  async open(ref: GameRef): Promise<void> {
    const league = SPORT.gameLog?.league;
    if (!league) return;
    const ticket = ++this.opened;
    this.game = 'loading';
    this.tab = 'summary';
    this.weather = null;
    this.openPlays.clear();
    this.scoringOnly = false;
    this.chartSide = 'both';
    this.player = null;
    try {
      const id = await this.eventId(league, ref);
      if (!id) throw new Error('game not found');
      this.current = { event: id };
      const game = await loadGame(league, id);
      if (ticket !== this.opened) return;
      this.game = game;
      // (the players the site has that season, for the names' links)
      this.players = null;
      this.findPlayers?.(game.seasonYear ?? new Date(game.date).getFullYear())
        .then((map) => ticket === this.opened && (this.players = map))
        .catch(() => null);
      // (a game to come opens on its preview)
      this.tab = game.preview ? 'preview' : 'summary';
      // (the Plays tab's first group open, the rest shut)
      if (game.plays.length) this.openPlays.add(0);
      this.weather = 'loading';
      loadWeather(game)
        .then((w) => ticket === this.opened && (this.weather = w))
        .catch(() => ticket === this.opened && (this.weather = null));
    } catch (err) {
      console.error(err);
      if (ticket === this.opened) this.game = 'error';
    }
  }

  // A Recent dot's score ("24-17", the team's way): the team's results loaded once the pointer reaches
  // its row's dots (primeRecent), then read for each dot
  private scored = new Map<string, TeamResult[]>();
  primeRecent(team: (string | undefined)[], season: number): void {
    const league = SPORT.gameLog?.league;
    const id = league ? safeTeamId(league, team) : null;
    if (!league || !id) return;
    const key = `${id}/${season}`;
    if (this.scored.has(key)) return;
    this.scored.set(key, []);
    teamResults(league, id, season)
      .then((list) => this.scored.set(key, list))
      .catch(() => this.scored.delete(key));
  }

  recentScore(team: (string | undefined)[], vsList: (string | null)[] | undefined, index: number, season: number): string | null {
    const league = SPORT.gameLog?.league;
    const ref = recentRef(team, vsList, index, season);
    if (!league || !ref || !('opponent' in ref)) return null;
    const id = safeTeamId(league, team);
    const list = id ? this.scored.get(`${id}/${season}`) : undefined;
    const opponent = safeTeamId(league, [ref.opponent]);
    return list?.length && opponent ? (nthMeeting(list, opponent, ref.home, ref.nth)?.score ?? null) : null;
  }

  // A name in the game: the site's player that season, or none
  link(name: string): { position: string; gsisId: string } | null {
    return this.players?.get(nameKey(name)) ?? null;
  }

  // A player or team opened from the game: the game closes (its card's back arrow reopens it)
  toPlayer(name: string, season: number): void {
    const link = this.link(name);
    if (!link || !this.openPlayer) return;
    this.backTo = this.current;
    this.close();
    this.openPlayer(link, season);
  }

  toTeam(abbreviation: string, season: number): void {
    if (!this.openTeam) return;
    this.backTo = this.current;
    this.openTeam(abbreviation, season);
  }

  // The card's back arrow: the game it came from, open again (the card set aside under it)
  back(): void {
    const ref = this.backTo;
    this.backTo = null;
    if (ref) this.open(ref);
  }

  close(): void {
    this.opened++;
    this.game = null;
  }

  togglePlays(i: number): void {
    if (!this.openPlays.delete(i)) this.openPlays.add(i);
  }

  private async eventId(league: string, ref: GameRef): Promise<string | null> {
    if ('event' in ref) return ref.event;
    if ('date' in ref) return findGameOn(league, ref.date, ref.names);
    const team = espnTeamId(league, ref.team);
    const opponent = espnTeamId(league, [ref.opponent]);
    return findGame(league, team, opponent, ref.home, ref.season, ref.nth);
  }
}

// A Recent dot's game: "@ Denver Broncos" the opponent and where; the nth meeting with them among the
// row's earlier dots (newest first)
export function recentRef(
  team: (string | undefined)[],
  vsList: (string | null)[] | undefined,
  index: number,
  season: number,
): GameRef | null {
  const vs = vsList?.[index];
  if (!vs) return null;
  const m = vs.match(/^(@|vs)\s+(.*)$/);
  const opponent = m ? m[2] : vs;
  const home = m ? m[1] === 'vs' : null;
  const nth = (vsList ?? []).slice(0, index).filter((v) => v === vs).length;
  return { team, opponent, home, season, nth };
}

// A team's ESPN id, or null when it isn't found
function safeTeamId(league: string, names: (string | undefined)[]): string | null {
  try {
    return espnTeamId(league, names);
  } catch {
    return null;
  }
}

// A name to match on: lower case, no accents, periods or suffixes ("Kenneth Walker III" -> "kenneth walker")
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
