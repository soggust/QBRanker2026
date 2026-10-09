import { Component, OnDestroy, effect } from '@angular/core';
import { SPORT } from '@sport/sport';
import { DATA } from '@ranker/engine/data';
import { logoFile } from '@ranker/engine/row-fields';
import { canUse } from './features';
import { AccountService, SocialProvider } from './account.service';
import {
  AVATAR_QUALITIES,
  AVATAR_STEPS,
  BIO_MAX,
  DISPLAY_NAME_MAX,
  Photo,
  USERNAME_MAX,
  VISIBILITY_KINDS,
  Visibility,
  VisibilityKind,
  avatarCrop,
  bioProblem,
  cleanUsername,
  displayNameProblem,
  errorMessage,
  fitsAvatar,
  passwordProblem,
  quietError,
  usernameKey,
  usernameProblem,
} from './account-helpers';

type UsernameState = 'same' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

const PROVIDER_NAMES: Record<string, string> = { 'google.com': 'Google', 'facebook.com': 'Facebook', password: 'Email & password' };

// A picture file, the middle square of it scaled to 160px at most, as a small webp (jpeg where the browser
// can't write webp) data URL under 40 KB: the quality stepped down, then the size, until it fits
export async function resizeAvatar(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    const { sx, sy, side, out } = avatarCrop(bitmap.width, bitmap.height);
    for (const step of [out, ...AVATAR_STEPS.filter((s) => s < out)]) {
      canvas.width = canvas.height = step;
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, step, step);
      context.drawImage(bitmap, sx, sy, side, side, 0, 0, step, step);
      for (const quality of AVATAR_QUALITIES) {
        let url = canvas.toDataURL('image/webp', quality);
        if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
        if (fitsAvatar(url)) return url;
      }
    }
    throw Object.assign(new Error('too big'), { code: 'avatar-too-big' });
  } finally {
    bitmap.close();
  }
}

// The settings page (#account): the profile (name, username, bio, picture), who sees what, and the account
// itself (email, sign-in methods, password, sign out, delete). Signed out, a prompt to sign in.
@Component({
  selector: 'account-page',
  templateUrl: './account-page.component.html',
  styleUrls: ['../../styles/components/account-page.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class AccountPageComponent implements OnDestroy {
  // (the bets' rows only where play betting is open: development, or an admin)
  get visibilityKinds() {
    return canUse('bets') ? VISIBILITY_KINDS : VISIBILITY_KINDS.filter((k) => k.kind !== 'openBets' && k.kind !== 'betHistory');
  }
  readonly displayNameMax = DISPLAY_NAME_MAX;
  readonly usernameMax = USERNAME_MAX;
  readonly bioMax = BIO_MAX;
  readonly sportId = SPORT.id;

  // The profile form (filled from the profile, and again whenever it changes while nothing's been edited)
  displayName = '';
  username = '';
  bio = '';
  private loadedFor: string | null = null;
  usernameState: UsernameState = 'same';
  private usernameTimer: ReturnType<typeof setTimeout> | undefined;
  saving = false;
  profileMessage = '';
  profileError = '';

  // The picture
  photoBusy = false;
  photoError = '';
  logosOpen = false;

  // Privacy (the setting being saved, and the last one saved, for its tick)
  visibilitySaving: VisibilityKind | null = null;
  visibilitySaved: VisibilityKind | null = null;
  privacyError = '';

  // The account
  currentPassword = '';
  newPassword = '';
  passwordBusy = false;
  passwordMessage = '';
  passwordError = '';
  passwordOpen = false;
  linkBusy: SocialProvider | null = null;
  accountError = '';
  deleteOpen = false;
  deleteConfirm = '';
  deletePassword = '';
  deleteBusy = false;
  deleteError = '';

  constructor(readonly account: AccountService) {
    // (the page needs the sign-in known: load it if nothing has)
    void account.start().catch(() => undefined);
    effect(() => {
      const user = this.account.user();
      const profile = user?.profile;
      if (!profile) return;
      if (this.loadedFor !== user.uid || !this.profileDirty) {
        this.loadedFor = user.uid;
        this.displayName = profile.displayName;
        this.username = profile.username;
        this.bio = profile.bio ?? '';
        this.usernameState = 'same';
      }
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.usernameTimer);
  }

  get profile() {
    return this.account.profile();
  }

  get user() {
    return this.account.user();
  }

  // ---------------------------------------------------------------------------
  // The profile
  // ---------------------------------------------------------------------------
  get profileDirty(): boolean {
    const p = this.account.profile();
    if (!p) return false;
    return this.displayName.trim() !== p.displayName || cleanUsername(this.username) !== p.username || this.bio.trim() !== (p.bio ?? '');
  }

  get displayNameError(): string | null {
    return displayNameProblem(this.displayName);
  }

  get bioError(): string | null {
    return bioProblem(this.bio);
  }

  get usernameError(): string | null {
    if (this.usernameState === 'same') return null;
    return usernameProblem(this.username) ?? (this.usernameState === 'taken' ? 'That username is taken.' : null);
  }

  get canSave(): boolean {
    return (
      this.profileDirty &&
      !this.saving &&
      !this.displayNameError &&
      !this.bioError &&
      !usernameProblem(this.username) &&
      (this.usernameState === 'same' || this.usernameState === 'available')
    );
  }

  // (a username typed: checked against the claims a moment after the typing stops)
  usernameChanged(): void {
    this.profileMessage = '';
    clearTimeout(this.usernameTimer);
    const typed = cleanUsername(this.username);
    const mine = this.account.profile()?.usernameLower;
    if (usernameKey(typed) === mine) {
      this.usernameState = 'same';
      return;
    }
    if (usernameProblem(typed)) {
      this.usernameState = 'invalid';
      return;
    }
    this.usernameState = 'checking';
    this.usernameTimer = setTimeout(async () => {
      try {
        const free = await this.account.usernameAvailable(typed);
        if (cleanUsername(this.username) === typed) this.usernameState = free ? 'available' : 'taken';
      } catch {
        this.usernameState = 'error';
      }
    }, 400);
  }

  async saveProfile(): Promise<void> {
    const p = this.account.profile();
    if (!p || !this.canSave) return;
    this.saving = true;
    this.profileError = '';
    this.profileMessage = '';
    try {
      if (cleanUsername(this.username) !== p.username) await this.account.changeUsername(this.username);
      const displayName = this.displayName.trim();
      const bio = this.bio.trim();
      if (displayName !== p.displayName || bio !== (p.bio ?? '')) await this.account.updateProfile({ displayName, bio });
      this.usernameState = 'same';
      this.profileMessage = 'Saved';
    } catch (error) {
      if ((error as { code?: string }).code === 'username-taken') this.usernameState = 'taken';
      this.profileError = errorMessage(error);
    } finally {
      this.saving = false;
    }
  }

  resetProfile(): void {
    const p = this.account.profile();
    if (!p) return;
    this.displayName = p.displayName;
    this.username = p.username;
    this.bio = p.bio ?? '';
    this.usernameState = 'same';
    this.profileError = '';
  }

  // ---------------------------------------------------------------------------
  // The picture
  // ---------------------------------------------------------------------------
  // The current sport's teams' logos, to pick one as the picture (MMA's fighters have flags: none)
  get logos(): { url: string; label: string }[] {
    if (this.cachedLogos) return this.cachedLogos;
    const seen = new Map<string, string>();
    const tabs = (DATA.skillPlayers ?? {}) as Record<string, { teamLogo?: string }[]>;
    for (const rows of Object.values(tabs)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const logo = row?.teamLogo;
        if (!logo || /^https?:/.test(logo) || seen.has(logo)) continue;
        seen.set(logo, logoFile(logo) ?? logo);
      }
    }
    this.cachedLogos = [...seen]
      .map(([logo, label]) => ({ url: `/${SPORT.id}/${logo}`, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return this.cachedLogos;
  }
  private cachedLogos: { url: string; label: string }[] | null = null;

  private async setPhoto(photo: Photo | null): Promise<void> {
    this.photoBusy = true;
    this.photoError = '';
    try {
      await this.account.updateProfile({ photo });
    } catch (error) {
      this.photoError = errorMessage(error);
    } finally {
      this.photoBusy = false;
    }
  }

  useProviderPhoto(): void {
    const url = this.account.user()?.providerPhoto;
    if (url) void this.setPhoto({ kind: 'provider', url });
  }

  pickLogo(url: string): void {
    this.logosOpen = false;
    void this.setPhoto({ kind: 'logo', url });
  }

  removePhoto(): void {
    void this.setPhoto(null);
  }

  async upload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoError = '';
    if (!file.type.startsWith('image/')) {
      this.photoError = 'Pick an image file (PNG, JPEG, WebP or GIF).';
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.photoError = 'That picture is too big (15 MB at most).';
      return;
    }
    this.photoBusy = true;
    try {
      const url = await resizeAvatar(file);
      await this.setPhoto({ kind: 'upload', url });
    } catch (error) {
      this.photoError = (error as { code?: string }).code ? errorMessage(error) : 'Couldn’t read that picture. Try another.';
      this.photoBusy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Privacy
  // ---------------------------------------------------------------------------
  visibility(kind: VisibilityKind): Visibility {
    return this.account.profile()?.visibility?.[kind] ?? 'private';
  }

  async setVisibility(kind: VisibilityKind, value: Visibility): Promise<void> {
    if (this.visibility(kind) === value || this.visibilitySaving) return;
    this.visibilitySaving = kind;
    this.visibilitySaved = null;
    this.privacyError = '';
    try {
      await this.account.setVisibility(kind, value);
      this.visibilitySaved = kind;
    } catch (error) {
      this.privacyError = errorMessage(error);
    } finally {
      this.visibilitySaving = null;
    }
  }

  // ---------------------------------------------------------------------------
  // The account
  // ---------------------------------------------------------------------------
  get providers(): { id: string; name: string; linked: boolean }[] {
    const linked = this.account.user()?.providers ?? [];
    return ['google.com', 'facebook.com', 'password']
      .filter((id) => id !== 'password' || linked.includes('password'))
      .map((id) => ({ id, name: PROVIDER_NAMES[id], linked: linked.includes(id) }));
  }

  get hasPassword(): boolean {
    return !!this.account.user()?.providers.includes('password');
  }

  get newPasswordError(): string | null {
    return this.newPassword ? passwordProblem(this.newPassword) : null;
  }

  async link(id: string): Promise<void> {
    if (this.linkBusy || (id !== 'google.com' && id !== 'facebook.com')) return;
    this.linkBusy = id;
    this.accountError = '';
    try {
      await this.account.link(id);
    } catch (error) {
      if (!quietError(error)) this.accountError = errorMessage(error);
    } finally {
      this.linkBusy = null;
    }
  }

  async changePassword(): Promise<void> {
    if (this.passwordBusy || !this.currentPassword || passwordProblem(this.newPassword)) return;
    this.passwordBusy = true;
    this.passwordError = '';
    this.passwordMessage = '';
    try {
      await this.account.changePassword(this.currentPassword, this.newPassword);
      this.currentPassword = this.newPassword = '';
      this.passwordMessage = 'Password changed.';
      this.passwordOpen = false;
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.passwordError =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Your current password isn’t right.' : errorMessage(error);
    } finally {
      this.passwordBusy = false;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.account.signOut();
    } catch (error) {
      this.accountError = errorMessage(error);
    }
  }

  get deleteReady(): boolean {
    const name = this.account.profile()?.username ?? '';
    return (
      !this.deleteBusy &&
      usernameKey(this.deleteConfirm) === name.toLowerCase() &&
      (!this.hasPassword || this.deletePassword.length > 0)
    );
  }

  async deleteAccount(): Promise<void> {
    if (!this.deleteReady) return;
    this.deleteBusy = true;
    this.deleteError = '';
    try {
      await this.account.deleteAccount(this.hasPassword ? this.deletePassword : undefined);
      history.pushState(null, '', location.pathname + location.search);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.deleteError =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'That password isn’t right.' : errorMessage(error);
    } finally {
      this.deleteBusy = false;
    }
  }
}
