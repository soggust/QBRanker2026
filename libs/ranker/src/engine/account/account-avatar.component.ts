import { Component, Input } from '@angular/core';
import { Photo, initials } from './account-helpers';

// A user's picture in a circle: their provider's photo or an upload, a team logo (on a dark disc, all of
// it showing), or their initials when there's none (or it won't load)
@Component({
  selector: 'account-avatar',
  template: `
    @if (photo && !broken) {
      <img [src]="photo.url" alt="" [class.logo]="photo.kind === 'logo'" referrerpolicy="no-referrer" (error)="broken = true" />
    } @else {
      <span class="initials" aria-hidden="true">{{ letters }}</span>
    }
  `,
  styleUrls: ['../../styles/components/account-avatar.scss'],
  host: { '[style.--size]': "size + 'px'", '[class.has-logo]': "photo?.kind === 'logo' && !broken" },
  standalone: false,
})
export class AccountAvatarComponent {
  private current: Photo | null = null;
  @Input() set photo(photo: Photo | null | undefined) {
    if (photo?.url !== this.current?.url) this.broken = false;
    this.current = photo ?? null;
  }
  get photo(): Photo | null {
    return this.current;
  }
  @Input() name = '';
  @Input() size = 28;

  broken = false;

  get letters(): string {
    return initials(this.name);
  }
}
