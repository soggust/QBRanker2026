import { Component, HostListener, inject } from '@angular/core';
import { AccountService } from './account.service';
import { errorMessage } from './account-helpers';

// An email-and-password account not yet confirmed: a strip over the account pages saying where the link went,
// a way to have it sent again, and a check once it's been clicked (made too when the tab comes back into view,
// the usual moment: the link opens in another tab). Until then the Community, votes and friend requests wait
// (firestore.rules' verified()); everything private works.
@Component({
  selector: 'verify-banner',
  template: `
    @let user = account.user();
    @if (user && !user.verified) {
      <div class="verify" role="status">
        <span class="verify-text">
          <b>Confirm your email</b> to post to the Community, vote and add friends: we sent a link to
          {{ user.email }}.
        </span>
        <span class="verify-actions">
          <button type="button" class="app-btn-outline app-btn-small" [disabled]="busy" (click)="resend()">Send it again</button>
          <button type="button" class="app-btn-primary app-btn-small" [disabled]="busy" (click)="check()">I've confirmed it</button>
        </span>
        @if (note) {
          <span class="verify-note">{{ note }}</span>
        }
      </div>
    }
  `,
  styles: `
    .verify {
      align-items: center;
      background: color-mix(in srgb, var(--app-sand, #d8b98a) 12%, rgba(0, 0, 0, 0.3));
      border: 1px solid color-mix(in srgb, var(--app-sand, #d8b98a) 45%, transparent);
      border-radius: 10px;
      color: var(--app-text, #f1ece6);
      display: flex;
      flex-wrap: wrap;
      font-family: 'Nunito', sans-serif;
      font-size: 13.5px;
      gap: 8px 14px;
      justify-content: space-between;
      margin: 0 0 16px;
      padding: 10px 14px;
    }

    .verify-text {
      flex: 1 1 260px;
      line-height: 1.45;
    }

    .verify-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .verify-note {
      color: var(--app-text-muted, #b8ada1);
      flex-basis: 100%;
      font-size: 12.5px;
    }
  `,
  standalone: false,
})
export class VerifyBannerComponent {
  readonly account = inject(AccountService);
  busy = false;
  note = '';

  async resend(): Promise<void> {
    this.busy = true;
    try {
      await this.account.sendVerification();
      this.note = 'Sent. It can take a minute; check your spam folder too.';
    } catch (error) {
      this.note = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  async check(): Promise<void> {
    this.busy = true;
    try {
      this.note = (await this.account.refreshVerified()) ? '' : 'Not yet: click the link in the email, then try again.';
    } catch (error) {
      this.note = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  // (back from the email's tab: checked quietly)
  @HostListener('window:focus')
  onFocus(): void {
    const user = this.account.user();
    if (user && !user.verified && !this.busy) void this.account.refreshVerified().catch(() => undefined);
  }
}
