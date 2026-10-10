import { Injectable, computed, effect, signal } from '@angular/core';
import { signedOut } from '../account-helpers';
import type { DocumentData, Firestore, Query, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { firestoreSdk } from '@ranker/core/firebase';
import { AccountService } from '../account.service';
import { Leaderboard, PlayBet, START, Selection, selectionKey, stakeProblem } from './wallet-math';

// (the open bets listened to: far more than anyone holds at once; the settled history a page at a time)
const OPEN_MAX = 200;
const SETTLED_PAGE = 200;
const SETTLED_STATUSES = ['won', 'lost', 'push', 'void'];

// The wallet (users/{uid}/wallet/main): play money, 1,000 units to start
export interface Wallet {
  balance: number;
  start: number;
  // (how many times it's been reloaded to 1,000: the run a bet belongs to)
  resets: number;
  lastBet?: string;
}

// (the settler's lifetime tally of a user's settled bets: tallies/{uid}, kept even when the history's cleared)
export interface LifetimeTally {
  won: number;
  lost: number;
  push: number;
  void: number;
  staked: number;
  profit: number;
}

// A bet that couldn't be placed, and why
export type PlaceResult = { placed: number; failed: { key: string; why: string }[] };

const iso = (v: unknown): string => {
  const t = v as Timestamp | null | undefined;
  if (t && typeof t.toDate === 'function') return t.toDate().toISOString();
  if (typeof v === 'string') return v;
  // (a time the server hasn't filled in yet: a write still on its way)
  return new Date().toISOString();
};

// (a bet document as the page reads it)
export function betFrom(id: string, d: DocumentData): PlayBet {
  return {
    id,
    sport: d['sport'],
    event: d['event'],
    matchup: d['matchup'],
    start: iso(d['start']),
    market: d['market'],
    side: d['side'],
    line: d['line'] ?? null,
    odds: d['odds'],
    stake: d['stake'],
    pick: d['pick'],
    botPick: !!d['botPick'],
    // (a bet placed when the band was called Bet: Like now)
    tier: d['tier'] === 'bet' ? 'like' : (d['tier'] ?? null),
    kelly: d['kelly'] ?? null,
    ref: d['ref'] ?? null,
    propType: d['propType'] ?? null,
    athlete: d['athlete'] ?? null,
    player: d['player'] ?? null,
    statLabel: d['statLabel'] ?? null,
    run: d['run'] ?? 0,
    placedAt: iso(d['placedAt']),
    status: d['status'],
    profit: d['profit'],
    final: d['final'],
    note: d['note'],
    settledAt: d['settledAt'] ? iso(d['settledAt']) : undefined,
  };
}

// The signed-in user's wallet and bets (live, from Firestore), and the bet slip: the Bets page's prices
// added to it, a stake on each, placed together. Each bet is its own write with the wallet's balance taken
// down by its stake in the same batch (firestore.rules binds the two: the wallet's lastBet names the new bet);
// settling is the settler's (libs/ranker/scripts/accounts/settle.mjs, the Admin SDK), never the browser's.
@Injectable({ providedIn: 'root' })
export class WalletService {
  readonly wallet = signal<Wallet | null>(null);
  // (whether the wallet's been looked for yet: none yet means a new player, not one still loading)
  readonly loaded = signal(false);
  // The bets: the open ones live (what the Bets page, the slip and the header need: few, and listened to from
  // every sport's page), the settled history only once a page asks for it (the wallet, Closed Bets), a page at
  // a time, the latest first; together, the latest placed first. (A listener on the whole history read every
  // bet ever placed on every Bets page load.)
  readonly openBets = signal<PlayBet[]>([]);
  readonly settledBets = signal<PlayBet[]>([]);
  // (whether there's any settled history, from one document: the Bets page's Closed Bets tab)
  readonly hasSettled = signal(false);
  // (the history's paging: not asked for yet, loading, more to load, or all of it here)
  readonly settledState = signal<'idle' | 'loading' | 'more' | 'all'>('idle');
  readonly bets = computed(() => [...this.openBets(), ...this.settledBets()].sort((a, b) => b.placedAt.localeCompare(a.placedAt)));
  readonly tally = signal<LifetimeTally | null>(null);
  readonly balance = computed(() => this.wallet()?.balance ?? START);

  // The slip
  readonly slip = signal<Selection[]>([]);
  readonly slipOpen = signal(false);
  readonly slipKeys = computed(() => new Set(this.slip().map((s) => s.key)));
  // (what's already bet and still open, so the same bet isn't placed twice by mistake: the stake on each
  // selection, by its key, and on each of the bot's picks, by the pick's id)
  readonly openStakes = computed(() => {
    const out = new Map<string, number>();
    for (const b of this.openBets()) out.set(selectionKey(b), (out.get(selectionKey(b)) ?? 0) + b.stake);
    return out;
  });
  readonly openOnPick = computed(() => {
    const out = new Map<string, number>();
    for (const b of this.openBets()) if (b.ref) out.set(b.ref, (out.get(b.ref) ?? 0) + b.stake);
    return out;
  });
  // (the last placing's word: how many went on, and any that didn't)
  readonly placed = signal<PlaceResult | null>(null);
  readonly placing = signal(false);

  private stop: (() => void)[] = [];
  private uid: string | null = null;

  constructor(private readonly account: AccountService) {
    // (following whoever's signed in: their wallet and bets, live)
    effect(() => {
      const uid = this.account.user()?.uid ?? null;
      if (uid !== this.uid) void this.follow(uid);
    });
  }

  private async follow(uid: string | null): Promise<void> {
    this.uid = uid;
    for (const s of this.stop) s();
    this.stop = [];
    // (the last placing's note is the last person's; signed out, their slip goes too, while a slip filled
    // before signing in stays for the account)
    this.placed.set(null);
    if (!uid) {
      this.slip.set([]);
      this.slipOpen.set(false);
    }
    this.wallet.set(null);
    this.openBets.set([]);
    this.settledBets.set([]);
    this.settledCursors.clear();
    this.hasSettled.set(false);
    this.settledState.set('idle');
    this.tally.set(null);
    this.loaded.set(false);
    if (!uid) return;
    const [firestore, f] = await firestoreSdk();
    if (this.uid !== uid) return;
    this.stop.push(
      f.onSnapshot(
        f.doc(firestore, 'users', uid, 'wallet', 'main'),
        (snap) => {
          this.wallet.set(snap.exists() ? (snap.data() as Wallet) : null);
          // (a wallet the cache doesn't have isn't one the server hasn't: none yet only once it's said so)
          if (snap.exists() || !snap.metadata.fromCache) this.loaded.set(true);
        },
        (error) => console.error('Wallet', error),
      ),
      f.onSnapshot(
        f.query(f.collection(firestore, 'users', uid, 'bets'), f.where('status', '==', 'open'), f.limit(OPEN_MAX)),
        (snap) => {
          const before = this.openBets();
          this.openBets.set(snap.docs.map((d) => betFrom(d.id, d.data())));
          // (one settled since: there's history now, and the history on show takes it in, its first page again)
          const settled = before.some((b) => !snap.docs.some((d) => d.id === b.id));
          if (settled && !snap.metadata.fromCache) {
            this.hasSettled.set(true);
            if (this.settledState() !== 'idle') void this.loadSettled(true);
          }
        },
        (error) => console.error('Bets', error),
      ),
    );
    // (any history at all: one document)
    f.getDocs(f.query(this.settledQuery(f, firestore, uid), f.limit(1)))
      .then((snap) => this.uid === uid && !snap.empty && this.hasSettled.set(true))
      .catch(() => undefined);
    f.getDoc(f.doc(firestore, 'tallies', uid))
      .then((snap) => this.uid === uid && this.tally.set(snap.exists() ? ((snap.data()['all'] as LifetimeTally) ?? null) : null))
      .catch(() => undefined);
  }

  // The settled history, the latest settled first: its next page (the first, the first time), or with `fresh` its
  // first again, as many as were showing; nothing while a page is loading or once it's all here
  async loadSettled(fresh = false): Promise<void> {
    const uid = this.uid;
    const state = this.settledState();
    if (!uid || state === 'loading' || (!fresh && state === 'all')) return;
    const [firestore, f] = await firestoreSdk();
    if (this.uid !== uid) return;
    const have = fresh ? [] : this.settledBets();
    const size = fresh ? Math.max(SETTLED_PAGE, this.settledBets().length) : SETTLED_PAGE;
    const last = have.length ? this.settledCursors.get(have[have.length - 1].id) : undefined;
    this.settledState.set('loading');
    try {
      const snap = await f.getDocs(f.query(this.settledQuery(f, firestore, uid), ...(last ? [f.startAfter(last)] : []), f.limit(size)));
      if (this.uid !== uid) return;
      if (fresh) this.settledCursors.clear();
      for (const d of snap.docs) this.settledCursors.set(d.id, d);
      const page = snap.docs.map((d) => betFrom(d.id, d.data()));
      this.settledBets.set([...have, ...page]);
      if (page.length) this.hasSettled.set(true);
      this.settledState.set(snap.size < size ? 'all' : 'more');
    } catch (error) {
      console.error('Settled bets', error);
      this.settledState.set(have.length ? 'more' : 'idle');
    }
  }

  // (the settled bets, the latest settled first: firestore.indexes.json has its index)
  private settledQuery(f: typeof import('firebase/firestore'), firestore: Firestore, uid: string): Query {
    return f.query(f.collection(firestore, 'users', uid, 'bets'), f.where('status', 'in', SETTLED_STATUSES), f.orderBy('settledAt', 'desc'));
  }
  // (each loaded settled bet's document, to page on from)
  private readonly settledCursors = new Map<string, QueryDocumentSnapshot>();

  // A new player's wallet: 1,000 units (once; the rules allow nothing else)
  async ensureWallet(): Promise<void> {
    const uid = this.uid;
    if (!uid) throw signedOut();
    // (the listener has it already: no read to find out)
    if (this.wallet()) return;
    const [firestore, f] = await firestoreSdk();
    const ref = f.doc(firestore, 'users', uid, 'wallet', 'main');
    if ((await f.getDoc(ref)).exists()) return;
    await f.setDoc(ref, { balance: START, start: START, resets: 0, createdAt: f.serverTimestamp(), updatedAt: f.serverTimestamp() });
  }

  // ---------------------------------------------------------------------------
  // The slip
  // ---------------------------------------------------------------------------
  // (a price clicked: onto the slip, or off it if it's on; the slip opens)
  toggle(sel: Omit<Selection, 'key' | 'stake'>): void {
    const key = selectionKey(sel);
    if (this.slipKeys().has(key)) {
      this.remove(key);
      return;
    }
    this.placed.set(null);
    this.slip.update((list) => [...list, { ...sel, key, stake: 0 }]);
    this.slipOpen.set(true);
  }

  remove(key: string): void {
    this.slip.update((list) => list.filter((s) => s.key !== key));
  }

  // (in half units, as the chips and the rules have them: a typed 2.7 is 2.5)
  setStake(key: string, stake: number): void {
    this.slip.update((list) => list.map((s) => (s.key === key ? { ...s, stake: Math.max(0, Math.floor(stake * 2) / 2 || 0) } : s)));
  }

  clearSlip(): void {
    this.slip.set([]);
    this.placed.set(null);
  }

  // (a selection's stake problem, the slip's other stakes counted against the balance)
  problem(sel: Selection): string | null {
    const others = this.slip().filter((s) => s.key !== sel.key).reduce((t, s) => t + (s.stake > 0 ? s.stake : 0), 0);
    return stakeProblem(sel.stake, this.balance(), others);
  }

  // Places every bet on the slip with a stake, one at a time (each bet its own batch with the balance's
  // stake out of the wallet); the ones placed come off the slip
  async place(now = Date.now()): Promise<PlaceResult> {
    const uid = this.uid;
    if (!uid) throw signedOut();
    this.placing.set(true);
    const result: PlaceResult = { placed: 0, failed: [] };
    try {
      await this.ensureWallet();
      const [firestore, f] = await firestoreSdk();
      const walletRef = f.doc(firestore, 'users', uid, 'wallet', 'main');
      // (the run the bet belongs to: the wallet's resets, as its listener has it, else read)
      const run = this.wallet()?.resets ?? (await f.getDoc(walletRef)).data()?.['resets'] ?? 0;
      for (const s of this.slip().filter((x) => x.stake > 0)) {
        if (Date.parse(s.start) <= now) {
          result.failed.push({ key: s.key, why: 'The game has started' });
          continue;
        }
        const ref = f.doc(f.collection(firestore, 'users', uid, 'bets'));
        const bet: Record<string, unknown> = {
          sport: s.sport,
          event: s.event,
          matchup: s.matchup,
          start: f.Timestamp.fromDate(new Date(s.start)),
          market: s.market,
          side: s.side,
          line: s.line,
          odds: s.odds,
          stake: s.stake,
          pick: s.pick.slice(0, 80),
          botPick: s.botPick,
          run,
          placedAt: f.serverTimestamp(),
          status: 'open',
        };
        if (s.tier) bet['tier'] = s.tier;
        if (s.kelly !== null && Number.isFinite(s.kelly)) bet['kelly'] = s.kelly;
        if (s.ref) bet['ref'] = s.ref;
        if (s.market === 'prop') Object.assign(bet, { propType: s.propType, athlete: s.athlete, player: s.player, statLabel: s.statLabel });
        const batch = f.writeBatch(firestore);
        batch.set(ref, bet);
        batch.update(walletRef, { balance: f.increment(-s.stake), lastBet: ref.id, updatedAt: f.serverTimestamp() });
        try {
          await batch.commit();
          result.placed++;
          this.remove(s.key);
        } catch (error) {
          const code = (error as { code?: string }).code ?? '';
          result.failed.push({ key: s.key, why: code === 'permission-denied' ? 'Not enough in the wallet, or the game has started' : 'Couldn’t place it: try again' });
        }
      }
    } finally {
      this.placing.set(false);
    }
    this.placed.set(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // The wallet
  // ---------------------------------------------------------------------------
  // A reload: back to 1,000, a new run (nothing voided: the history stays, open bets still settle and count
  // in the record, their payouts going to the run they were placed in)
  async reload(): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    await this.ensureWallet();
    const [firestore, f] = await firestoreSdk();
    await f.updateDoc(f.doc(firestore, 'users', uid, 'wallet', 'main'), {
      balance: START,
      resets: f.increment(1),
      resetAt: f.serverTimestamp(),
      updatedAt: f.serverTimestamp(),
    });
  }

  // Clears the history: every settled bet deleted (the open ones stay; the lifetime record the settler keeps
  // isn't touched)
  async clearHistory(): Promise<number> {
    const uid = this.uid;
    if (!uid) return 0;
    const [firestore, f] = await firestoreSdk();
    // (the history read from the server a batch at a time, not what's on show: that may be only its first page)
    let cleared = 0;
    for (;;) {
      const snap = await f.getDocs(f.query(this.settledQuery(f, firestore, uid), f.limit(400)));
      if (snap.empty) break;
      const batch = f.writeBatch(firestore);
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      cleared += snap.size;
    }
    this.settledBets.set([]);
    this.settledCursors.clear();
    this.hasSettled.set(false);
    this.settledState.set('all');
    return cleared;
  }

  // A leaderboard (the settler's, public users only)
  async leaderboard(period: Leaderboard['period']): Promise<Leaderboard | null> {
    const [firestore, f] = await firestoreSdk();
    const snap = await f.getDoc(f.doc(firestore, 'leaderboards', period));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { period, label: d['label'] ?? '', rows: d['rows'] ?? [], updatedAt: d['updatedAt'] ? iso(d['updatedAt']) : undefined };
  }
}
