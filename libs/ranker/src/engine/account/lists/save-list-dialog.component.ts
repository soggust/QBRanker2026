import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { SPORT } from '@sport/sport';
import { AccountService } from '../account.service';
import { Visibility, errorMessage } from '../account-helpers';
import { ListDraft, ListsStore } from './lists.store';
import { NOTE_MAX, TITLE_MAX, logoUrl, noteProblem, titleProblem } from './lists-helpers';

// What each choice means for a list
export const VISIBILITY_HINTS: Record<Visibility, string> = {
  public: 'Anyone with the link can see it, and it shows on your profile.',
  friends: 'Only friends (people you’ve both added) can see it.',
  private: 'Only you can see it.',
};

// "Save this list" (the grid's floppy disk, or a phone's More): a title (the default filled in), a note and
// who sees it, for the grid as it is now (its top rows in their order, and the numbers in the columns
// showing, frozen). Saving closes it at once (the grid's toast says so, with Open and Rename); the toast's
// Rename opens it again on the saved list, its title alone (renameId). Signed out, it asks to sign in first.
// Over the sport's own grid, in the sport's look: its buttons and pills, lit in its color.
@Component({
  selector: 'save-list-dialog',
  template: `
    <list-modal [heading]="renameId ? 'Rename list' : 'Save this list'" [icon]="renameId ? 'edit' : 'save'" [busy]="busy" (closed)="closed.emit()">
      @if (!account.user()) {
        <p class="modal-lede">Sign in to save lists: keep this ranking as it is now, watch how it holds up, and share it or submit it to the Community.</p>
        <div class="modal-actions">
          <button type="button" class="secondary" (click)="closed.emit()">Not now</button>
          <button type="button" class="primary" (click)="account.openLogin()">Sign in</button>
        </div>
      } @else if (renameId) {
        <form novalidate (ngSubmit)="save()">
          <label class="field">
            <span class="field-label">Title <span class="count" [class.over]="title.length > titleMax">{{ title.length }}/{{ titleMax }}</span></span>
            <input name="title" type="text" [maxlength]="titleMax + 20" [(ngModel)]="title" [attr.aria-invalid]="!!(touched && titleError)" />
            @if (touched && titleError; as p) { <span class="field-error">{{ p }}</span> }
          </label>
          @if (error) {
            <p class="form-error" role="alert">{{ error }}</p>
          }
          <div class="modal-actions">
            <button type="button" class="secondary" [disabled]="busy" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="primary" [disabled]="busy">
              @if (busy) { <span class="spinner" aria-hidden="true"></span> }
              Rename
            </button>
          </div>
        </form>
      } @else {
        <form novalidate (ngSubmit)="save()">
          <p class="modal-lede">
            Saves the <strong>top {{ draft.ids.length }}</strong>{{ cappedNote }} in the order they’re in now, with the
            <strong>{{ draft.columns.length }} stat {{ draft.columns.length === 1 ? 'column' : 'columns' }}</strong> showing, frozen as they are today.
          </p>
          <ol class="save-preview" aria-label="The list's top five">
            @for (id of draft.ids.slice(0, 5); track id; let i = $index) {
              <li>
                <span class="p-rank">{{ i + 1 }}</span>
                @if (logo(id); as src) { <img [src]="src" alt="" /> }
                <span class="p-name">{{ draft.snapshot[id].name }}</span>
              </li>
            }
            @if (draft.ids.length > 5) {
              <li class="p-more">and {{ draft.ids.length - 5 }} more</li>
            }
          </ol>
          <label class="field">
            <span class="field-label">Title <span class="count" [class.over]="title.length > titleMax">{{ title.length }}/{{ titleMax }}</span></span>
            <input name="title" type="text" [maxlength]="titleMax + 20" [(ngModel)]="title" [attr.aria-invalid]="!!(touched && titleError)" />
            @if (touched && titleError; as p) { <span class="field-error">{{ p }}</span> }
          </label>
          <label class="field">
            <span class="field-label">Note <span class="count" [class.over]="note.length > noteMax">{{ note.length }}/{{ noteMax }}</span></span>
            <textarea name="note" rows="3" [(ngModel)]="note" placeholder="Why this order? (optional)" [attr.aria-invalid]="!!noteError"></textarea>
            @if (noteError; as p) { <span class="field-error">{{ p }}</span> }
          </label>
          <div class="vis-row">
            <span class="field-label" id="save-vis">Who can see it</span>
            <visibility-pills sport labelledby="save-vis" [value]="visibility" (picked)="visibility = $event"></visibility-pills>
            <span class="field-hint">{{ hints[visibility] }}</span>
          </div>
          @if (error) {
            <p class="form-error" role="alert">{{ error }}</p>
          }
          <div class="modal-actions">
            <button type="button" class="secondary" [disabled]="busy" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="primary" [disabled]="busy || !draft.ids.length">
              @if (busy) { <span class="spinner" aria-hidden="true"></span> }
              Save list
            </button>
          </div>
        </form>
      }
    </list-modal>
  `,
  standalone: false,
})
export class SaveListDialogComponent implements OnInit {
  readonly account = inject(AccountService);
  private readonly store = inject(ListsStore);

  // (the grid as it is now; none when renaming)
  @Input() draft!: ListDraft;
  // (the rows the grid had, when there were more than a list keeps)
  @Input() listed = 0;
  @Input() suggestedTitle = '';
  // (a saved list to rename instead: the toast's Rename)
  @Input() renameId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  // (saved or renamed: the list's id and title; the dialog's host closes it)
  @Output() saved = new EventEmitter<{ id: string; title: string }>();

  readonly titleMax = TITLE_MAX;
  readonly noteMax = NOTE_MAX;
  readonly hints = VISIBILITY_HINTS;

  title = '';
  note = '';
  visibility: Visibility = 'public';
  touched = false;
  busy = false;
  error = '';

  ngOnInit(): void {
    this.title = this.suggestedTitle;
    this.visibility = this.account.profile()?.visibility?.lists ?? 'public';
    void this.account.start().catch(() => undefined);
  }

  get cappedNote(): string {
    return this.listed > this.draft.ids.length ? ` (of ${this.listed})` : '';
  }

  get titleError(): string | null {
    return titleProblem(this.title);
  }

  get noteError(): string | null {
    return noteProblem(this.note);
  }

  logo(id: string): string | null {
    return logoUrl(SPORT.id, this.draft.snapshot[id]?.teamLogo);
  }

  async save(): Promise<void> {
    this.touched = true;
    if (this.busy || this.titleError) return;
    if (!this.renameId && (this.noteError || !this.draft?.ids.length)) return;
    this.busy = true;
    this.error = '';
    try {
      const title = this.title.trim();
      let id = this.renameId;
      if (id) await this.store.update(id, { title });
      else id = await this.store.create(this.draft, this.title, this.note, this.visibility);
      this.busy = false;
      this.saved.emit({ id, title });
    } catch (error) {
      console.error('Save list', error);
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }
}
