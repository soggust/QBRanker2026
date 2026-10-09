import { AccountAvatarComponent } from './account-avatar.component';
import { AccountMenuComponent } from './account-menu.component';
import { AccountPageComponent } from './account-page.component';
import { ComingSoonComponent } from './coming-soon.component';
import { LoginDialogComponent } from './login-dialog.component';
import { PageHeadComponent } from './page-head.component';
import { VisibilityPillsComponent } from './visibility-pills.component';
import { FriendButtonComponent } from './friends/friend-button.component';
import { FriendsBadgeComponent } from './friends/friends-badge.component';
import { FriendsPageComponent } from './friends/friends-page.component';
import { UserProfileComponent } from './profile/user-profile.component';
import { LISTS_COMPONENTS } from './lists/lists-components';
import { TrackerPageComponent } from './tracker/tracker-page.component';
import { WALLET_COMPONENTS } from './wallet/wallet-components';

// The account module's components, declared in app.module.ts: the sign-in, the menu and the settings; the
// shared pieces (the avatar, a page's title strip, who-sees-it pills, Coming soon); friends and profiles; presets, lists and the
// Community; the Tracker; the wallet
export const ACCOUNT_COMPONENTS = [
  AccountAvatarComponent,
  AccountMenuComponent,
  AccountPageComponent,
  ComingSoonComponent,
  LoginDialogComponent,
  PageHeadComponent,
  VisibilityPillsComponent,
  FriendButtonComponent,
  FriendsBadgeComponent,
  FriendsPageComponent,
  UserProfileComponent,
  ...LISTS_COMPONENTS,
  TrackerPageComponent,
  ...WALLET_COMPONENTS,
];
