import { Component, Input } from '@angular/core';
import { AccountService } from '../account.service';
import { errorMessage } from '../account-helpers';
import { FriendsService } from './friends.service';
import { Relation, relationOf } from './friends-helpers';

// What the viewer can do about someone, wherever they show (the Friends page's rows, a profile's hero):
// Add friend; Requested (and Cancel); Accept or Decline; Friends (and Remove, asked twice). Yourself: a
// You tag. Signed out, Add friend opens the sign-in.
@Component({
  selector: 'friend-button',
  template: `
    @switch (relation) {
      @case ('self') {
        <span class="state-tag">You</span>
      }
      @case ('none') {
        <button type="button" class="primary small-btn" [disabled]="busy" (click)="act('request')" [attr.aria-label]="'Add ' + name + ' as a friend'">
          @if (busy) { <span class="spinner tiny" aria-hidden="true"></span> } @else { <mat-icon aria-hidden="true" fontIcon="person_add"></mat-icon> }
          Add friend
        </button>
      }
      @case ('pending-out') {
        <span class="state-tag"><mat-icon aria-hidden="true" fontIcon="schedule_send"></mat-icon>Requested</span>
        <button type="button" class="link" [disabled]="busy" (click)="act('remove')" [attr.aria-label]="'Cancel your request to ' + name">Cancel</button>
      }
      @case ('pending-in') {
        <button type="button" class="primary small-btn" [disabled]="busy" (click)="act('accept')" [attr.aria-label]="'Accept ' + name + '’s request'">
          @if (busy) { <span class="spinner tiny" aria-hidden="true"></span> } @else { <mat-icon aria-hidden="true" fontIcon="how_to_reg"></mat-icon> }
          Accept
        </button>
        <button type="button" class="secondary small-btn" [disabled]="busy" (click)="act('remove')" [attr.aria-label]="'Decline ' + name + '’s request'">Decline</button>
      }
      @case ('friends') {
        @if (confirming) {
          <span class="confirm-text">Remove {{ short }}?</span>
          <button type="button" class="danger small-btn" [disabled]="busy" (click)="act('remove')">
            @if (busy) { <span class="spinner tiny" aria-hidden="true"></span> }
            Remove
          </button>
          <button type="button" class="link" [disabled]="busy" (click)="confirming = false">Keep</button>
        } @else {
          <span class="state-tag friends"><mat-icon aria-hidden="true" fontIcon="check"></mat-icon>Friends</span>
          <button type="button" class="link quiet" (click)="confirming = true" [attr.aria-label]="'Remove ' + name + ' from your friends'">Remove</button>
        }
      }
    }
    @if (error) {
      <span class="field-error" role="alert">{{ error }}</span>
    }
  `,
  styleUrls: ['../../../styles/components/account-friend-button.scss'],
  standalone: false,
})
export class FriendButtonComponent {
  @Input({ required: true }) uid = '';
  @Input() name = '';

  confirming = false;
  error = '';

  constructor(
    readonly account: AccountService,
    readonly friends: FriendsService,
  ) {}

  get relation(): Relation {
    return relationOf(this.account.user()?.uid, this.uid, this.friends.statusOf(this.uid));
  }

  get busy(): boolean {
    return this.friends.busy() === this.uid;
  }

  get short(): string {
    return this.name.trim().split(/\s+/)[0] || 'them';
  }

  async act(action: 'request' | 'accept' | 'remove'): Promise<void> {
    if (!this.account.signedIn()) {
      this.account.openLogin();
      return;
    }
    this.error = '';
    try {
      await this.friends[action](this.uid);
      this.confirming = false;
    } catch (error) {
      console.error('Friends', error);
      this.error = errorMessage(error);
    }
  }
}
