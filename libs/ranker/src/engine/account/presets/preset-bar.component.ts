import { Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { PositionService } from '@ranker/engine/position.service';
import { SkillPosition, SkillWeights, StatGroupId, presetWeights, skillGroups } from '@sport/positions';
import { AccountService } from '../account.service';
import { errorMessage } from '../account-helpers';
import { PRESET_NAME_MAX, PresetSettings, USER_PRESET, UserPreset, presetNameProblem, presetSettings, samePreset } from '../lists/lists-helpers';
import { PresetsStore } from './presets.store';

// (the presets dropdown's actions, beside the presets: Save as preset…, or Sign in to save one)
export const SAVE_PRESET = 'action:save';
export const SIGN_IN_PRESET = 'action:signin';

type Dialog = { mode: 'save' } | { mode: 'rename'; preset: UserPreset } | { mode: 'delete'; preset: UserPreset };

// The filter menu's own presets (signed in): under the presets dropdown, the one picked, its name, and
// Update (to the sliders as they are now, once they've moved), Rename and Delete; and the dialogs that
// name a new one or rename one, and ask before deleting. The dropdown lists them under the built-in
// presets (sidebar.component.html) with Save as preset… after them.
@Component({
  selector: 'preset-bar',
  template: `
    @if (active; as preset) {
      <div class="preset-bar" role="group" [attr.aria-label]="'Your preset ' + preset.name">
        <mat-icon class="preset-mark" aria-hidden="true" fontIcon="tune"></mat-icon>
        <span class="preset-name" [title]="preset.name">{{ preset.name }}</span>
        <button type="button" class="preset-btn" [disabled]="busy" title="Rename this preset" aria-label="Rename this preset" (click)="open({ mode: 'rename', preset })">
          <mat-icon aria-hidden="true" fontIcon="edit"></mat-icon>
        </button>
        <button type="button" class="preset-btn" [disabled]="busy" title="Delete this preset" aria-label="Delete this preset" (click)="open({ mode: 'delete', preset })">
          <mat-icon aria-hidden="true" fontIcon="delete"></mat-icon>
        </button>
        @if (edited) {
          <span class="preset-edit-row">
            <span class="preset-edited" title="The sliders have moved since this preset">Changed</span>
            <button type="button" class="preset-btn lit" [disabled]="busy" title="Save the sliders as they are now to this preset" (click)="update(preset)">
              <mat-icon aria-hidden="true" fontIcon="save"></mat-icon><span>Update preset</span>
            </button>
          </span>
        }
      </div>
      @if (message) {
        <p class="preset-message" role="status">{{ message }}</p>
      }
    }

    @if (dialog; as d) {
      <list-modal [heading]="d.mode === 'save' ? 'Save as preset' : d.mode === 'rename' ? 'Rename preset' : 'Delete preset'" [icon]="d.mode === 'delete' ? 'delete' : 'tune'" [busy]="busy" (closed)="dialog = null">
        @if (d.mode === 'delete') {
          <p class="modal-lede">Delete <strong>{{ d.preset.name }}</strong>? The sliders stay as they are; only the preset goes.</p>
          @if (error) { <p class="form-error" role="alert">{{ error }}</p> }
          <div class="modal-actions">
            <button type="button" class="app-btn-outline" [disabled]="busy" (click)="dialog = null">Cancel</button>
            <button type="button" class="app-btn-danger" [disabled]="busy" (click)="remove(d.preset)">
              @if (busy) { <span class="spinner" aria-hidden="true"></span> }
              Delete
            </button>
          </div>
        } @else {
          <form novalidate (ngSubmit)="submit()">
            @if (d.mode === 'save') {
              <p class="modal-lede">Keeps this tab’s sliders, and the stats and groups switched off, under a name in the presets list (your {{ tabName }} presets, on any device you sign in on).</p>
            }
            <label class="field">
              <span class="field-label">Name <span class="count" [class.over]="name.length > nameMax">{{ name.length }}/{{ nameMax }}</span></span>
              <input name="name" type="text" [maxlength]="nameMax + 10" [(ngModel)]="name" placeholder="e.g. Efficiency first" [attr.aria-invalid]="!!(touched && nameError)" />
              @if (touched && nameError; as p) { <span class="field-error">{{ p }}</span> }
            </label>
            @if (error) { <p class="form-error" role="alert">{{ error }}</p> }
            <div class="modal-actions">
              <button type="button" class="app-btn-outline" [disabled]="busy" (click)="dialog = null">Cancel</button>
              <button type="submit" class="app-btn-primary" [disabled]="busy">
                @if (busy) { <span class="spinner" aria-hidden="true"></span> }
                {{ d.mode === 'save' ? 'Save preset' : 'Rename' }}
              </button>
            </div>
          </form>
        }
      </list-modal>
    }
  `,
  styleUrls: ['../../../styles/components/account-presets.scss'],
  standalone: false,
})
export class PresetBarComponent implements OnChanges {
  private readonly store = inject(PresetsStore);
  private readonly positions = inject(PositionService);
  readonly account = inject(AccountService);

  @Input({ required: true }) position!: SkillPosition;
  @Input() tabName = '';
  // (what the dropdown shows: a built-in preset's key, a user preset's value, custom, or none)
  @Input() selected: string | null = null;
  // A preset put in place (the sidebar's sliders follow), a new one saved (the dropdown shows it), or the
  // one showing deleted
  @Output() applied = new EventEmitter<SkillWeights>();
  @Output() picked = new EventEmitter<string>();
  @Output() cleared = new EventEmitter<void>();

  readonly nameMax = PRESET_NAME_MAX;
  // (each tab's own preset in use: it stays while its sliders are moved, as Edited)
  private activeIds: Partial<Record<string, string>> = {};
  dialog: Dialog | null = null;
  name = '';
  touched = false;
  busy = false;
  error = '';
  message = '';
  private messageTimer?: ReturnType<typeof setTimeout>;

  ngOnChanges(): void {
    const value = this.selected;
    if (value?.startsWith(USER_PRESET)) this.activeIds[this.position] = value.slice(USER_PRESET.length);
    else if (value !== 'custom') delete this.activeIds[this.position];
  }

  get active(): UserPreset | null {
    const id = this.activeIds[this.position];
    const preset = id ? this.store.byId(id) : undefined;
    return preset && preset.tab === this.position ? preset : null;
  }

  // The tab's settings as they are now
  current(): PresetSettings {
    return presetSettings(
      this.position,
      this.positions.getWeights(this.position) as Record<string, number>,
      this.positions.statHiddenState,
      this.positions.skillHiddenGroups(this.position),
    );
  }

  get edited(): boolean {
    const preset = this.active;
    return !!preset && !samePreset(preset.settings, this.current());
  }

  get nameError(): string | null {
    return presetNameProblem(this.name);
  }

  open(dialog: Dialog): void {
    this.dialog = dialog;
    this.name = dialog.mode === 'rename' ? dialog.preset.name : '';
    this.touched = false;
    this.error = '';
  }

  // The dropdown's Save as preset… (signed out: the sign-in)
  saveNew(): void {
    if (!this.account.user()) {
      this.account.openLogin();
      return;
    }
    this.open({ mode: 'save' });
  }

  // A preset picked in the dropdown: its sliders on this tab (anything it doesn't name at its default),
  // its switched-off stats and groups off, everything else on
  apply(id: string): void {
    const preset = this.store.byId(id);
    if (!preset) return;
    const tab = this.position;
    const weights = { ...presetWeights(tab, 'default'), ...(preset.settings.weights as SkillWeights) };
    this.positions.showAllStats(tab);
    for (const key of preset.settings.hidden ?? []) this.positions.setStatHidden(tab, key, true);
    const off = new Set(preset.settings.groups ?? []);
    for (const group of skillGroups(tab)) {
      if (!!this.positions.skillHiddenGroups(tab)[group.id] !== off.has(group.id)) this.positions.setSkillGroupHidden(tab, group.id as StatGroupId, off.has(group.id));
    }
    this.activeIds[tab] = id;
    this.applied.emit(weights);
  }

  async submit(): Promise<void> {
    const d = this.dialog;
    this.touched = true;
    if (!d || d.mode === 'delete' || this.busy || this.nameError) return;
    this.busy = true;
    this.error = '';
    try {
      if (d.mode === 'save') {
        const id = await this.store.create(this.position, this.name, this.current());
        this.activeIds[this.position] = id;
        this.picked.emit(USER_PRESET + id);
        this.say('Preset saved');
      } else {
        await this.store.update(d.preset.id, { name: this.name });
        this.say('Renamed');
      }
      this.dialog = null;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  async update(preset: UserPreset): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.store.update(preset.id, { settings: this.current() });
      this.picked.emit(USER_PRESET + preset.id);
      this.say('Preset updated');
    } catch (error) {
      this.say(errorMessage(error));
    } finally {
      this.busy = false;
    }
  }

  async remove(preset: UserPreset): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await this.store.remove(preset.id);
      delete this.activeIds[preset.tab];
      this.dialog = null;
      this.cleared.emit();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  private say(text: string): void {
    this.message = text;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (this.message = ''), 2200);
  }
}

