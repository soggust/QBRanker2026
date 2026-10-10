import { Component } from '@angular/core';
import { AccountService } from './account.service';
import { errorMessage, firstName } from './account-helpers';
import { canUse } from './features';

// The sport bar's account entry, on the far right: signed out, a small Sign in (the brand after it);
// signed in, in the brand's place, the user's first name then their avatar (phones: the avatar alone),
// opening their menu: the account pages (hash routes in app.component), Settings and Sign out. A faint
// circle while a returning user's sign-in is restored.
@Component({
  selector: 'account-menu',
  templateUrl: './account-menu.component.html',
  styleUrls: ['../../styles/components/account-menu.scss'],
  standalone: false,
})
export class AccountMenuComponent {
  constructor(readonly account: AccountService) {}

  // (the pages, Settings last; Sign out alone under the divider)
  private readonly all = [
    { hash: '#lists', icon: 'format_list_numbered', label: 'My Lists' },
    { hash: '#community', icon: 'leaderboard', label: 'Community' },
    { hash: '#tracker', icon: 'push_pin', label: 'Track Players' },
    { hash: '#wallet', icon: 'account_balance_wallet', label: 'Betting Wallet' },
    { hash: '#friends', icon: 'group', label: 'Friends' },
    { hash: '#account', icon: 'settings', label: 'Settings' },
  ];

  // (the Betting Wallet only where play betting is open: development, or an admin, like the Bets link)
  get items() {
    return canUse('bets') ? this.all : this.all.filter((item) => item.hash !== '#wallet');
  }

  get name(): string {
    return this.account.profile()?.displayName ?? '';
  }

  // (in the bar: the first name, cleaner in its capitals than an @user_name; the username when there's none)
  get first(): string {
    return firstName(this.name) || this.account.profile()?.username || '';
  }

  isOpen(hash: string): boolean {
    return location.hash === hash || location.hash.startsWith(hash + '/');
  }

  async signOut(): Promise<void> {
    try {
      await this.account.signOut();
      // (off an account page: back to the rankings)
      if (location.hash && location.hash !== '#bets') {
        history.pushState(null, '', location.pathname + location.search);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    } catch (error) {
      alert(errorMessage(error));
    }
  }
}
