import { isDevMode, signal } from '@angular/core';

// What's switched on, in one place: the features not ready for everyone (MMA, the Bets page, anything
// experimental) show in development (the dev server and dev builds, as before) and for an admin on the
// live site. Admin is a custom claim on the sign-in token (admin: true, set by
// libs/ranker/scripts/accounts/set-admin.mjs with the Admin SDK), never a field a user can write;
// AccountService sets it from the token when someone signs in.
export type Feature = 'mma' | 'bets' | 'experimental';

export const ADMIN = signal(false);

// (a signal read: a template calling it updates when the admin flag arrives)
export function canUse(_feature: Feature): boolean {
  return isDevMode() || ADMIN();
}
