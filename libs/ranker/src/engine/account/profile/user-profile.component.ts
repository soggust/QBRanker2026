import { Component, Input, WritableSignal, effect, signal, untracked } from '@angular/core';
import { SITE_SPORTS } from '@ranker/core/sports';
import { SPORT } from '@sport/sport';
import { AccountService } from '../account.service';
import { Profile, VisibilityKind, errorMessage } from '../account-helpers';
import { canUse } from '../features';
import { FriendsService } from '../friends/friends.service';
import { Access, BetRecord, accessAll, betRecord, hiddenNote, money, oddsText, recordText, relationOf } from '../friends/friends-helpers';
import { listPath } from '../lists/lists-helpers';
import { BetSummary, ListSummary, PinSummary, PresetSummary, loadBalance, loadBets, loadLists, loadPins, loadPresets } from './profile-data';

type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

// A public profile (#u/<username>): the user's picture, names, bio and favorite team, the friendship
// button, and what they share with this viewer: their saved lists, presets, tracker and bets, each by
// their own setting (Public, Friends, Only me). What's hidden says so (Friends only, or Private); the
// rules guard the data itself. Their own profile shows them everything, with a way to edit it.
@Component({
  selector: 'user-profile',
  templateUrl: './user-profile.component.html',
  styleUrls: ['../../../styles/components/account-page.scss', '../../../styles/components/account-profile.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class UserProfileComponent {
  readonly canUse = canUse;
  readonly money = money;
  readonly oddsText = oddsText;
  readonly recordText = recordText;

  private readonly name = signal('');
  @Input({ required: true }) set username(name: string) {
    this.name.set(name);
  }
  get username(): string {
    return this.name();
  }

  // (whose profile: looking it up, theirs, or no one has that name)
  readonly person = signal<{ state: 'loading' } | { state: 'missing' } | { state: 'error'; message: string } | { state: 'found'; uid: string; profile: Profile }>({
    state: 'loading',
  });

  readonly lists = signal<Load<ListSummary[]> | null>(null);
  readonly presets = signal<Load<PresetSummary[]> | null>(null);
  readonly pins = signal<Load<PinSummary[]> | null>(null);
  readonly openBets = signal<Load<BetSummary[]> | null>(null);
  readonly settledBets = signal<Load<BetSummary[]> | null>(null);
  readonly balance = signal<number | null>(null);

  // (the sections' data, asked for again whenever what this viewer may see changes)
  private loadedKey = '';

  constructor(
    readonly account: AccountService,
    readonly friends: FriendsService,
  ) {
    void account.start().catch(() => undefined);
    // (a new name: look it up)
    effect(() => {
      const name = this.name();
      if (!this.account.ready()) return;
      untracked(() => void this.lookUp(name));
    });
    // (the sections this viewer may see, loaded once per change of what that is)
    effect(() => {
      const person = this.person();
      if (person.state !== 'found') return;
      const access = this.access;
      const key = person.uid + '|' + this.relation + '|' + JSON.stringify(access) + '|' + canUse('bets');
      untracked(() => {
        if (key === this.loadedKey) return;
        this.loadedKey = key;
        void this.loadSections(person.uid, access);
      });
    });
  }

  private async lookUp(name: string): Promise<void> {
    this.person.set({ state: 'loading' });
    this.loadedKey = '';
    try {
      const found = await this.friends.byUsername(name);
      if (this.name() !== name) return;
      this.person.set(found ? { state: 'found', ...found } : { state: 'missing' });
    } catch (error) {
      console.error('Profile', error);
      if (this.name() === name) this.person.set({ state: 'error', message: errorMessage(error) });
    }
  }

  // ---------------------------------------------------------------------------
  // Who's looking, and what they may see
  // ---------------------------------------------------------------------------
  get found(): { uid: string; profile: Profile } | null {
    const p = this.person();
    if (p.state !== 'found') return null;
    // (your own profile: the live one, so an edit on #account shows straight away)
    const mine = this.account.user();
    return mine?.uid === p.uid && mine.profile ? { uid: p.uid, profile: mine.profile } : p;
  }

  get relation() {
    const p = this.person();
    if (p.state !== 'found') return 'none' as const;
    return relationOf(this.account.user()?.uid, p.uid, this.friends.statusOf(p.uid));
  }

  get isSelf(): boolean {
    return this.relation === 'self';
  }

  // (lists: each list says who sees it, the profile's setting only the default for a new one, so the section
  // always asks, for the ones this viewer may see)
  get access(): Record<VisibilityKind, Access> {
    return { ...accessAll(this.found?.profile.visibility, this.relation), lists: 'shown' };
  }

  listHref(uid: string, list: ListSummary): string {
    return listPath(list.sport || SPORT.id, uid, list.id);
  }

  hidden(kind: VisibilityKind): string {
    return hiddenNote(this.access[kind], this.found?.profile.displayName ?? '');
  }

  private async loadSections(uid: string, access: Record<VisibilityKind, Access>): Promise<void> {
    const owner = this.isSelf;
    const friend = this.relation === 'friends';
    const run = async <T>(target: WritableSignal<Load<T> | null>, kind: VisibilityKind, load: () => Promise<T>) => {
      // (bets only where play betting is open)
      const bets = kind === 'openBets' || kind === 'betHistory';
      if (access[kind] !== 'shown' || (bets && !canUse('bets'))) {
        target.set(null);
        return;
      }
      target.set({ state: 'loading' });
      try {
        const value = await load();
        if (this.found?.uid === uid) target.set({ state: 'ready', value });
      } catch (error) {
        console.error('Profile', kind, error);
        if (this.found?.uid === uid) target.set({ state: 'error', message: errorMessage(error) });
      }
    };
    this.balance.set(null);
    await Promise.all([
      run(this.lists, 'lists', () => loadLists(uid, owner, friend)),
      run(this.presets, 'presets', () => loadPresets(uid, owner, friend)),
      run(this.pins, 'tracker', () => loadPins(uid, owner, friend)),
      run(this.openBets, 'openBets', () => loadBets(uid, 'open')),
      run(this.settledBets, 'betHistory', () => loadBets(uid, 'settled')),
      access.betHistory === 'shown' && canUse('bets')
        ? loadBalance(uid)
            .then((b) => this.found?.uid === uid && this.balance.set(b))
            .catch(() => undefined)
        : Promise.resolve(),
    ]);
  }

  // ---------------------------------------------------------------------------
  // For the template
  // ---------------------------------------------------------------------------
  sportLabel(id: string): string {
    return SITE_SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();
  }

  // (a team logo by its address, or the sport app's own path to it)
  get favoriteLogo(): string {
    const team = this.found?.profile.favoriteTeam;
    if (!team?.logo) return '';
    return team.logo.startsWith('https:') || team.logo.startsWith('/') ? team.logo : '/' + team.sport + '/' + team.logo;
  }

  get firstName(): string {
    return this.found?.profile.displayName.trim().split(' ')[0] || 'them';
  }

  get favoriteSport(): string {
    const team = this.found?.profile.favoriteTeam;
    return team ? this.sportLabel(team.sport) : '';
  }

  // (their settled record: tallies, profit and ROI)
  get record(): BetRecord | null {
    const settled = this.settledBets();
    return settled?.state === 'ready' ? betRecord(settled.value) : null;
  }

  recent(bets: BetSummary[]): BetSummary[] {
    return bets.slice(0, 6);
  }

  betResult(bet: BetSummary): string {
    if (bet.status === 'push') return 'Push';
    if (bet.status === 'void') return 'Void';
    return bet.status === 'won' ? 'Won' : 'Lost';
  }

  when(ms: number): string {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  kickoff(ms: number): string {
    if (!ms) return '';
    return new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  joined(value: unknown): string {
    const v = value as { toDate?: () => Date } | null;
    const date = v?.toDate?.();
    return date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
  }

  // (anything to show in the Bets panel at all)
  get betsHidden(): boolean {
    return this.access.openBets !== 'shown' && this.access.betHistory !== 'shown';
  }

  // (all of it hidden: the more open of the two settings says why, friends only before private)
  get betsKind(): VisibilityKind {
    return this.access.betHistory !== 'friends-only' && this.access.openBets === 'friends-only' ? 'openBets' : 'betHistory';
  }
}
