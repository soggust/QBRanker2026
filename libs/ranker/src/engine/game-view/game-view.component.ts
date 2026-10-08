import { Component, HostListener } from '@angular/core';
import { SPORT } from '@sport/sport';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SKILL_UNITS } from '@ranker/engine/unit-scoring';
import { pitchColor } from '../player-card/zones';
import { HOME, TracedPark, fieldSpot, loadTracedParks, tracedPark, wallPath } from './parks';
import { GameArsenal, GameChart, GameMark, GamePitch, GameTeam, GameView, GameWeather } from './game';

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
      ...(game.chart && 'pitches' in game.chart && game.chart.pitches.length ? [{ id: 'pitches' as const, title: 'Pitches' }] : []),
      ...(game.fantasy.length ? [{ id: 'fantasy' as const, title: 'Fantasy' }] : []),
      { id: 'info', title: 'Game Info' },
    ];
  }

  // (the weather, once it's in)
  get weather(): GameWeather | null {
    const w = this.games.weather;
    return w && w !== 'loading' ? w : null;
  }

  // A team's card like the grid's: the site's own logo (that season's era, the sharp one where the sport has
  // it) on its badge color, white where the logo needs it; found by its name among the rows (ESPN's logo,
  // plain, when the site doesn't know the team)
  private siteLogos: Map<string, string> | null = null;
  private cards = new Map<string, { logo: string; badge: string; white: boolean } | null>();
  siteTeam(team: GameTeam, game: GameView): { logo: string; badge: string; white: boolean } | null {
    const key = team.name + game.date;
    if (this.cards.has(key)) return this.cards.get(key)!;
    if (!this.siteLogos) {
      this.siteLogos = new Map();
      for (const [pos, list] of Object.entries(SKILL_UNITS)) {
        for (const p of list ?? []) {
          const name = (p as { teamName?: string | null }).teamName;
          if (name) this.siteLogos.set(name.toLowerCase(), p.teamLogo);
          if (SPORT.teamTabs?.includes(pos)) this.siteLogos.set(p.name.toLowerCase(), p.teamLogo);
        }
      }
    }
    const teamLogo = this.siteLogos.get(team.name.toLowerCase());
    let card: { logo: string; badge: string; white: boolean } | null = null;
    if (teamLogo) {
      // (the season it was played in: the year, or the next for a sport whose seasons end in it)
      const d = new Date(game.date);
      const season = d.getFullYear() + (SPORT.seasonText(2026).includes('-') && d.getMonth() >= 7 ? 1 : 0);
      const logo = logoForSeason(teamLogo, season);
      card = { logo: SPORT.cardLogo ? SPORT.cardLogo(logo) : logo, badge: badgeColor(teamLogo), white: whiteLogo(teamLogo) };
    }
    this.cards.set(key, card);
    return card;
  }

  readonly currentSeason = SPORT.currentSeason;

  // "2024", "2024-25"
  seasonText(season: number): string {
    return SPORT.seasonText(season);
  }

  // The spray chart's field, to scale: the park's own wall, foul lines and infield as MLB's diagrams trace
  // them (today's parks: parks.ts), or its five measured distances (one since replaced), the mound
  private fields = new Map<string, { wall: string; fouls: string; infield: string; mound: [number, number] }>();
  private traced: Record<string, TracedPark> | null = null;
  park(game: GameView) {
    if (!this.traced) {
      this.traced = {};
      // (once they're in, the fields are drawn again from them)
      loadTracedParks().then((parks) => {
        this.traced = parks;
        this.fields.clear();
      });
    }
    const venue = game.venue?.name ?? '';
    const season = this.seasonOf(game);
    const key = `${venue}/${season}`;
    if (!this.fields.has(key)) {
      const at = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      const [first, second, third] = [fieldSpot(90, 90), fieldSpot(127.3, 45), fieldSpot(90, 0)];
      const bases = `M${at(HOME)} L${at(first)} L${at(second)} L${at(third)} Z`;
      const park = tracedPark(this.traced, venue, season);
      const drawn = wallPath(venue);
      this.fields.set(key, {
        wall: park?.wall ?? drawn.wall,
        fouls: park?.fouls ?? `M${at(HOME)} L${at(drawn.left)} M${at(HOME)} L${at(drawn.right)}`,
        infield: park?.infield ?? bases,
        mound: fieldSpot(60.5, 45),
      });
    }
    return this.fields.get(key)!;
  }

  // The spray chart's view: cropped to the park's outline and every ball in play (a deep home run past the
  // wall too), a little room around them
  sprayBox(game: GameView, chart: GameChart): string {
    const field = this.park(game);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const d of [field.wall, field.fouls, field.infield]) {
      const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        xs.push(nums[i]);
        ys.push(nums[i + 1]);
      }
    }
    if ('marks' in chart) for (const m of chart.marks) (xs.push(m.x), ys.push(m.y));
    if (!xs.length) return '0 0 250 215';
    const pad = 6;
    const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
    return `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`;
  }

  // The season the game was in (ESPN's, numbered as the site numbers them)
  seasonOf(game: GameView): number {
    return game.seasonYear ?? new Date(game.date).getFullYear();
  }

  // A team in the game view (a last five's opponent): its card for the season the game was in
  openTeam(abbreviation: string, game: GameView): void {
    this.games.toTeam(abbreviation, this.seasonOf(game));
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

  // Baseball's pitches the team filter leaves (by the pitching team), each type's color, and the legend:
  // each type thrown, how many, its average speed
  pitches(chart: GameChart): GamePitch[] {
    const side = this.games.chartSide;
    const one = this.games.player;
    return 'pitches' in chart ? chart.pitches.filter((p) => (side === 'both' || p.side === side) && (!one || p.pitcher === one)) : [];
  }

  arsenals(chart: GameChart): GameArsenal[] {
    const side = this.games.chartSide;
    const one = this.games.player;
    return 'arsenals' in chart ? chart.arsenals.filter((a) => (side === 'both' || a.side === side) && (!one || a.pitcher === one)) : [];
  }

  // The pitchers on the team filter's side(s), each with his team's color, for the pills
  pitchers(chart: GameChart, game: GameView): { name: string; color: string }[] {
    const side = this.games.chartSide;
    return 'arsenals' in chart
      ? chart.arsenals.filter((a) => side === 'both' || a.side === side).map((a) => ({ name: a.pitcher, color: (a.side === 'away' ? game.away : game.home).color }))
      : [];
  }

  // A pitch's height on the chart: ESPN's, stretched from the chart's top (its heights run squashed)
  py(y: number): number {
    return 100 + (y - 100) * 1.6;
  }

  // "Max Fried" -> "M. Fried" (a pill's; its hover the whole name)
  shortName(name: string): string {
    const [first, ...rest] = name.split(' ');
    return rest.length ? `${first[0]}. ${rest.join(' ')}` : name;
  }

  // What the pitch chart shows: the pitcher picked, a team's, or both
  pitchScope(game: GameView): string {
    if (this.games.player) return this.games.player;
    const side = this.games.chartSide;
    return side === 'both' ? 'Both teams' : (side === 'away' ? game.away : game.home).name;
  }

  // (a player picked from the dropdown, or none: everyone)
  pickPlayer(name: string): void {
    this.games.player = name || null;
  }

  // The chart's shooters or hitters on the team pills' side, the busiest first
  chartPlayers(chart: GameChart): string[] {
    const side = this.games.chartSide;
    const counts = new Map<string, number>();
    if ('marks' in chart) for (const m of chart.marks) if (m.player && (side === 'both' || m.side === side)) counts.set(m.player, (counts.get(m.player) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  pitchColor(type: string): string {
    return pitchColor(type);
  }

  pitchLegend(chart: GameChart): { type: string; count: number; mph: number | null }[] {
    const byType = new Map<string, GamePitch[]>();
    for (const p of this.pitches(chart)) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
    return [...byType.entries()]
      .map(([type, list]) => {
        const speeds = list.map((p) => p.mph).filter((v): v is number => v !== null);
        return { type, count: list.length, mph: speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null };
      })
      .sort((a, b) => b.count - a.count);
  }

  // The marks the team filter leaves
  marks(chart: GameChart): GameMark[] {
    const side = this.games.chartSide;
    const one = this.games.player;
    return 'marks' in chart ? chart.marks.filter((m) => (side === 'both' || m.side === side) && (!one || m.player === one)) : [];
  }

  // A pass zone's shade: its share of the team's attempts
  zoneShare(zones: { att: number }[], att: number): number {
    const most = Math.max(...zones.map((z) => z.att), 1);
    return att / most;
  }

  // A drive chart marker: "2nd Quarter", "Halftime" (the 3rd's start), "Overtime"
  quarterName(quarter: number): string {
    if (quarter === 3) return 'Halftime';
    if (quarter >= 5) return quarter === 5 ? 'Overtime' : '2nd Overtime';
    return ['', '1st', '2nd', '3rd', '4th'][quarter] + ' Quarter';
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
