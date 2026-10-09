import { Component, HostListener, effect, inject } from '@angular/core';
import { SPORT } from '@sport/sport';
import { SITE_SPORTS } from '@ranker/core/sports';
import { badgeColor } from '@sport/team-colors';
import { AccountService } from '../account.service';
import { ListsStore } from './lists.store';
import { SavedList, listPath, logoUrl, readListHash } from './lists-helpers';
import { dateText, listWhere, sportLabel } from './list-view.component';

// The lists pages (#lists): the signed-in user's saved lists as scoreboard cards (where each is from, its
// title, its top five, when it changed, who sees it), every sport's, this sport's first; a list's own
// page (#lists/<uid>/<id>: list-view) for anyone its visibility lets in. Signed out, the index asks to
// sign in (a shared list's own page still opens, if it's public).
@Component({
  selector: 'lists-page',
  template: `
    <div class="lists-page" [class.wide]="!!target">
      @if (target; as t) {
        <nav class="page-crumbs" aria-label="Lists">
          <a href="#lists"><mat-icon aria-hidden="true" fontIcon="arrow_back"></mat-icon>{{ account.user() ? 'My lists' : 'Lists' }}</a>
          <a href="#community"><mat-icon aria-hidden="true" fontIcon="groups"></mat-icon>Community</a>
        </nav>
        <list-view [owner]="t.owner" [listId]="t.id"></list-view>
      } @else if (!account.ready()) {
        <div class="page-loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading your lists…</div>
      } @else if (!account.user()) {
        <div class="soon-panel">
          <mat-icon class="soon-icon" aria-hidden="true" fontIcon="format_list_numbered"></mat-icon>
          <h2>My lists</h2>
          <p class="soon-detail">Sign in to save your rankings as they are, see how they hold up, share them and submit them to the Community.</p>
          <button type="button" class="primary" (click)="account.openLogin()">Sign in</button>
          <a class="soon-back" href="#community">See the Community’s lists</a>
        </div>
      } @else {
        <page-head heading="My lists" icon="format_list_numbered" sub="Rankings you’ve saved, frozen as they were. Open one to see how its players are doing today.">
          <a class="secondary small-btn" href="#community"><mat-icon aria-hidden="true" fontIcon="groups"></mat-icon>Community</a>
        </page-head>

        @if (lists === null) {
          <div class="page-loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading your lists…</div>
        } @else if (store.error()) {
          <p class="form-error" role="alert">{{ store.error() }}</p>
        } @else if (!lists.length) {
          <div class="soon-panel empty">
            <mat-icon class="soon-icon" aria-hidden="true" fontIcon="playlist_add"></mat-icon>
            <h2>No lists yet</h2>
            <p class="soon-detail">Rank a tab your way (the sliders, or drag the rows), then use the grid’s Share button: <strong>Save this list…</strong></p>
            <a class="soon-back" href="#" (click)="back($event)">Go to the rankings</a>
          </div>
        } @else {
          @if (sports.length > 1) {
            <div class="sport-pills" role="radiogroup" aria-label="Sport">
              <button type="button" role="radio" class="game-filter small" [class.active]="sport === null" [attr.aria-checked]="sport === null" (click)="sport = null">All · {{ lists.length }}</button>
              @for (s of sports; track s.id) {
                <button type="button" role="radio" class="game-filter small" [class.active]="sport === s.id" [attr.aria-checked]="sport === s.id" (click)="sport = s.id">{{ s.label }} · {{ s.count }}</button>
              }
            </div>
          }
          <ul class="list-cards">
            @for (list of shown; track list.id) {
              <li>
                <a class="list-card" [href]="href(list)" [attr.aria-label]="list.title + ', ' + sportLabel(list.sport) + ' ' + listWhere(list)">
                  <span class="card-bar">
                    <span class="sport-led">{{ sportLabel(list.sport) }}</span>
                    <span class="card-where">{{ listWhere(list) }}</span>
                    <span class="vis-chip" [ngClass]="'vis-' + list.visibility" [title]="visTitle(list)">
                      <mat-icon aria-hidden="true" [fontIcon]="list.visibility === 'public' ? 'public' : list.visibility === 'friends' ? 'group' : 'lock'"></mat-icon>
                    </span>
                  </span>
                  <span class="card-title">{{ list.title }}</span>
                  <ol class="card-top">
                    @for (id of list.ids.slice(0, 5); track id; let i = $index) {
                      @if (list.snapshot[id]; as row) {
                        <li>
                          <span class="t-rank" [class.first]="i === 0">{{ i + 1 }}</span>
                          @if (row.photo) {
                            <img class="t-photo" [src]="row.photo" alt="" loading="lazy" [style.--team-badge]="badge(list, row.teamLogo)" />
                          } @else if (logo(list, row.teamLogo); as src) {
                            <img class="t-logo" [src]="src" alt="" loading="lazy" />
                          } @else {
                            <span class="t-logo"></span>
                          }
                          <span class="t-name">{{ row.name }}</span>
                        </li>
                      }
                    }
                  </ol>
                  <span class="card-foot">
                    <span>{{ list.ids.length }} {{ list.ids.length === 1 ? 'player' : 'players' }}</span>
                    <span class="dot" aria-hidden="true">·</span>
                    <span>{{ dateText(list.updatedAt) }}</span>
                    @if (list.community?.submitted) {
                      <span class="community-chip small"><mat-icon aria-hidden="true" fontIcon="groups"></mat-icon>Community</span>
                    }
                  </span>
                </a>
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styleUrls: ['../../../styles/components/account-lists.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class ListsPageComponent {
  readonly account = inject(AccountService);
  readonly store = inject(ListsStore);
  readonly sportLabel = sportLabel;
  readonly listWhere = listWhere;
  readonly dateText = dateText;

  target = readListHash(location.hash);
  sport: string | null = null;

  constructor() {
    void this.account.start().catch(() => undefined);
    effect(() => void this.store.follow(this.account.user()?.uid ?? null));
  }

  @HostListener('window:hashchange')
  hashChanged(): void {
    const next = readListHash(location.hash);
    if (next?.owner !== this.target?.owner || next?.id !== this.target?.id) this.target = next;
  }

  get lists(): SavedList[] | null {
    return this.store.mine();
  }

  // The sports the user has lists in (this sport first, then the sport bar's order)
  get sports(): { id: string; label: string; count: number }[] {
    const lists = this.lists ?? [];
    return SITE_SPORTS.map((s) => ({ id: s.id, label: s.label, count: lists.filter((l) => l.sport === s.id).length }))
      .filter((s) => s.count)
      .sort((a, b) => Number(b.id === SPORT.id) - Number(a.id === SPORT.id));
  }

  // The cards: the sport picked, or every sport's (this sport's first), newest change first
  get shown(): SavedList[] {
    const lists = (this.lists ?? []).filter((l) => !this.sport || l.sport === this.sport);
    return [...lists].sort((a, b) => Number(b.sport === SPORT.id) - Number(a.sport === SPORT.id));
  }

  href(list: SavedList): string {
    return list.sport === SPORT.id ? `#lists/${encodeURIComponent(list.owner)}/${encodeURIComponent(list.id)}` : listPath(list.sport, list.owner, list.id);
  }

  logo(list: SavedList, teamLogo: string | null): string | null {
    return logoUrl(list.sport, teamLogo);
  }

  // (a headshot on its team's color: this sport's lists, whose teams the colors know)
  badge(list: SavedList, teamLogo: string | null): string | null {
    return list.sport === SPORT.id && teamLogo ? badgeColor(teamLogo) : null;
  }

  visTitle(list: SavedList): string {
    return list.visibility === 'public' ? 'Public' : list.visibility === 'friends' ? 'Friends' : 'Only me';
  }

  back(event: Event): void {
    event.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}
