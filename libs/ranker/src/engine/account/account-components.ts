import { AccountAvatarComponent } from './account-avatar.component';
import { AccountMenuComponent } from './account-menu.component';
import { AccountPageComponent } from './account-page.component';
import { ComingSoonComponent } from './coming-soon.component';
import { LoginDialogComponent } from './login-dialog.component';
// ---- friends (phase 2) ----
import { FriendButtonComponent } from './friends/friend-button.component';
import { FriendsBadgeComponent } from './friends/friends-badge.component';
import { FriendsPageComponent } from './friends/friends-page.component';
import { UserProfileComponent } from './profile/user-profile.component';
// ---- end friends ----

// The account module's components, declared in app.module.ts (later phases add their pages here)
export const ACCOUNT_COMPONENTS = [
  AccountAvatarComponent,
  AccountMenuComponent,
  AccountPageComponent,
  ComingSoonComponent,
  LoginDialogComponent,
  // ---- friends (phase 2) ----
  FriendButtonComponent,
  FriendsBadgeComponent,
  FriendsPageComponent,
  UserProfileComponent,
  // ---- end friends ----
];
