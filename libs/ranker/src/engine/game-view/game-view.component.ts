import { Component, HostListener } from '@angular/core';
import { GameChart, GameMark, GameView, GameWeather } from './game';
import { GameTab, GameViewService } from './game-view.service';

// The game view: a game over the page (in place of a player card it was opened from: the card is set
// aside, and closing the game brings it back as it was), in the player
// card's look (its stylesheet, plus this one's). Its hero is the two teams and the final on the
// scoreboard; its tabs the Summary (the score by period, the win probability, the leaders), the Box Score
// (the team stats side by side, every player's line), the Plays (the NFL's drives, the other sports'
// periods), Fantasy (each player's points from his line) and Game Info (the venue, weather, line,
// officials). Escape closes it.
@Component({
  selector: 'game-view',
  templateUrl: './game-view.component.html',
  styleUrls: ['../../styles/components/player-card.scss', '../../styles/components/game-view.scss'],
  standalone: false,
})
export class GameViewComponent {
  constructor(readonly games: GameViewService) {}

  // The tabs: Fantasy when the box score scores anyone
  tabsFor(game: GameView): { id: GameTab; title: string }[] {
    // (a game to come: its preview, the injury report, the venue)
    if (game.preview) {
      return [
        { id: 'preview', title: 'Preview' },
        ...(game.injuries.length ? [{ id: 'injuries' as const, title: 'Injuries' }] : []),
        { id: 'info', title: 'Game Info' },
      ];
    }
    return [
      { id: 'summary', title: 'Summary' },
      { id: 'box', title: 'Box Score' },
      { id: 'plays', title: 'Plays' },
      ...(game.chart ? [{ id: 'chart' as const, title: this.chartTitle(game) }] : []),
      ...(game.fantasy.length ? [{ id: 'fantasy' as const, title: 'Fantasy' }] : []),
      { id: 'info', title: 'Game Info' },
    ];
  }

  // (the weather, once it's in)
  get weather(): GameWeather | null {
    const w = this.games.weather;
    return w && w !== 'loading' ? w : null;
  }

  // A preview's start on the board: "8:20" and "PM"
  startTime(game: GameView): [string, string] {
    const d = new Date(game.date);
    if (Number.isNaN(d.getTime())) return ['', ''];
    const [time, half] = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).split(' ');
    return [time, half ?? ''];
  }

  // "Sunday, October 4, 2026 · 12:00 PM"
  when(game: GameView): string {
    const d = new Date(game.date);
    if (Number.isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${date} · ${time}`;
  }

  // The win probability as a line across the chart (the home team's chance: up is home), and its fill
  probabilityPath(points: number[], fill = false): string {
    const n = points.length;
    if (n < 2) return '';
    const xy = points.map((p, i) => `${((i / (n - 1)) * 1000).toFixed(1)},${((1 - p) * 200).toFixed(1)}`);
    return fill ? `M0,100 L${xy.join(' L')} L1000,100 Z` : `M${xy.join(' L')}`;
  }

  // The chart tab's name: a shot chart (basketball, hockey), a spray chart (baseball), drives (football)
  chartTitle(game: GameView): string {
    const kind = game.chart?.kind;
    return kind === 'diamond' ? 'Spray Chart' : kind === 'football' ? 'Drive Chart' : 'Shot Chart';
  }

  // The marks the team filter leaves
  marks(chart: GameChart): GameMark[] {
    const side = this.games.chartSide;
    return 'marks' in chart ? chart.marks.filter((m) => side === 'both' || m.side === side) : [];
  }

  // A pass zone's shade: its share of the team's attempts
  zoneShare(zones: { att: number }[], att: number): number {
    const most = Math.max(...zones.map((z) => z.att), 1);
    return att / most;
  }

  // A drive that ended in a turnover (an interception, a fumble, on downs)
  turnover(result: string): boolean {
    return /intercept|fumble|downs/i.test(result);
  }

  // A fantasy line's bar: its points against the game's best
  fantasyShare(game: GameView, points: number): number {
    const best = game.fantasy[0]?.points ?? 0;
    return best > 0 ? Math.max(0, points) / best : 0;
  }

  // The plays the filter leaves (Scoring Only: just the ones that scored)
  shownPlays(group: GameView['plays'][number]) {
    return this.games.scoringOnly ? group.plays.filter((p) => p.scoring) : group.plays;
  }

  @HostListener('document:keydown', ['$event'])
  keys(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.games.game) return;
    this.games.close();
    // (the card under it stays open)
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}
