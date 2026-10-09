import { Component } from '@angular/core';
import { AccountService } from './account.service';
import { errorMessage, firstName } from './account-helpers';

// The sport bar's account entry, just left of the brand: signed out, a small Sign in; signed in, the
// user's avatar and first name (phones: the avatar alone) opening their menu: the account pages (hash
// routes in app.component) and Sign out. Nothing shows while a returning user's sign-in is restored.
@Component({
  selector: 'account-menu',
  templateUrl: './account-menu.component.html',
  styleUrls: ['../../styles/components/account-menu.scss'],
  standalone: false,
})
export class AccountMenuComponent {
  constructor(readonly account: AccountService) {}

  readonly items = [
    { hash: '#account', icon: 'manage_accounts', label: 'Profile & settings' },
    { hash: '#lists', icon: 'format_list_numbered', label: 'My lists' },
    { hash: '#tracker', icon: 'push_pin', label: 'Tracker' },
    { hash: '#wallet', icon: 'account_balance_wallet', label: 'Wallet' },
    { hash: '#friends', icon: 'group', label: 'Friends' },
  ];

  get name(): string {
    return this.account.profile()?.displayName ?? '';
  }

  get first(): string {
    return firstName(this.name) || this.account.profile()?.username || '';
  }

  isOpen(hash: string): boolean {
    return location.hash === hash;
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
