import { AccountAvatarComponent } from './account-avatar.component';
import { AccountMenuComponent } from './account-menu.component';
import { AccountPageComponent } from './account-page.component';
import { ComingSoonComponent } from './coming-soon.component';
import { LoginDialogComponent } from './login-dialog.component';
import { VisibilityPillsComponent } from './visibility-pills.component';
import { FriendButtonComponent } from './friends/friend-button.component';
import { FriendsBadgeComponent } from './friends/friends-badge.component';
import { FriendsPageComponent } from './friends/friends-page.component';
import { UserProfileComponent } from './profile/user-profile.component';
import { LISTS_COMPONENTS } from './lists/lists-components';
import { TrackerPageComponent } from './tracker/tracker-page.component';
import { WALLET_COMPONENTS } from './wallet/wallet-components';
import { LegalPageComponent } from './legal/legal-page.component';
import { VerifyBannerComponent } from './verify-banner.component';

// The account module's components, declared in app.module.ts: the sign-in, the menu and the settings; the
// shared pieces (the avatar, who-sees-it pills, Coming soon); friends and profiles; presets, lists and the
// Community; the Tracker; the wallet; the Privacy and Data deletion pages; the confirm-your-email strip
export const ACCOUNT_COMPONENTS = [
  AccountAvatarComponent,
  AccountMenuComponent,
  AccountPageComponent,
  ComingSoonComponent,
  LoginDialogComponent,
  VisibilityPillsComponent,
  FriendButtonComponent,
  FriendsBadgeComponent,
  FriendsPageComponent,
  UserProfileComponent,
  ...LISTS_COMPONENTS,
  TrackerPageComponent,
  ...WALLET_COMPONENTS,
  LegalPageComponent,
  VerifyBannerComponent,
];
