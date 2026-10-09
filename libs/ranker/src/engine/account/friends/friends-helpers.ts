// Friends' plain pieces (no Angular, no Firebase): where two users stand, what one may see of the other's
// (the same test as firestore.rules' canSee), the username search's range, a profile's address, and a
// settled-bets record. Tested by tests/friends.test.mjs.
import type { Visibility, VisibilityKind } from '../account-helpers';

// (users/{uid}/friends/{other}.status, as stored on each side)
export type FriendStatus = 'pending-out' | 'pending-in' | 'friends';
// (two users, from the viewer's side: none yet, asked by me, asked by them, friends; or the viewer themself)
export type Relation = 'none' | FriendStatus | 'self';

export function relationOf(viewerUid: string | null | undefined, ownerUid: string, status: FriendStatus | null | undefined): Relation {
  if (viewerUid && viewerUid === ownerUid) return 'self';
  return status ?? 'none';
}

// What a viewer may see of a kind on someone's profile: shown, or hidden because it's for friends or
// private (the owner sees everything; the rules decide for real, this keeps the page from asking)
export type Access = 'shown' | 'friends-only' | 'private';

export function accessOf(setting: Visibility | null | undefined, relation: Relation): Access {
  if (relation === 'self' || setting === 'public') return 'shown';
  if (setting === 'friends') return relation === 'friends' ? 'shown' : 'friends-only';
  return 'private';
}

export function accessAll(
  visibility: Partial<Record<VisibilityKind, Visibility>> | null | undefined,
  relation: Relation,
): Record<VisibilityKind, Access> {
  const kinds: VisibilityKind[] = ['lists', 'presets', 'openBets', 'betHistory', 'tracker'];
  return Object.fromEntries(kinds.map((k) => [k, accessOf(visibility?.[k], relation)])) as Record<VisibilityKind, Access>;
}

// (the words for a hidden section)
export function hiddenNote(access: Access, displayName: string): string {
  const who = displayName.trim() || 'This user';
  return access === 'friends-only' ? `${who} shares this with friends only.` : `${who} keeps this private.`;
}

// ---------------------------------------------------------------------------
// The username search: a prefix of the claim names (usernames/{lower}), as a document-id range
// ---------------------------------------------------------------------------
export const SEARCH_MIN = 2;
export const SEARCH_LIMIT = 12;

// (what's typed, as a claim's prefix: the @ and spaces dropped, lower case; null when it can't match a
// username: too short, or a character no username has)
export function searchPrefix(typed: string): string | null {
  const prefix = typed.trim().replace(/^@+/, '').toLowerCase();
  if (prefix.length < SEARCH_MIN || prefix.length > 20 || !/^[a-z0-9_]+$/.test(prefix)) return null;
  return prefix;
}

// (the ids from the prefix up to everything that starts with it)
export function prefixRange(prefix: string): [string, string] {
  return [prefix, prefix + ''];
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------
export function profileHash(username: string): string {
  return '#u/' + encodeURIComponent(username);
}

// (#u/<username> -> the username, or null)
export function usernameFromHash(hash: string): string | null {
  const match = /^#?u\/(.+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lists in the order shown: friends by name; requests newest first
// ---------------------------------------------------------------------------
export interface FriendRow {
  uid: string;
  status: FriendStatus;
  since: number;
  name: string;
}

export function sortFriends<T extends FriendRow>(rows: T[]): { incoming: T[]; outgoing: T[]; friends: T[] } {
  const byNew = (a: T, b: T) => b.since - a.since;
  return {
    incoming: rows.filter((r) => r.status === 'pending-in').sort(byNew),
    outgoing: rows.filter((r) => r.status === 'pending-out').sort(byNew),
    friends: rows
      .filter((r) => r.status === 'friends')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.uid.localeCompare(b.uid)),
  };
}

// ---------------------------------------------------------------------------
// Bets: a settled record in plain tallies (won-lost-push, profit, ROI on what was staked)
// ---------------------------------------------------------------------------
export interface BetLike {
  status: string;
  stake?: number;
  profit?: number | null;
}

export interface BetRecord {
  won: number;
  lost: number;
  push: number;
  profit: number;
  staked: number;
  roi: number | null;
}

export function betRecord(bets: BetLike[]): BetRecord {
  const record: BetRecord = { won: 0, lost: 0, push: 0, profit: 0, staked: 0, roi: null };
  for (const bet of bets) {
    if (bet.status !== 'won' && bet.status !== 'lost' && bet.status !== 'push') continue;
    record[bet.status]++;
    record.profit += Number(bet.profit) || 0;
    record.staked += Number(bet.stake) || 0;
  }
  record.profit = Math.round(record.profit * 100) / 100;
  record.roi = record.staked > 0 ? Math.round((record.profit / record.staked) * 1000) / 10 : null;
  return record;
}

// (W-L, with pushes when there are any: 12-9-1)
export function recordText(r: BetRecord): string {
  return r.push ? `${r.won}-${r.lost}-${r.push}` : `${r.won}-${r.lost}`;
}

// (play money, in the wallet's units, signed: +120u, -45.50u)
export function money(value: number, signed = false): string {
  const abs = Math.abs(value);
  const text = (Number.isInteger(abs) ? abs.toLocaleString('en-US') : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + 'u';
  if (value < 0) return '-' + text;
  return signed && value > 0 ? '+' + text : text;
}

// (American odds: +150, -110)
export function oddsText(odds: number | null | undefined): string {
  if (odds === null || odds === undefined || !Number.isFinite(odds)) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}

// (a Firestore timestamp, a Date, a number or nothing, as milliseconds)
export function millis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}
