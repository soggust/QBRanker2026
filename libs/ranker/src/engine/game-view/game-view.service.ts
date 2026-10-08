import { Injectable } from '@angular/core';
import { SPORT } from '@sport/sport';
import { espnTeamId } from '@ranker/core/game-logs';
import { GameView, GameWeather, findGame, findGameOn, loadGame, loadWeather } from './game';

// Which game to open: ESPN's id (a game log's row), a date and a team in it (a row without one), or a
// Recent dot (its team, the opponent and where, the season, and which meeting: 0 the latest)
export type GameRef =
  | { event: string }
  | { date: string; names: string[] }
  | { team: (string | undefined)[]; opponent: string; home: boolean | null; season: number; nth: number };

export type GameTab = 'summary' | 'box' | 'plays' | 'chart' | 'fantasy' | 'info' | 'preview' | 'injuries';

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
    try {
      const id = await this.eventId(league, ref);
      if (!id) throw new Error('game not found');
      const game = await loadGame(league, id);
      if (ticket !== this.opened) return;
      this.game = game;
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
