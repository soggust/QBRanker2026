import { Component, HostListener } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SPORT } from '@sport/sport';
import { extras } from '@ranker/engine/row-fields';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SKILL_UNITS } from '@ranker/engine/unit-scoring';
import { ordinal } from '@ranker/core/format';
import { pitchColor } from '../player-card/zones';
import { HOME, TracedPark, fieldSpot, loadTracedParks, tracedPark, wallPath } from './parks';
import { GameArsenal, GameChart, GameFantasy, GameMark, GamePitch, GameTeam, GameView } from './game.model';
import { GameWeather } from './venue';
import { videoPlay, youtubeThumb, youtubeWatch } from './highlights';
import { PositionService } from '../position.service';

import { GameTab, GameViewService } from './game-view.service';

// The game view: a game over the page (in place of a player card it was opened from: the card is set
// aside, and closing the game brings it back as it was), in the player
// card's look (its stylesheet, plus this one's). Its hero is the two teams and the final on the
// scoreboard; its tabs (tabsFor) the Summary (the score by period, the win probability, the leaders), the
// Box Score (the team stats side by side, every player's line), the Plays (the NFL's drives, the other
// sports' periods), the Chart (shots, balls in play or drives), MLB's Pitches, Fantasy (each player's
// points from his line) and Game Info (the venue, weather, line, officials); a game not played yet its
// Preview and Injuries instead. Escape closes it.
@Component({
  selector: 'game-view',
  templateUrl: './game-view.component.html',
  // (its look, the card's and its own, is global, kept to its element: styles/_cards.scss)
  standalone: false,
})
export class GameViewComponent {
  constructor(
    readonly games: GameViewService,
    private positions: PositionService,
    private sanitizer: DomSanitizer,
  ) {}

  // How a clip plays (the NFL's open on YouTube), its page and its picture
  readonly videoPlay = videoPlay;
  readonly youtubeWatch = youtubeWatch;
  readonly youtubeThumb = youtubeThumb;

  // A YouTube video's player, made safe to embed once per video
  private embeds = new Map<string, SafeResourceUrl>();
  youtubeUrl(id: string): SafeResourceUrl {
    let url = this.embeds.get(id);
    if (!url) this.embeds.set(id, (url = this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`)));
    return url;
  }

  // "1:42"
  duration(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  }

  // The tabs: Fantasy when the box score scores anyone, Highlights when the game has any
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
      ...(this.games.videos.length ? [{ id: 'highlights' as const, title: 'Highlights' }] : []),
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
          const name = extras(p).teamName;
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
  // wall too), a little room around them; kept per field and chart
  private boxCache: { field: object; chart: GameChart; box: string } | null = null;
  sprayBox(game: GameView, chart: GameChart): string {
    const field = this.park(game);
    if (this.boxCache?.field === field && this.boxCache.chart === chart) return this.boxCache.box;
    const box = this.boxAround(field, chart);
    this.boxCache = { field, chart, box };
    return box;
  }

  private boxAround(field: { wall: string; fouls: string; infield: string }, chart: GameChart): string {
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

  // The win probability's hover targets: a thin strip per play across the chart, each saying both teams'
  // chances after it ("KC 72% · BUF 28% (play 34 of 160)"); kept per game
  private wpCache: { points: number[]; spots: { x: number; w: number; px: number; y: number; title: string }[] } | null = null;
  probabilitySpots(game: GameView): { x: number; w: number; px: number; y: number; title: string }[] {
    const points = game.winProbability ?? [];
    if (this.wpCache?.points === points) return this.wpCache.spots;
    const n = points.length;
    const step = n > 1 ? 1000 / (n - 1) : 1000;
    const spots =
      n < 2
        ? []
        : points.map((p, i) => {
            const home = Math.round(p * 1000) / 10;
            const away = Math.round((100 - home) * 10) / 10;
            const when = i === 0 ? 'the start' : i === n - 1 ? 'final' : `play ${i} of ${n - 1}`;
            return {
              x: Math.max(0, i * step - step / 2),
              w: i === 0 || i === n - 1 ? step / 2 : step,
              px: i * step,
              y: (1 - p) * 200,
              title: `${game.home.abbr} ${home}% · ${game.away.abbr} ${away}% (${when})`,
            };
          });
    this.wpCache = { points, spots };
    return spots;
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

  // The pitchers on the team filter's side(s), for the dropdown
  pitcherNames(chart: GameChart): string[] {
    const side = this.games.chartSide;
    return 'arsenals' in chart ? chart.arsenals.filter((a) => side === 'both' || a.side === side).map((a) => a.pitcher) : [];
  }

  // A pitch's height on the chart: ESPN's, stretched from the chart's top (its heights run squashed)
  py(y: number): number {
    return 100 + (y - 100) * 1.6;
  }

  // What the pitch chart shows: the pitcher picked, a team's, or both
  pitchScope(game: GameView): string {
    if (this.games.player) return this.games.player;
    const side = this.games.chartSide;
    return side === 'both' ? 'Both teams' : (side === 'away' ? game.away : game.home).name;
  }

  // A headshot: his card that season, like his name, when the site has him
  faceLinks(name: string | null): boolean {
    return !!name && !!this.games.link(name);
  }

  openFace(name: string | null, game: GameView): void {
    if (name && this.faceLinks(name)) this.games.toPlayer(name, this.seasonOf(game));
  }

  // (a player picked from the dropdown, or none: everyone)
  pickPlayer(event: Event): void {
    this.games.player = (event.target as HTMLSelectElement).value || null;
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
    for (const p of this.pitches(chart)) {
      const list = byType.get(p.type);
      if (list) list.push(p);
      else byType.set(p.type, [p]);
    }
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

  // A zone's share of all the attempts, for its hover: "34%"
  attShare(zones: { att: number }[], att: number): string {
    const all = zones.reduce((a, z) => a + z.att, 0);
    return `${all ? Math.round((att / all) * 100) : 0}%`;
  }

  // A linescore column's name, for its hover: "3rd quarter", "7th inning", "2nd period", or its own ("OT")
  periodName(game: GameView, label: string): string {
    const n = Number(label);
    if (!Number.isInteger(n) || n < 1) return label;
    const unit = game.league.includes('baseball') ? 'inning' : game.league.includes('hockey') ? 'period' : 'quarter';
    return `${ordinal(n)} ${unit}`;
  }

  // A pass zone's shade: its attempts against the busiest zone's
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

  // The fantasy board in the Fantasy Scoring setting (the NFL's: a catch worth 1, a half or nothing), best
  // first; kept per game and setting (the same rows each check, so a headshot that failed stays failed)
  private fantasyCache: { fantasy: GameFantasy[]; perCatch: number; rows: (GameFantasy & { total: number })[] } | null = null;
  fantasyRows(game: GameView): (GameFantasy & { total: number })[] {
    const scoring = this.positions.settings.sport['fantasyScoring'];
    const perCatch = scoring === 'std' ? 0 : scoring === 'half' ? 0.5 : 1;
    if (this.fantasyCache?.fantasy === game.fantasy && this.fantasyCache.perCatch === perCatch) return this.fantasyCache.rows;
    const rows = game.fantasy
      .map((p) => ({ ...p, total: Math.round((p.points + p.receptions * perCatch) * 10) / 10 }))
      .sort((a, b) => b.total - a.total);
    this.fantasyCache = { fantasy: game.fantasy, perCatch, rows };
    return rows;
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
