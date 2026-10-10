import { Component, OnDestroy } from '@angular/core';
import { AccountService } from '../account.service';
import { errorMessage } from '../account-helpers';
import { FriendsService, PublicProfile } from './friends.service';
import { SEARCH_MIN, profileHash, searchPrefix } from './friends-helpers';
import { PRIVACY_HASH } from '../account-page.component';

// The Friends page (#friends): a bar on top (find people by username, a prefix search of the claims; the
// eye to Settings' Privacy), then the requests waiting on you (accept or decline), your friends (their
// profiles, remove) and the ones you've sent (cancel). Signed out, a prompt to sign in.
@Component({
  selector: 'friends-page',
  templateUrl: './friends-page.component.html',
  styleUrls: ['../../../styles/components/account-page.scss', '../../../styles/components/account-friends.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class FriendsPageComponent implements OnDestroy {
  readonly searchMin = SEARCH_MIN;
  readonly profileHash = profileHash;
  readonly privacyHash = PRIVACY_HASH;

  query = '';
  results: PublicProfile[] | null = null;
  searching = false;
  searchError = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  // (only the latest search's answer counts)
  private searchId = 0;

  constructor(
    readonly account: AccountService,
    readonly friends: FriendsService,
  ) {
    void account.start().catch(() => undefined);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  get groups() {
    return this.friends.groups();
  }

  // (as it's typed: a short wait, then the search)
  queryChanged(): void {
    if (this.timer) clearTimeout(this.timer);
    this.searchError = '';
    const prefix = searchPrefix(this.query);
    if (!prefix) {
      this.searchId++;
      this.results = null;
      this.searching = false;
      return;
    }
    this.searching = true;
    this.timer = setTimeout(() => void this.search(prefix), 250);
  }

  async search(prefix = searchPrefix(this.query)): Promise<void> {
    if (!prefix) return;
    const id = ++this.searchId;
    this.searching = true;
    try {
      const found = await this.friends.search(prefix);
      if (id === this.searchId) this.results = found;
    } catch (error) {
      console.error('Friends search', error);
      if (id === this.searchId) this.searchError = errorMessage(error);
    } finally {
      if (id === this.searchId) this.searching = false;
    }
  }

  clear(): void {
    this.query = '';
    this.queryChanged();
  }

  // (a typed query that can't be a username: say why there's nothing)
  get queryHint(): string {
    const q = this.query.trim().replace(/^@+/, '');
    if (!q) return '';
    if (q.length < SEARCH_MIN) return `Type at least ${SEARCH_MIN} characters.`;
    if (!searchPrefix(q)) return 'Usernames have only letters, numbers and underscores.';
    return '';
  }
}
