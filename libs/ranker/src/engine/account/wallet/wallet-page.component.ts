import { Component, Input, OnDestroy, OnInit, computed, effect, isDevMode, signal } from '@angular/core';
import { ModelBet, Settled } from '../../bets/desk-model';
import { CURVE_W } from '../../bets/desk-math';
import { hideImage, leagueLogo, teamLogo, headshot } from '../../bets/bet-format';
import { AccountService } from '../account.service';
import { ADMIN, canUse } from '../features';
import { chooseBetsView } from '../../bets/bets-view';
import { PRIVACY_HASH } from '../account-page.component';
import { LinesService } from './lines.service';
import { WalletService } from './wallet.service';
import {
  Leaderboard,
  PlayBet,
  SPORTS,
  START,
  Versus,
  byGame,
  oddsText,
  playBySport,
  playCurve,
  playTally,
  provisionalOf,
  recordText,
  toWin,
  versusBot,
} from './wallet-math';

type Period = Leaderboard['period'];

// #wallet: the play-money bankroll as the Algorithm desk shows the bot's (balance, record, profit, return,
// what's at risk, the profit after each settled bet), the open bets (in play, a result as soon as the score
// decides it, pending settlement: the settler pays it after the game), the settled history by game, the
// user's record beside the bot's over the same stretch, and the leaderboards. Reload (back to 1,000, a new
// run) and Clear history (typed to confirm) at the top.
// (the bot's ledgers, every sport's, for You vs the Bot: fetched once a visit, however often the wallet opens)
let ledgerPromise: Promise<ModelBet[]> | null = null;
function botLedger(): Promise<ModelBet[]> {
  ledgerPromise ??= Promise.all(
    SPORTS.map((s) =>
      fetch(`/${s}/data/model/ledger.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { bets?: ModelBet[] } | null) => body?.bets ?? [])
        .catch(() => [] as ModelBet[]),
    ),
  ).then((all) => all.flat());
  return ledgerPromise;
}

// (a game this close to its start, or under way, has its score looked up each minute)
const NEAR = 15 * 60e3;

@Component({
  selector: 'wallet-page',
  host: { role: 'main' },
  templateUrl: './wallet-page.component.html',
  styleUrls: ['../../../styles/components/model-desk.scss', '../../../styles/components/wallet-page.scss'],
  standalone: false,
})
export class WalletPageComponent implements OnInit, OnDestroy {
  readonly canUse = canUse;
  readonly start = START;
  readonly oddsText = oddsText;
  readonly toWin = toWin;
  readonly recordText = recordText;
  readonly hideImage = hideImage;
  readonly leagueLogo = leagueLogo;
  readonly curveWidth = CURVE_W;

  // (the open bets' props in play: each one's count so far, by bet id)
  private readonly propNow = signal(new Map<string, number | null>());
  private timer: ReturnType<typeof setInterval> | null = null;
  // (each sport's ledger: the bot's bets, for the comparison)
  private readonly ledger = signal<ModelBet[] | null>(null);

  // (the three boards, read once: the panel shows only with someone on one, its periods only those with rows)
  readonly period = signal<Period>('week');
  private readonly boards = signal<Partial<Record<Period, Leaderboard | null>> | undefined>(undefined);
  private readonly allPeriods: { id: Period; label: string }[] = [
    { id: 'week', label: 'This week' },
    { id: 'season', label: 'Season' },
    { id: 'all', label: 'All time' },
  ];
  readonly periods = computed(() => this.allPeriods.filter((p) => this.boards()?.[p.id]?.rows?.length));
  readonly board = computed(() => this.boards()?.[this.period()] ?? null);
  // (Clear history: an admin's (the token's claim), and in development for testing)
  readonly admin = (): boolean => isDevMode() || ADMIN();
  // (the Bets page's Open Bets or Closed Bets tab: those bets alone, no tiles, the rest or the slip)
  @Input() only: 'open' | 'closed' | null = null;
  // (a link to the Bets page lands on its Place Bets, not the Algorithm or Open Bets)
  readonly toBets = (): void => chooseBetsView('bets');
  // (Settings, its Privacy panel open: where bet history goes public)
  readonly privacyHash = PRIVACY_HASH;

  // The confirmations: Reload's, and Clear history's (typed)
  confirming: 'reload' | 'clear' | null = null;
  typedClear = '';
  busy = false;
  message = '';

  constructor(
    readonly account: AccountService,
    readonly wallet: WalletService,
    readonly lines: LinesService,
  ) {
    // (the open bets' games looked up as soon as the bets arrive, and whenever they change)
    let seen = '';
    effect(() => {
      const ids = this.open().map((b) => b.id).join(',');
      if (ids && ids !== seen) {
        seen = ids;
        void this.refresh();
      }
    });
    // (once someone's signed in: the settled history where it shows (the wallet, Closed Bets), and the
    // leaderboards and the bot's ledgers on the wallet itself only: Open and Closed Bets show neither)
    effect(() => {
      if (!this.account.user()) return;
      if (this.only !== 'open') void this.wallet.loadSettled();
      if (!this.only && !this.extrasAsked) {
        this.extrasAsked = true;
        void this.loadBoards();
        void botLedger().then((bets) => this.ledger.set(bets));
      }
    });
  }
  private extrasAsked = false;

  readonly open = computed(() => this.wallet.bets().filter((b) => b.status === 'open'));
  readonly settled = computed(() => this.wallet.bets().filter((b) => b.status !== 'open'));
  readonly tally = computed(() => playTally(this.wallet.bets()));
  readonly curve = computed(() => playCurve(this.wallet.bets()));
  readonly openGames = computed(() => byGame(this.open()));
  // (the settled bets by sport and game, the latest game first unless the Date column's turned it round)
  readonly latestFirst = signal(true);
  readonly settledSports = computed(() => playBySport(byGame(this.settled(), this.latestFirst())));
  // (folded, as the Algorithm's: a sport's games, and a game's bets, until opened)
  private readonly unfolded = signal(new Set<string>());

  isOpen(key: string): boolean {
    return this.unfolded().has(key);
  }

  toggleOpen(key: string): void {
    const next = new Set(this.unfolded());
    if (!next.delete(key)) next.add(key);
    this.unfolded.set(next);
  }
  readonly versus = computed<Versus | null>(() => {
    const ledger = this.ledger();
    return ledger ? versusBot(this.wallet.bets(), ledger) : null;
  });
  // (the run's own profit: the balance against 1,000, the open stakes counted back in)
  readonly runProfit = computed(() => this.wallet.balance() + this.tally().atRisk - START);

  // (a bet decided in play: its result before the settler pays it)
  readonly decided = computed(() => {
    const out = new Map<string, Settled>();
    const boards = this.lines.boards();
    const props = this.propNow();
    for (const b of this.open()) {
      const r = provisionalOf(b, boards.get(`${b.sport}|${b.event}`), props.get(b.id));
      if (r) out.set(b.id, r);
    }
    return out;
  });
  readonly pending = computed(() => {
    let profit = 0;
    for (const r of this.decided().values()) profit += r.profit;
    return { count: this.decided().size, profit };
  });

  ngOnInit(): void {
    void this.account.start().catch(() => undefined);
    // (the open bets' games each minute: only while the page is in view, and only once one's near its start)
    if (this.only !== 'closed') {
      void this.refresh();
      this.timer = setInterval(() => {
        if (!document.hidden && this.open().some((b) => Date.parse(b.start) - NEAR <= Date.now())) void this.refresh();
      }, 60e3);
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // The open bets' games: their scores (each sport's scoreboard on their days), and the props' counts once
  // their games are under way
  private async refresh(): Promise<void> {
    const open = this.open();
    if (!open.length) return;
    await this.lines.games(open, 50e3);
    const boards = this.lines.boards();
    const next = new Map(this.propNow());
    const props = open.filter((b) => b.market === 'prop' && b.propType && b.athlete && boards.get(`${b.sport}|${b.event}`)?.state !== 'pre');
    const events = new Map<string, PlayBet[]>();
    for (const b of props) events.set(`${b.sport}|${b.event}`, [...(events.get(`${b.sport}|${b.event}`) ?? []), b]);
    await Promise.all(
      [...events.values()].map(async (list) => {
        const counts = await this.lines.propCounts(list[0].sport, list[0].event, list.map((b) => ({ id: b.id, propType: b.propType!, athlete: b.athlete! })));
        for (const [id, v] of counts) next.set(id, v);
      }),
    );
    this.propNow.set(next);
  }

  private async loadBoards(): Promise<void> {
    const got = await Promise.all(this.allPeriods.map((p) => this.wallet.leaderboard(p.id).catch(() => null)));
    const boards: Partial<Record<Period, Leaderboard | null>> = {};
    this.allPeriods.forEach((p, i) => (boards[p.id] = got[i]));
    this.boards.set(boards);
    // (the first period with anyone on it)
    const first = this.periods()[0];
    if (first) this.period.set(first.id);
  }

  // ---------------------------------------------------------------------------
  // Words and pictures
  // ---------------------------------------------------------------------------
  units(v: number): string {
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}u`;
  }

  pct(v: number | null | undefined, digits = 1): string {
    return v === null || v === undefined ? '-' : `${(v * 100).toFixed(digits)}%`;
  }

  teams(b: { matchup: string }): [string, string] {
    const [away, home] = b.matchup.split(' @ ');
    return [away ?? '', home ?? ''];
  }

  logo(sport: string, abbr: string): string {
    return teamLogo(sport, abbr);
  }

  face(b: PlayBet): string {
    return headshot(b.sport, b.athlete);
  }

  // (a game's line in play: its score and clock, or when it starts)
  gameState(g: { sport: string; event: string; start: string }): { text: string; live: boolean } {
    const board = this.lines.boards().get(`${g.sport}|${g.event}`);
    if (!board || board.state === 'pre') return { text: '', live: false };
    return { text: `${board.away.abbr} ${board.away.score ?? 0} · ${board.home.abbr} ${board.home.score ?? 0} · ${board.detail}`, live: board.state === 'in' };
  }

  // (a settled bet's result word: won, lost, push, or void with why)
  resultTitle(b: PlayBet): string {
    const base = `${b.status[0].toUpperCase()}${b.status.slice(1)}${b.final ? `: ${b.final}` : ''}`;
    return b.note ? `${base} (${b.note})` : base;
  }

  // (a past run's open bet: it settles and counts, its payout gone with the run)
  oldRun(b: PlayBet): boolean {
    return b.run !== (this.wallet.wallet()?.resets ?? 0);
  }

  stakeOf(list: PlayBet[]): number {
    return list.reduce((t, b) => t + b.stake, 0);
  }

  // (a game's bets' profit together)
  stakeProfit(list: PlayBet[]): number {
    return Math.round(list.reduce((t, b) => t + (b.profit ?? 0), 0) * 100) / 100;
  }

  // ---------------------------------------------------------------------------
  // Reload and Clear history
  // ---------------------------------------------------------------------------
  async reload(): Promise<void> {
    this.busy = true;
    this.message = '';
    try {
      await this.wallet.reload();
      this.message = `Reloaded: ${START.toLocaleString()} units, a fresh run.`;
      this.confirming = null;
    } catch {
      this.message = 'Couldn’t reload: try again.';
    } finally {
      this.busy = false;
    }
  }

  async clear(): Promise<void> {
    if (this.typedClear.trim().toUpperCase() !== 'CLEAR') return;
    this.busy = true;
    this.message = '';
    try {
      const n = await this.wallet.clearHistory();
      this.message = `Cleared ${n} settled bet${n === 1 ? '' : 's'}.`;
      this.confirming = null;
      this.typedClear = '';
    } catch {
      this.message = 'Couldn’t clear the history: try again.';
    } finally {
      this.busy = false;
    }
  }

  async openWallet(): Promise<void> {
    this.busy = true;
    try {
      await this.wallet.ensureWallet();
    } finally {
      this.busy = false;
    }
  }
}
