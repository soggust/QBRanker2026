import { Component, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PositionService } from '@ranker/engine/position.service';
import { POSITIONS, Position } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SITE_SPORTS } from '@ranker/core/sports';
import { SportSettings } from '@ranker/engine/sport';
import { AccountService } from '@ranker/engine/account/account.service';
import { canUse } from '@ranker/engine/account/features';

// The page showing, from the address's hash: the rankings (no hash), the Bets page (#bets), or an account
// page (#account, #lists, #community, #tracker, #wallet, #friends, #u/<username>: a public profile)
export type View = 'rankings' | 'bets' | 'account' | 'lists' | 'community' | 'tracker' | 'wallet' | 'friends' | 'user';
const HASH_VIEWS: Record<string, View> = {
  bets: 'bets',
  account: 'account',
  lists: 'lists',
  community: 'community',
  tracker: 'tracker',
  wallet: 'wallet',
  friends: 'friends',
};

export function viewOf(hash: string): View {
  const key = hash.replace(/^#/, '');
  if (key.startsWith('u/') && key.length > 2) return 'user';
  // ---- lists (phase 2) ----
  // (#lists/<uid>/<id>: one saved list; #community/<tab>/<season>: a board)
  if (key.startsWith('lists/')) return 'lists';
  if (key.startsWith('community/')) return 'community';
  // ---- end lists ----
  // ---- tracker (phase 2) ----
  // (#tracker/<uid>: someone's tracker, read only)
  if (key.startsWith('tracker/') && key.length > 8) return 'tracker';
  // ---- end tracker ----
  return Object.hasOwn(HASH_VIEWS, key) ? HASH_VIEWS[key] : 'rankings';
}

// (each page's name, for the page heading and the tab)
const VIEW_TITLES: Record<Exclude<View, 'rankings'>, string> = {
  bets: 'Bets',
  account: 'Profile & settings',
  lists: 'My lists',
  community: 'Community',
  tracker: 'Tracker',
  wallet: 'Wallet',
  friends: 'Friends',
  user: 'Profile',
};

// The tabs the sport's settings show (SPORT.tabVisible: MMA's divisions, men's or women's)
function visibleTabs(settings: SportSettings): Position[] {
  return POSITIONS.filter((tab) => SPORT.tabVisible?.(tab, settings) ?? true);
}

// The page: the sport bar, the filter menu, the position tabs and the rankings, and About when it's open
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['../styles/components/app.component.scss'],
  standalone: false,
})
export class AppComponent {
  // The sport bar across the top: each sport is its own app on the same site (apps/<sport>, served at
  // /<sport>/); this one is lit
  readonly sport = SPORT.id;
  readonly siteSports = SITE_SPORTS;
  // (the page's name, for its heading: "NFL")
  readonly sportName = SITE_SPORTS.find((s) => s.id === SPORT.id)?.label ?? SPORT.id.toUpperCase();

  // The page in place of the rankings, from the hash: the Bets page (#bets, from the sport bar's Bets
  // link) or an account page (the account menu's)
  view: View = viewOf(location.hash);
  readonly canUse = canUse;

  @HostListener('window:hashchange')
  onHashChange(): void {
    this.view = viewOf(location.hash);
  }

  get viewTitle(): string {
    return this.view === 'rankings' ? this.sportName + ' Season Ranker' : VIEW_TITLES[this.view];
  }

  // (#u/<username>: whose profile)
  get viewUser(): string {
    return decodeURIComponent(location.hash.slice('#u/'.length));
  }

  // The sport bar's sports: a sport not ready for everyone (MMA) only in development or for an admin
  get sports(): { id: string; label: string }[] {
    return this.siteSports.filter((s) => !s.devOnly || canUse('mma'));
  }

  // This sport not ready for everyone (MMA on the live site): Coming soon, unless an admin's signed in
  // (nothing while a sign-in is still being restored)
  readonly sportGated = SITE_SPORTS.find((s) => s.id === SPORT.id)?.devOnly ?? false;
  get gate(): 'open' | 'wait' | 'soon' {
    if (!this.sportGated || canUse('mma')) return 'open';
    return this.account.settled() ? 'soon' : 'wait';
  }

  position$ = this.positionService.position$;
  aboutOpen$ = this.positionService.aboutOpen$;
  readonly positionNames = SPORT.tabNames as Record<Position, string>;

  get positions(): Position[] {
    return visibleTabs(this.positionService.settings.sport);
  }

  // Below 1200px the filters are a slide-out menu (menu-open); above, a sidebar that collapses. Both
  // follow the one open / closed state (the footer's filter button and the menu's X).
  private readonly smallScreen = window.matchMedia('(max-width: 1199px)');

  constructor(
    private positionService: PositionService,
    readonly account: AccountService,
  ) {
    // A setting that shows new tabs (MMA's women's divisions) opens the first of them; one that
    // hides the open tab goes back to the first tab
    let shown = this.positions;
    this.positionService.sportSettings$.pipe(takeUntilDestroyed()).subscribe((settings) => {
      if (!SPORT.tabVisible) return;
      const now = visibleTabs(settings);
      const added = now.filter((tab) => !shown.includes(tab));
      shown = now;
      const open = this.positionService.position;
      if (added.length) this.positionService.setPosition(added[0]);
      else if (open && !now.includes(open)) this.positionService.setPosition(POSITIONS[0]);
    });
  }

  get menuOpen(): boolean {
    return this.smallScreen.matches && this.positionService.filtersOpen;
  }

  get sidebarCollapsed(): boolean {
    return !this.smallScreen.matches && !this.positionService.filtersOpen;
  }

  // A click outside the filter menu closes it: not one in its dropdowns' lists (they open over the page)
  // or on the filter button (that toggles it)
  @HostListener('document:pointerdown', ['$event'])
  closeOnOutsideClick(event: PointerEvent): void {
    if (!this.positionService.filtersOpen) return;
    if ((event.target as Element | null)?.closest('.sidebar-shell, .cdk-overlay-container, .filter-toggle')) return;
    this.closeFilters();
  }

  closeFilters(): void {
    this.positionService.setFiltersOpen(false);
  }

  selectPosition(position: Position): void {
    this.positionService.setPosition(position);
  }

  closeAbout(): void {
    this.positionService.setAboutOpen(false);
  }
}
