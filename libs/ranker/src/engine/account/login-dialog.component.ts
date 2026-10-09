import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, effect } from '@angular/core';
import { AccountService, SocialProvider } from './account.service';
import {
  DISPLAY_NAME_MAX,
  USERNAME_MAX,
  displayNameProblem,
  emailProblem,
  errorMessage,
  passwordProblem,
  quietError,
  usernameProblem,
} from './account-helpers';

type Mode = 'signin' | 'register' | 'reset';

// Signing in: a modal over the dimmed page (like About): Continue with Google or Facebook, or an email and
// password, signing in or creating an account (with a username and display name), or a reset link for a
// forgotten password. Escape or the X closes it, Tab stays inside it, and it closes itself once someone's
// signed in. (A new Google or Facebook account gets a username from its name, changeable on the settings
// page: no extra step.)
@Component({
  selector: 'login-dialog',
  templateUrl: './login-dialog.component.html',
  styleUrls: ['../../styles/components/login-dialog.scss'],
  standalone: false,
})
export class LoginDialogComponent implements AfterViewInit, OnDestroy {
  @ViewChild('panel') panel!: ElementRef<HTMLElement>;
  @ViewChild('first') first!: ElementRef<HTMLButtonElement>;

  mode: Mode = 'signin';
  email = '';
  password = '';
  username = '';
  displayName = '';
  showPassword = false;

  // (what's running: a provider's pop-up, the form; everything's disabled meanwhile)
  busy: SocialProvider | 'form' | null = null;
  error = '';
  notice = '';
  // (the fields' problems show once the form's been submitted, or a field's been left)
  touched = new Set<string>();
  submitted = false;

  readonly usernameMax = USERNAME_MAX;
  readonly displayNameMax = DISPLAY_NAME_MAX;

  private readonly opener = document.activeElement as HTMLElement | null;

  constructor(readonly account: AccountService) {
    // (signed in, however it happened: done)
    effect(() => {
      if (this.account.user()) this.account.closeLogin();
    });
  }

  ngAfterViewInit(): void {
    this.first?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.opener?.focus?.({ preventScroll: true });
  }

  get title(): string {
    return this.mode === 'register' ? 'Create account' : this.mode === 'reset' ? 'Reset password' : 'Sign in';
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.error = '';
    this.notice = '';
    this.submitted = false;
    this.touched.clear();
  }

  // Each field's problem (shown once it's been left, or the form submitted)
  problem(field: 'email' | 'password' | 'username' | 'displayName'): string | null {
    if (!this.submitted && !this.touched.has(field)) return null;
    return this.check(field);
  }

  private check(field: 'email' | 'password' | 'username' | 'displayName'): string | null {
    switch (field) {
      case 'email':
        return emailProblem(this.email);
      case 'password':
        if (this.mode === 'register') return passwordProblem(this.password);
        return this.password ? null : 'Enter your password.';
      case 'username':
        return usernameProblem(this.username);
      case 'displayName':
        return displayNameProblem(this.displayName);
    }
  }

  private fields(): ('email' | 'password' | 'username' | 'displayName')[] {
    if (this.mode === 'reset') return ['email'];
    if (this.mode === 'register') return ['displayName', 'username', 'email', 'password'];
    return ['email', 'password'];
  }

  async social(provider: SocialProvider): Promise<void> {
    if (this.busy) return;
    this.busy = provider;
    this.error = '';
    try {
      await this.account.signInWith(provider);
    } catch (error) {
      if (!quietError(error)) this.error = errorMessage(error);
    } finally {
      this.busy = null;
    }
  }

  async submit(): Promise<void> {
    if (this.busy) return;
    this.submitted = true;
    this.error = '';
    this.notice = '';
    if (this.fields().some((f) => this.check(f))) {
      // (the first field that needs fixing)
      const bad = this.fields().find((f) => this.check(f));
      this.panel.nativeElement.querySelector<HTMLInputElement>(`[name="${bad}"]`)?.focus();
      return;
    }
    this.busy = 'form';
    try {
      if (this.mode === 'signin') await this.account.signInWithEmail(this.email, this.password);
      else if (this.mode === 'register') await this.account.register(this.email, this.password, this.username, this.displayName);
      else {
        await this.account.resetPassword(this.email);
        this.notice = `If an account uses ${this.email.trim()}, a reset link is on its way. Check your inbox.`;
      }
    } catch (error) {
      // (a reset for an email with no account says the same as one with: no telling who has one)
      if (this.mode === 'reset' && (error as { code?: string }).code === 'auth/user-not-found') {
        this.notice = `If an account uses ${this.email.trim()}, a reset link is on its way. Check your inbox.`;
      } else this.error = errorMessage(error);
    } finally {
      this.busy = null;
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.account.closeLogin();
  }

  // Tab and Shift+Tab stay inside the dialog
  @HostListener('keydown.tab', ['$event'])
  @HostListener('keydown.shift.tab', ['$event'])
  trap(event: Event): void {
    const items = Array.from(
      this.panel.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const back = (event as KeyboardEvent).shiftKey;
    if (back && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!back && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
