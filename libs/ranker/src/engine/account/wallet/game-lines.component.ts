import { Component, Input, OnDestroy, OnInit, computed, signal } from '@angular/core';
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
  confidence: 'lock' | 'high' | 'medium' | 'low' | null;
  sureness: number;
  pickId?: string;
  player?: string | null;
  athleteId?: string | number | null;
  market: string;
  pick: string;
  chance?: number;
}

const MARKET_OF: Record<string, PlayMarket> = { spread: 'spread', total: 'total', moneyline: 'ml', player: 'prop' };
const TIER_OF: Record<string, Tier> = { lock: 'lock', high: 'love', medium: 'bet', low: 'pass' };

// A game's every line, both sides (the spread, the total, the moneyline) at DraftKings' prices from ESPN's
// board, as a sportsbook lays them out: a row a team, a column a market; and the bot's props on the game (its
// side, its price). The bot's own pick on each market lit in its band's color with its chip (Lock, Love, Bet,
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

  private readonly botPicks = signal<BotPick[]>([]);
  readonly loading = signal(true);
  private timer: ReturnType<typeof setInterval> | null = null;
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

  // (the props: the bot's, its side at its price)
  readonly props = computed(() => this.botPicks().filter((p) => p.betType === 'player' && Number.isFinite(p.price) && p.line !== null && p.line !== undefined));

  async ngOnInit(): Promise<void> {
    await this.lines.game(this.sport, this.event, this.start).catch(() => null);
    this.loading.set(false);
    // (the prices kept fresh while the board's open: once a minute)
    this.timer = setInterval(() => {
      this.now.set(Date.now());
      void this.lines.game(this.sport, this.event, this.start);
    }, 60e3);
  }

  ngOnDestroy(): void {
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
    return p?.confidence ? TIER_OF[p.confidence] : null;
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

  propKey(p: BotPick): string {
    return selectionKey({ sport: this.sport, event: this.event, market: 'prop', side: p.side ?? '', propType: this.propType(p), athlete: String(p.athleteId ?? '') });
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

  takeProp(p: BotPick): void {
    if (!this.open || !Number.isFinite(p.price)) return;
    const line = p.line as number;
    this.wallet.toggle({
      sport: this.sport,
      event: this.event,
      matchup: this.matchupText,
      start: this.board?.start ?? this.start,
      market: 'prop',
      side: p.side ?? 'over',
      line,
      odds: p.price as number,
      pick: p.pick,
      botPick: true,
      tier: this.tier(p),
      kelly: Math.round(p.sureness * 1e4) / 100,
      ref: p.pickId ?? null,
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
