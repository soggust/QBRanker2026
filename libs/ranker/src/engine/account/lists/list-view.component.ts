import { Component, Input, OnChanges, OnDestroy, inject } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { SPORT } from '@sport/sport';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SITE_SPORTS } from '@ranker/core/sports';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { AccountService } from '../account.service';
import { Profile, VISIBILITY_CHOICES, Visibility, errorMessage } from '../account-helpers';
import { CommunityStore } from '../community/community.store';
import { boardKey } from '../community/community-helpers';
import { ListsStore, millis } from './lists.store';
import { readToday } from './list-today';
import { VISIBILITY_HINTS } from './save-list-dialog.component';
import {
  ComparedRow,
  NOTE_MAX,
  SavedList,
  SnapshotColumn,
  TITLE_MAX,
  TodayRow,
  compareToday,
  listColumns,
  listPath,
  logoUrl,
  noteProblem,
  reorderSnapshot,
  titleProblem,
} from './lists-helpers';

type Dialog = 'edit' | 'delete' | 'submit' | 'withdraw';

// (a sport's name: "NFL")
export const sportLabel = (id: string): string => SITE_SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();

// (a list's tab, season and part, as words: "Quarterbacks · 2026", "Teams · 2024 Playoffs")
export function listWhere(list: Pick<SavedList, 'sport' | 'tab' | 'season' | 'part'>): string {
  // (another sport's tab names aren't loaded here: its abbreviation, but Teams for every sport's TM)
  const tab = list.sport === SPORT.id ? ((SPORT.tabNames as Record<string, string>)[list.tab] ?? list.tab) : list.tab === 'TM' ? 'Teams' : list.tab;
  const season = list.sport === SPORT.id ? SPORT.seasonText(list.season) : String(list.season);
  const part = list.part === 'post' ? ' Playoffs' : list.part === 'all' ? ' Full Season' : '';
  return `${tab} · ${season}${part}`;
}

export const dateText = (stamp: unknown): string =>
  new Date(millis(stamp)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// One saved list (#lists/<uid>/<id>): the grid as it was saved (the rank tiles, team cards and names, and
// the numbers in the columns that were showing), or Today: the same players with their numbers now, each
// change since with an arrow, and where today's default ranking puts them. Its owner can rename it, edit
// its note, choose who sees it, drag it into a new order (saving the order, and the numbers too if they
// choose), copy its link, submit it to the Community, or delete it; anyone else sees it read-only (the
// rules let them read it only as its visibility allows).
@Component({
  selector: 'list-view',
  templateUrl: './list-view.component.html',
  styleUrls: ['../../../styles/components/account-lists.scss'],
  standalone: false,
})
export class ListViewComponent implements OnChanges, OnDestroy {
  readonly account = inject(AccountService);
  private readonly store = inject(ListsStore);
  private readonly community = inject(CommunityStore);
  private readonly seasons = inject(SeasonDataService);

  @Input({ required: true }) owner!: string;
  @Input({ required: true }) listId!: string;

  readonly sportId = SPORT.id;
  readonly hints = VISIBILITY_HINTS;
  readonly titleMax = TITLE_MAX;
  readonly noteMax = NOTE_MAX;
  readonly listWhere = listWhere;
  readonly sportLabel = sportLabel;
  readonly dateText = dateText;

  state: 'loading' | 'ready' | 'missing' = 'loading';
  list: SavedList | null = null;
  ownerProfile: Profile | null = null;
  columns: SnapshotColumn[] = [];
  // (the order showing: the list's, or the owner's drag not saved yet)
  order: string[] = [];
  reordered = false;

  mode: 'saved' | 'today' = 'saved';
  today: Map<string, TodayRow> | null = null;
  todayState: 'idle' | 'loading' | 'error' = 'idle';
  compared: ComparedRow[] = [];

  dialog: Dialog | null = null;
  title = '';
  note = '';
  editVisibility: Visibility = 'public';
  touched = false;
  busy = false;
  error = '';
  toast = '';
  private toastTimer?: ReturnType<typeof setTimeout>;
  private stop: (() => void) | null = null;

  ngOnChanges(): void {
    void this.account.start().catch(() => undefined);
    this.stop?.();
    this.state = 'loading';
    this.list = null;
    this.toast = '';
    this.today = null;
    this.todayState = 'idle';
    this.mode = 'saved';
    this.ownerProfile = null;
    // (this list's own: a watch or a profile for a list shown before it, landing late, is dropped)
    const showing = ++this.showing;
    const owner = this.owner;
    void this.community.profile(owner).then((p) => showing === this.showing && (this.ownerProfile = p));
    void this.store
      .watch(owner, this.listId, (list) => showing === this.showing && this.loaded(list))
      .then((stop) => (showing === this.showing ? (this.stop = stop) : stop()))
      .catch(() => showing === this.showing && (this.state = 'missing'));
  }
  private showing = 0;

  ngOnDestroy(): void {
    this.showing++;
    this.stop?.();
    clearTimeout(this.toastTimer);
  }

  private loaded(list: SavedList | null): void {
    if (!list) {
      this.state = 'missing';
      this.list = null;
      return;
    }
    const orderKept = this.reordered && this.list?.ids.join('|') === list.ids.join('|');
    this.list = list;
    this.columns = listColumns(list);
    if (!orderKept) {
      this.order = list.ids.filter((id) => id in list.snapshot);
      this.reordered = false;
    }
    this.state = 'ready';
    this.compare();
  }

  get mine(): boolean {
    return !!this.list && this.account.user()?.uid === this.list.owner;
  }

  // (a list of another sport opens on that sport's page)
  get elsewhere(): boolean {
    return !!this.list && this.list.sport !== SPORT.id;
  }

  get elsewhereHref(): string {
    return this.list ? listPath(this.list.sport, this.list.owner, this.list.id) : '#lists';
  }

  get ownerName(): string {
    return this.ownerProfile?.displayName || this.ownerProfile?.username || 'Someone';
  }

  // ---------------------------------------------------------------------------
  // The rows: as saved, or against today
  // ---------------------------------------------------------------------------
  private compare(): void {
    if (!this.list) return;
    const ordered = { ...this.list, ids: this.order };
    this.compared = compareToday(ordered, this.today ?? new Map());
  }

  async setMode(mode: 'saved' | 'today'): Promise<void> {
    this.mode = mode;
    if (mode === 'today') await this.loadToday();
  }

  private async loadToday(): Promise<void> {
    if (!this.list || this.today || this.todayState === 'loading' || this.elsewhere) return;
    this.todayState = 'loading';
    try {
      this.today = await readToday(this.list, this.seasons);
      this.todayState = 'idle';
      this.compare();
    } catch (error) {
      console.error('Today', error);
      this.todayState = 'error';
    }
  }

  // (gone from the season's data: his saved numbers, marked)
  missingToday(row: ComparedRow): boolean {
    return this.mode === 'today' && !!this.today && !row.today;
  }

  rankClass(i: number): string {
    if (i === 0) return 'count top-5';
    if (i < 10) return 'count top-10';
    return 'count';
  }

  rankMoveTitle(row: ComparedRow, i: number): string {
    const now = row.today?.rank;
    if (!now) return 'Not in today’s default ranking (under the playing-time minimum, or not listed)';
    return `#${i + 1} in this list · #${now} in today’s default ranking`;
  }

  // The team card: the team's color, its logo as it looked that season (this sport's lists only)
  badge(row: ComparedRow): string | null {
    return row.saved.teamLogo && !this.elsewhere ? badgeColor(row.saved.teamLogo) : null;
  }

  whiteLogo(row: ComparedRow): boolean {
    return !!row.saved.teamLogo && !this.elsewhere && whiteLogo(row.saved.teamLogo);
  }

  logo(row: ComparedRow): string | null {
    const logo = row.saved.teamLogo;
    if (!logo || !this.list) return null;
    return logoUrl(this.list.sport, this.elsewhere ? logo : logoForSeason(logo, this.list.season));
  }

  private photoMisses = new Set<string>();

  photo(row: ComparedRow): string | null {
    return row.saved.photo && !this.photoMisses.has(row.id) ? row.saved.photo : null;
  }

  noPhoto(row: ComparedRow): void {
    this.photoMisses.add(row.id);
  }

  trendIcon(trend: string | null): string {
    return trend === 'up' ? 'arrow_drop_up' : trend === 'down' ? 'arrow_drop_down' : '';
  }

  // ---------------------------------------------------------------------------
  // The owner's order: dragged, then saved (the numbers as saved, or brought up to today)
  // ---------------------------------------------------------------------------
  drop(event: CdkDragDrop<unknown>): void {
    if (!this.mine || event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.order, event.previousIndex, event.currentIndex);
    this.reordered = true;
    this.compare();
  }

  undoOrder(): void {
    if (!this.list) return;
    this.order = this.list.ids.filter((id) => id in this.list!.snapshot);
    this.reordered = false;
    this.compare();
  }

  async saveOrder(updateNumbers: boolean): Promise<void> {
    const list = this.list;
    if (!list || this.busy) return;
    this.busy = true;
    try {
      const change = reorderSnapshot(list, this.order);
      if (updateNumbers) {
        if (!this.today) await this.loadToday();
        for (const id of change.ids) {
          const now = this.today?.get(id);
          if (now) change.snapshot[id] = { ...change.snapshot[id], values: now.values, texts: now.texts };
        }
      }
      await this.store.update(list.id, change);
      this.reordered = false;
      this.say(updateNumbers ? 'Order and numbers saved' : 'Order saved');
    } catch (error) {
      this.say(errorMessage(error));
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // The owner's other actions
  // ---------------------------------------------------------------------------
  open(dialog: Dialog): void {
    if (!this.list) return;
    this.dialog = dialog;
    this.title = this.list.title;
    this.note = this.list.note ?? '';
    this.editVisibility = this.list.visibility;
    this.touched = false;
    this.error = '';
  }

  get titleError(): string | null {
    return titleProblem(this.title);
  }

  get noteError(): string | null {
    return noteProblem(this.note);
  }

  async saveEdit(): Promise<void> {
    this.touched = true;
    if (!this.list || this.busy || this.titleError || this.noteError) return;
    await this.run(() => this.store.update(this.list!.id, { title: this.title.trim(), note: this.note.trim(), visibility: this.editVisibility }), 'Saved');
  }

  async setVisibility(visibility: Visibility): Promise<void> {
    if (!this.list || this.list.visibility === visibility || this.busy) return;
    this.busy = true;
    try {
      await this.store.update(this.list.id, { visibility });
      this.say(`Now: ${VISIBILITY_CHOICES.find((c) => c.value === visibility)?.label}`);
    } catch (error) {
      this.say(errorMessage(error));
    } finally {
      this.busy = false;
    }
  }

  async remove(): Promise<void> {
    const list = this.list;
    if (!list) return;
    await this.run(() => this.store.remove(list), '');
    if (!this.error) location.hash = '#lists';
  }

  get boardName(): string {
    return this.list ? `${sportLabel(this.list.sport)} ${listWhere(this.list)}` : '';
  }

  get boardHref(): string {
    return this.list ? `#community/${this.list.tab}/${this.list.season}` : '#community';
  }

  async submit(): Promise<void> {
    const list = this.list;
    if (!list) return;
    await this.run(() => this.store.submit(list), 'Submitted to the Community');
  }

  async withdraw(): Promise<void> {
    const list = this.list;
    if (!list) return;
    await this.run(() => this.store.withdraw(list), 'Taken off the Community board');
  }

  // (a dialog's action: busy while it runs, the dialog shut once it's done, its error kept in it if not)
  private async run(action: () => Promise<void>, done: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await action();
      this.dialog = null;
      if (done) this.say(done);
    } catch (error) {
      console.error('List', error);
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  async copyLink(): Promise<void> {
    if (!this.list) return;
    const url = location.origin + listPath(this.list.sport, this.list.owner, this.list.id);
    try {
      await navigator.clipboard.writeText(url);
      this.say(this.list.visibility === 'private' ? 'Link copied (private: only you can open it)' : 'Link copied');
    } catch {
      this.say(url);
    }
  }

  get submittedKey(): string | null {
    const list = this.list;
    return list?.community?.submitted && list.community.key === boardKey(list.sport, list.tab, list.season) ? list.community.key : null;
  }

  private say(text: string): void {
    this.toast = text;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 2600);
  }
}
