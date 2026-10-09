import { Component, Input } from '@angular/core';
import { FriendsService } from './friends.service';

// The account menu's count of friend requests waiting (on its Friends item), or a dot on the avatar (dot);
// nothing when there are none
@Component({
  selector: 'friends-badge',
  template: `
    @if (count) {
      @if (dot) {
        <span class="friends-dot" role="status" [attr.aria-label]="label"></span>
      } @else {
        <b class="friends-count" [attr.aria-label]="label">{{ count > 9 ? '9+' : count }}</b>
      }
    }
  `,
  styleUrls: ['../../../styles/components/account-friend-button.scss'],
  host: { '[class.as-dot]': 'dot' },
  standalone: false,
})
export class FriendsBadgeComponent {
  @Input({ transform: (v: unknown) => v !== false && v !== 'false' }) dot = false;

  constructor(private readonly friends: FriendsService) {}

  get count(): number {
    return this.friends.incomingCount();
  }

  get label(): string {
    return `${this.count} friend request${this.count === 1 ? '' : 's'}`;
  }
}
