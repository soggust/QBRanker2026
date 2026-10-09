import { Component, ElementRef, HostListener, ViewChild, effect } from '@angular/core';
import { AccountService } from '../account.service';
import { WalletService } from './wallet.service';
import { CHIPS, Selection, addChip, oddsText, payout, slipTotals, toWin } from './wallet-math';

// The bet slip: the prices clicked on the Bets page, each with its stake (a casino's chips, 1, 5, 10, 25 and
// 100 units, stacked on with each click, or a number typed), what it'd win and pay back, then Place. A
// drawer from the corner (a sheet along the bottom on phones) styled as a chip tray; a stack of chips with
// the count shows while it's shut. Play money only: signed out, it asks for a sign-in first.
@Component({
  selector: 'bet-slip',
  templateUrl: './bet-slip.component.html',
  styleUrls: ['../../../styles/components/wallet-slip.scss'],
  standalone: false,
})
export class BetSlipComponent {
  readonly chips = CHIPS;
  readonly oddsText = oddsText;
  readonly toWin = toWin;
  readonly payout = payout;
  error = '';
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;

  constructor(
    readonly wallet: WalletService,
    readonly account: AccountService,
  ) {
    // (opened: focus into it)
    effect(() => {
      if (this.wallet.slipOpen()) setTimeout(() => this.panel?.nativeElement.focus({ preventScroll: true }));
    });
  }

  get totals() {
    return slipTotals(this.wallet.slip());
  }

  // (what's left in the wallet for this bet: the balance less the slip's other stakes)
  room(s: Selection): number {
    const others = this.wallet.slip().filter((x) => x.key !== s.key).reduce((t, x) => t + (x.stake > 0 ? x.stake : 0), 0);
    return this.wallet.balance() - others;
  }

  chip(s: Selection, value: number): void {
    this.wallet.setStake(s.key, addChip(s.stake, value, this.room(s)));
  }

  typed(s: Selection, value: string): void {
    this.wallet.setStake(s.key, Number(value));
  }

  get problems(): boolean {
    return this.wallet.slip().some((s) => s.stake > 0 && this.wallet.problem(s));
  }

  close(): void {
    this.wallet.slipOpen.set(false);
  }

  // (the failure the last placing had on a bet still on the slip)
  failure(s: Selection): string | null {
    return this.wallet.placed()?.failed.find((f) => f.key === s.key)?.why ?? null;
  }

  async place(): Promise<void> {
    this.error = '';
    if (!this.account.signedIn()) {
      this.account.openLogin();
      return;
    }
    try {
      await this.wallet.place();
    } catch (error) {
      this.error = (error as { code?: string }).code === 'auth/no-current-user' ? 'Sign in to place bets' : 'Couldn’t reach the wallet: try again';
    }
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    if (this.wallet.slipOpen() && !this.account.loginOpen()) this.close();
  }
}
