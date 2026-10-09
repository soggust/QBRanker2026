import { db } from '@ranker/core/firebase';
import { BetLike, millis } from '../friends/friends-helpers';

// What a public profile shows of someone's saved things, read straight from their subcollections (the
// rules let through only what the owner's visibility allows the viewer; the page asks only for those)

export interface ListSummary {
  id: string;
  title: string;
  sport: string;
  tab: string;
  season: string;
  count: number;
  updated: number;
}

export interface PresetSummary {
  id: string;
  name: string;
  sport: string;
  tab: string;
  updated: number;
}

export interface PinSummary {
  id: string;
  title: string;
  sport: string;
}

export interface BetSummary extends BetLike {
  id: string;
  sport: string;
  matchup: string;
  pick: string;
  odds: number | null;
  stake: number;
  profit: number | null;
  start: number;
  placed: number;
  settled: number;
  botPick: boolean;
}

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : value == null ? fallback : String(value));
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// (a subcollection's docs, the owner's or shared with this viewer: presets and pins by the owner's setting
// for the kind (the page asks only when it lets this viewer see them); lists each by their own visibility,
// so someone else asks only for the ones they may see, as the rules require)
async function read(uid: string, name: 'lists' | 'presets' | 'pins', owner: boolean, friend: boolean) {
  const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
  const ref = f.collection(firestore, 'users', uid, name);
  if (owner || name !== 'lists') return (await f.getDocs(ref)).docs;
  const shown = friend ? ['public', 'friends'] : ['public'];
  return (await f.getDocs(f.query(ref, f.where('visibility', 'in', shown)))).docs;
}

export async function loadLists(uid: string, owner: boolean, friend: boolean): Promise<ListSummary[]> {
  const docs = await read(uid, 'lists', owner, friend);
  return docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        title: text(x['title'], 'Untitled list'),
        sport: text(x['sport']),
        tab: text(x['tab']),
        season: text(x['season']),
        count: Array.isArray(x['ids']) ? x['ids'].length : 0,
        updated: millis(x['updatedAt'] ?? x['createdAt']),
      };
    })
    .sort((a, b) => b.updated - a.updated);
}

export async function loadPresets(uid: string, owner: boolean, friend: boolean): Promise<PresetSummary[]> {
  const docs = await read(uid, 'presets', owner, friend);
  return docs
    .map((d) => {
      const x = d.data();
      return { id: d.id, name: text(x['name'], 'Untitled preset'), sport: text(x['sport']), tab: text(x['tab']), updated: millis(x['updatedAt'] ?? x['createdAt']) };
    })
    .sort((a, b) => b.updated - a.updated);
}

export async function loadPins(uid: string, owner: boolean, friend: boolean): Promise<PinSummary[]> {
  const docs = await read(uid, 'pins', owner, friend);
  return docs
    .map((d) => ({ id: d.id, title: text(d.data()['title'], 'A comparison'), sport: text(d.data()['sport']), at: millis(d.data()['createdAt']) }))
    .sort((a, b) => b.at - a.at)
    .map(({ at: _, ...pin }) => pin);
}

function bet(d: { id: string; data: () => Record<string, unknown> }): BetSummary {
  const x = d.data();
  return {
    id: d.id,
    status: text(x['status'], 'open'),
    sport: text(x['sport']),
    matchup: text(x['matchup']),
    pick: text(x['pick']),
    odds: num(x['odds']),
    stake: num(x['stake']) ?? 0,
    profit: num(x['profit']),
    start: millis(x['start']),
    placed: millis(x['placedAt']),
    settled: millis(x['settledAt']),
    botPick: x['botPick'] === true,
  };
}

// (bets still in play: open; or settled ones, newest first)
export async function loadBets(uid: string, which: 'open' | 'settled'): Promise<BetSummary[]> {
  const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
  const ref = f.collection(firestore, 'users', uid, 'bets');
  const statuses = which === 'open' ? ['open'] : ['won', 'lost', 'push', 'void'];
  const snap = await f.getDocs(f.query(ref, f.where('status', 'in', statuses)));
  const bets = snap.docs.map(bet);
  return which === 'open' ? bets.sort((a, b) => a.start - b.start) : bets.sort((a, b) => b.settled - a.settled || b.placed - a.placed);
}

// (the play-money bankroll: null when there's none yet)
export async function loadBalance(uid: string): Promise<number | null> {
  const [firestore, { doc, getDoc }] = await Promise.all([db(), import('firebase/firestore')]);
  const snap = await getDoc(doc(firestore, 'users', uid, 'wallet', 'main'));
  return snap.exists() ? num(snap.data()['balance']) : null;
}
