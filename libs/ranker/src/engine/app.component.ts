import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PositionService } from '@ranker/engine/position.service';
import { POSITIONS, Position } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SITE_SPORTS } from '@ranker/core/sports';
import { SportSettings } from '@ranker/engine/sport';
import { AccountService } from '@ranker/engine/account/account.service';
import { canUse } from '@ranker/engine/account/features';

// The page showing, from the address's hash: the rankings (no hash), the Bets page (#bets), or an account
// page (#account, #lists, #community, #tracker, #wallet, #friends, #u/<username>: a public profile), or the
// site's Privacy Policy (#privacy) and Data deletion (#data-deletion) pages, open to anyone
export type View =
  | 'rankings'
  | 'bets'
  | 'account'
  | 'lists'
  | 'community'
  | 'tracker'
  | 'wallet'
  | 'friends'
  | 'user'
  | 'privacy'
  | 'data-deletion';
const HASH_VIEWS: Record<string, View> = {
  bets: 'bets',
  account: 'account',
  lists: 'lists',
  community: 'community',
  tracker: 'tracker',
  wallet: 'wallet',
  friends: 'friends',
  privacy: 'privacy',
  'data-deletion': 'data-deletion',
};

// (#u/<username>: a profile; #lists/<uid>/<id>: one saved list; #community/<tab>/<season>: a board;
// #tracker/<uid>: someone's tracker, read only)
export function viewOf(hash: string): View {
  const key = hash.replace(/^#/, '');
  if (key.startsWith('u/') && key.length > 2) return 'user';
  if (key.startsWith('lists/')) return 'lists';
  if (key.startsWith('community/')) return 'community';
  if (key.startsWith('tracker/') && key.length > 8) return 'tracker';
  // #account/privacy, Settings with Privacy open
  if (key === 'account/privacy') return 'account';
  return Object.hasOwn(HASH_VIEWS, key) ? HASH_VIEWS[key] : 'rankings';
}

// (#u/<username>: the name; '' on any other page)
function userOf(hash: string): string {
  if (viewOf(hash) !== 'user') return '';
  try {
    return decodeURIComponent(hash.slice('#u/'.length));
  } catch {
    return hash.slice('#u/'.length);
  }
}

// (each page's name, for the page heading and the tab)
const VIEW_TITLES: Record<Exclude<View, 'rankings'>, string> = {
  bets: 'Bets',
  account: 'Settings',
  lists: 'My Lists',
  community: 'Community',
  tracker: 'Track Players',
  wallet: 'Betting Wallet',
  friends: 'Friends',
  user: 'Profile',
  privacy: 'Privacy Policy',
  'data-deletion': 'Data Deletion',
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

  // A link to one of this page's views (href="#lists", "#bets", "#u/name"): only its hash changes. Taken as
  // written, it resolves against the page's <base href="/<sport>/"> and loads the app again, losing the
  // address's ?pos and ?season (the grid's tab and season) and the app's state
  @HostListener('document:click', ['$event'])
  onHashLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    event.preventDefault();
    const hash = link.getAttribute('href')!;
    if (location.hash !== hash) location.hash = hash;
  }

  @HostListener('window:hashchange')
  onHashChange(): void {
    const before = this.view + this.viewUser;
    this.view = viewOf(location.hash);
    this.viewUser = userOf(location.hash);
    this.markBetsView();
    // (another page on the sheet: its top, not the last page's scroll)
    if (this.view + this.viewUser !== before && this.sheetBody) this.sheetBody.nativeElement.scrollTop = 0;
  }

  // (the Bets page's gold light over the whole app, the sport bar and the menus too: _base.scss's bets-view; the
  // account menu in the app's sand only over the sheet's pages: sheet-view)
  private markBetsView(): void {
    document.documentElement.classList.toggle('bets-view', this.view === 'bets');
    document.documentElement.classList.toggle('sheet-view', this.onSheet);
  }

  // Every page but the rankings and the Bets page sits on the app's sheet (its scroll container)
  get onSheet(): boolean {
    return this.view !== 'rankings' && this.view !== 'bets';
  }
  // (the pages with tables and boards get the grid's width; the rest a reading width, the backdrop around it)
  get wideSheet(): boolean {
    return this.view === 'lists' || this.view === 'community' || this.view === 'tracker' || this.view === 'wallet';
  }
  @ViewChild('sheetBody') private sheetBody?: ElementRef<HTMLElement>;

  get viewTitle(): string {
    return this.view === 'rankings' ? this.sportName + ' Season Ranker' : VIEW_TITLES[this.view];
  }

  // (#u/<username>: whose profile; set with the view, so a change of page never hands the profile another
  // page's hash for a name)
  viewUser = userOf(location.hash);

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
    this.markBetsView();
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

  // (the filters out of sight, a phone's menu shut or the sidebar collapsed: inert, so Tab doesn't wander
  // through its controls off the screen)
  get filtersShut(): boolean {
    return !this.positionService.filtersOpen;
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
