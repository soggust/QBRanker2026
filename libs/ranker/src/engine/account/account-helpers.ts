// The account module's plain pieces (no Angular, no Firebase): usernames, passwords, the profile's
// fields, the friendly words for Firebase's error codes, and the avatar's resize math. Tested by
// tests/accounts.test.mjs; firestore.rules checks the same limits on the server.
import { isOffensive, isReservedUsername } from './name-filter';

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

export type Visibility = 'public' | 'friends' | 'private';
export type VisibilityKind = 'lists' | 'presets' | 'openBets' | 'betHistory' | 'tracker';

// (what each setting covers, in the settings page's order, and who sees it to start)
export const VISIBILITY_KINDS: { kind: VisibilityKind; label: string; hint: string }[] = [
  { kind: 'lists', label: 'Saved lists', hint: 'Where a new list starts (each list has its own, on My lists)' },
  { kind: 'presets', label: 'Presets', hint: 'Your saved filter and weight presets' },
  { kind: 'openBets', label: 'Open bets', hint: 'Play-money bets still in play' },
  { kind: 'betHistory', label: 'Bet history', hint: 'Settled bets and your record' },
  { kind: 'tracker', label: 'Tracker', hint: 'The comparisons you pin' },
];
export const VISIBILITY_CHOICES: { value: Visibility; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'friends', label: 'Friends' },
  { value: 'private', label: 'Only me' },
];
export const DEFAULT_VISIBILITY: Record<VisibilityKind, Visibility> = {
  lists: 'public',
  presets: 'public',
  openBets: 'friends',
  betHistory: 'friends',
  tracker: 'friends',
};

export type PhotoKind = 'provider' | 'upload' | 'logo';
export interface Photo {
  kind: PhotoKind;
  url: string;
}

export interface Profile {
  username: string;
  usernameLower: string;
  displayName: string;
  photo: Photo | null;
  favoriteTeam?: { sport: string; logo: string } | null;
  bio?: string;
  visibility: Record<VisibilityKind, Visibility>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// The limits (firestore.rules checks the same)
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 200;
// (a photo's url or data URL as stored: the rules' cap; an upload aims well under it)
export const PHOTO_MAX = 60 * 1024;
export const AVATAR_BYTES = 40 * 1024;
export const AVATAR_SIDE = 160;
export const PASSWORD_MIN = 8;

// ---------------------------------------------------------------------------
// Usernames: 3 to 20 letters, numbers or underscores, unique whatever their case (the claim is the
// lowercase name: usernames/{lower})
// ---------------------------------------------------------------------------
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

// (as typed: the spaces round it and an @ in front dropped)
export function cleanUsername(typed: string): string {
  return typed.trim().replace(/^@+/, '');
}

export function usernameKey(typed: string): string {
  return cleanUsername(typed).toLowerCase();
}

// What's wrong with a username, or null when it's fine
export function usernameProblem(typed: string): string | null {
  const name = cleanUsername(typed);
  if (!name) return 'Pick a username.';
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(name)) return 'Letters, numbers and underscores only.';
  if (isReservedUsername(name)) return 'That username is reserved.';
  if (isOffensive(name)) return 'Pick a different username.';
  return null;
}

// A username made from someone's name (a new Google or Facebook sign-in), or their email's name when
// that gives too little: "August Gieseman" -> "august_gieseman"; room left for a number on the end
export function usernameFrom(displayName: string | null | undefined, email?: string | null): string {
  const tidy = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, USERNAME_MAX - 4)
      .replace(/_+$/, '');
  for (const source of [displayName, email?.split('@')[0]]) {
    const name = tidy(source ?? '');
    // (not a name the filter turns away: the next source, or "fan")
    if (name.length >= USERNAME_MIN && !isOffensive(name) && !isReservedUsername(name)) return name;
  }
  return 'fan';
}

// The names to try, in order, until one is free: the name itself, then with 2 to 9 on the end, then a
// few random numbers ($random: for tests)
export function usernameCandidates(base: string, random: () => number = Math.random): string[] {
  const names = [base, ...Array.from({ length: 8 }, (_, i) => `${base}${i + 2}`)];
  for (let i = 0; i < 4; i++) names.push(`${base}${1000 + Math.floor(random() * 9000)}`);
  return names.filter((n) => !usernameProblem(n));
}

// ---------------------------------------------------------------------------
// The other fields
// ---------------------------------------------------------------------------
export function displayNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Add a display name.';
  if (trimmed.length > DISPLAY_NAME_MAX) return `At most ${DISPLAY_NAME_MAX} characters.`;
  if (isOffensive(trimmed)) return 'Pick a different display name.';
  return null;
}

export function bioProblem(bio: string): string | null {
  if (bio.trim().length > BIO_MAX) return `At most ${BIO_MAX} characters.`;
  return isOffensive(bio) ? 'Keep it clean: try different words.' : null;
}

// A new password: 8 or more characters, a letter and a number among them
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use at least one letter and one number.';
  return null;
}

export function emailProblem(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.';
}

// (the menu's name: the first word of the display name; initials for an avatar without a picture)
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

// ---------------------------------------------------------------------------
// Firebase's error codes, in plain words
// ---------------------------------------------------------------------------
const ERRORS: Record<string, string> = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-email': 'Enter your email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/invalid-login-credentials': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That email and password don’t match an account.',
  'auth/user-not-found': 'That email and password don’t match an account.',
  'auth/user-disabled': 'This account has been turned off.',
  'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
  'auth/weak-password': 'Pick a stronger password (8+ characters, a letter and a number).',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': 'Couldn’t reach the server. Check your connection.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site.',
  'auth/popup-closed-by-user': 'The sign-in window was closed before it finished.',
  'auth/cancelled-popup-request': 'The sign-in window was closed before it finished.',
  'auth/account-exists-with-different-credential':
    'An account already uses that email with another sign-in method. Use that one.',
  'auth/credential-already-in-use': 'That sign-in is already linked to another account.',
  'auth/requires-recent-login': 'For your security, sign in again and retry.',
  'auth/operation-not-allowed': 'That sign-in method isn’t turned on yet.',
  'auth/unauthorized-domain': 'Sign-in isn’t allowed from this address.',
  'auth/internal-error': 'Something went wrong. Try again.',
  'permission-denied': 'You don’t have permission to do that.',
  unavailable: 'Couldn’t reach the server. Check your connection.',
  'username-taken': 'That username is taken.',
  'avatar-too-big': 'That picture won’t shrink small enough. Try another.',
};

// (what to tell the user for an error: its code's words, or a general line)
export function errorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  return ERRORS[code] ?? ERRORS[code.replace(/^firestore\//, '')] ?? 'Something went wrong. Try again.';
}

// (a closed window or a second click on the same button: nothing to show)
export function quietError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}

// ---------------------------------------------------------------------------
// The avatar upload: the middle square of the picture, scaled down to 160px at most (never up)
// ---------------------------------------------------------------------------
export function avatarCrop(width: number, height: number, max = AVATAR_SIDE): { sx: number; sy: number; side: number; out: number } {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    out: Math.max(1, Math.min(max, Math.round(side))),
  };
}

// The qualities to try, best first, until the data URL fits (then smaller sizes)
export const AVATAR_QUALITIES = [0.85, 0.75, 0.65, 0.5, 0.4];
export const AVATAR_STEPS = [160, 128, 96];

// (a data URL's size as stored: its characters)
export function fitsAvatar(dataUrl: string, max = AVATAR_BYTES): boolean {
  return dataUrl.length <= max;
}
