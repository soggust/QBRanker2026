import { Component, Input, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Confidence, tierOf } from '../../bets/tiers';
import { betScoreText } from '../../bets/bet-why';
import { headshot, hideImage, teamLogo } from '../../bets/bet-format';
import { LinesService } from './lines.service';
import { WalletService } from './wallet.service';
import { GameBoard, PlayMarket, Price, Tier, bettable, lineText, oddsText, pickWords, selectionKey } from './wallet-math';

// The bot's pick as the Bets page has it (its BetRow, as far as the board reads it)
export interface BotPick {
  betType: string;
  side?: string | null;
  line?: number | null;
  price?: number;
  // (a prop's other side's price, where the bettor kept it: to take the side the bot didn't)
  otherPrice?: number | null;
  confidence: Confidence | null;
  sureness: number;
  pickId?: string;
  player?: string | null;
  athleteId?: string | number | null;
  market: string;
  pick: string;
  chance?: number;
}

// (one side of a prop on the board)
interface PropSide {
  side: string;
  odds: number;
  bot: boolean;
}

const MARKET_OF: Record<string, PlayMarket> = { spread: 'spread', total: 'total', moneyline: 'ml', player: 'prop' };

// A game's every line, both sides (the spread, the total, the moneyline) at DraftKings' prices from ESPN's
// board, as a sportsbook lays them out: a row a team, a column a market; and the bot's props on the game (its
// side, its price). The bot's own pick on each market lit in its band's color with its chip (Lock, Love, Like,
// Pass) and its Kelly score. A price clicked goes on the bet slip (again, off it); only before the game starts.
@Component({
  selector: 'game-lines',
  templateUrl: './game-lines.component.html',
  styleUrls: ['../../../styles/components/wallet-lines.scss'],
  standalone: false,
})
export class GameLinesComponent implements OnInit, OnDestroy {
  @Input({ required: true }) sport = '';
  @Input({ required: true }) event = '';
  @Input({ required: true }) start = '';
  @Input() matchup = '';
  // (the bot's picks on this game)
  @Input() set picks(list: BotPick[] | null | undefined) {
    this.botPicks.set(list ?? []);
  }

  // (one pick alone: its market's two sides and nothing else, under its row when the game's every line is
  // already on top)
  @Input() set only(p: BotPick | null | undefined) {
    this.onlyPick.set(p ?? null);
  }

  private readonly botPicks = signal<BotPick[]>([]);
  readonly onlyPick = signal<BotPick | null>(null);
  readonly loading = signal(true);
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  readonly lineText = lineText;
  readonly oddsText = oddsText;
  readonly hideImage = hideImage;
  readonly now = signal(Date.now());

  constructor(
    readonly lines: LinesService,
    readonly wallet: WalletService,
  ) {}

  get board(): GameBoard | undefined {
    return this.lines.board(this.sport, this.event);
  }

  // (the props: the bot's, its side at its price, and the other side's where it's known)
  readonly props = computed(() => {
    const only = this.onlyPick();
    const list = only ? (only.betType === 'player' ? [only] : []) : this.botPicks();
    return list.filter((p) => p.betType === 'player' && Number.isFinite(p.price) && p.line !== null && p.line !== undefined);
  });

  // (the one pick's game market, when it's one: spread, total or ml)
  get onlyMarket(): PlayMarket | null {
    const only = this.onlyPick();
    return only && only.betType !== 'player' ? (MARKET_OF[only.betType] ?? null) : null;
  }

  async ngOnInit(): Promise<void> {
    await this.lines.game(this.sport, this.event, this.start).catch(() => null);
    this.loading.set(false);
    // (the prices kept fresh while the board's open: once a minute, while the page is in view; not at all if the
    // board closed while its first prices loaded, the game filter changed: nothing would stop it)
    if (this.closed) return;
    this.timer = setInterval(() => {
      if (document.hidden) return;
      this.now.set(Date.now());
      void this.lines.game(this.sport, this.event, this.start);
    }, 60e3);
  }

  ngOnDestroy(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
  }

  get open(): boolean {
    return bettable(this.board?.start ?? this.start, this.board?.state, this.now());
  }

  get matchupText(): string {
    return this.board?.matchup ?? this.matchup;
  }

  logo(abbr: string): string {
    return teamLogo(this.sport, abbr);
  }

  face(p: BotPick): string {
    return headshot(this.sport, p.athleteId);
  }

  // The bot's pick on a market's side, if it made one
  botOn(market: PlayMarket, side: string): BotPick | null {
    return this.botPicks().find((p) => MARKET_OF[p.betType] === market && p.side === side) ?? null;
  }

  tier(p: BotPick | null): Tier | null {
    return p?.confidence ? tierOf(p.confidence) : null;
  }

  kellyText(p: BotPick): string {
    return betScoreText(p.sureness * 100);
  }

  // (a price's hover: what it is, what 10 units win at it, and the bot's word where it's the bot's pick)
  priceTitle(price: Price, bot: BotPick | null): string {
    const words = pickWords(price, this.matchupText);
    const at = `${words} ${oddsText(price.odds)} at DraftKings`;
    const botWords = bot
      ? ` · The bot's pick: ${this.tier(bot)?.toUpperCase()}, Kelly ${this.kellyText(bot)}${bot.chance != null ? `, ${bot.chance}% to win` : ''}${bot.line !== undefined && bot.line !== null && bot.line !== price.line ? ` (it took ${lineText(bot.line)})` : ''}`
      : '';
    return `${at}${botWords}${this.open ? '' : ' · Betting closed: the game has started'}`;
  }

  // A price's key on the slip (lit while it's on it)
  keyOf(price: Price): string {
    return selectionKey({ sport: this.sport, event: this.event, market: price.market, side: price.side });
  }

  propKey(p: BotPick, side = p.side ?? ''): string {
    return selectionKey({ sport: this.sport, event: this.event, market: 'prop', side, propType: this.propType(p), athlete: String(p.athleteId ?? '') });
  }

  // A prop's sides as the board lays them out, over then under: the bot's at its price, the other at its own
  // (only the bot's where the other side's price wasn't kept)
  propSides(p: BotPick): PropSide[] {
    const mine = { side: p.side ?? 'over', odds: p.price as number, bot: true };
    if (!Number.isFinite(p.otherPrice)) return [mine];
    const other = { side: mine.side === 'over' ? 'under' : 'over', odds: p.otherPrice as number, bot: false };
    return mine.side === 'over' ? [mine, other] : [other, mine];
  }

  // (a side's words: "Connor McDavid Under 3.5 Shots")
  sideWords(p: BotPick, s: PropSide): string {
    return `${p.player ? p.player + ' ' : ''}${s.side === 'over' ? 'Over' : 'Under'} ${p.line} ${p.market}`;
  }

  private propType(p: BotPick): string {
    return p.pickId?.split(':')[2] ?? p.market;
  }

  // A price clicked: onto the slip (or off it)
  take(price: Price): void {
    if (!this.open || price.odds === null) return;
    const bot = this.botOn(price.market, price.side);
    this.wallet.toggle({
      sport: this.sport,
      event: this.event,
      matchup: this.matchupText,
      start: this.board?.start ?? this.start,
      market: price.market,
      side: price.side,
      line: price.line,
      odds: price.odds,
      pick: pickWords(price, this.matchupText),
      botPick: !!bot,
      tier: this.tier(bot),
      kelly: bot ? Math.round(bot.sureness * 1e4) / 100 : null,
      ref: bot?.pickId ?? null,
      propType: null,
      athlete: null,
      player: null,
      statLabel: null,
    });
  }

  takeProp(p: BotPick, s: PropSide = this.propSides(p)[0]): void {
    if (!this.open || !Number.isFinite(s.odds)) return;
    const line = p.line as number;
    this.wallet.toggle({
      sport: this.sport,
      event: this.event,
      matchup: this.matchupText,
      start: this.board?.start ?? this.start,
      market: 'prop',
      side: s.side,
      line,
      odds: s.odds,
      pick: s.bot ? p.pick : this.sideWords(p, s),
      botPick: s.bot,
      tier: s.bot ? this.tier(p) : null,
      kelly: s.bot ? Math.round(p.sureness * 1e4) / 100 : null,
      ref: s.bot ? (p.pickId ?? null) : null,
      propType: this.propType(p),
      athlete: String(p.athleteId ?? ''),
      player: p.player ?? null,
      statLabel: p.market,
    });
  }

  // (a prop's words after the player's name: "Over 24.5 Saves")
  propWords(p: BotPick): string {
    return p.player && p.pick.startsWith(p.player) ? p.pick.slice(p.player.length).trim() : p.pick;
  }
}
