// The Tracker's pins in Firestore (users/{uid}/pins/{id}): pinning a comparison from the compare view, the
// owner's list (and anyone's whose tracker they may see: firestore.rules), renaming, unpinning, the order
// they're dragged into, re-pinning (a fresh baseline), and the days they've been looked at.
import { Injectable, inject, signal } from '@angular/core';
import { db } from '@ranker/core/firebase';
import { SPORT } from '@sport/sport';
import { PositionService } from '@ranker/engine/position.service';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import type { CompareSide } from '@ranker/engine/compare/player-compare';
import { AccountService } from '../account.service';
import { PinReader } from './pin-reader';
import { PINS_MAX, Pin, PinPoint, PinSnapshot, cleanTitle, defaultTitle, specOf } from './tracker-helpers';

// (a Firestore timestamp, or a number already)
const millis = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  const t = value as { toMillis?: () => number } | null;
  return t?.toMillis ? t.toMillis() : null;
};

// Every pin a user has, deleted (their account going: AccountService.onDelete)
export async function deletePins(uid: string): Promise<void> {
  const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
  const snap = await f.getDocs(f.collection(firestore, 'users', uid, 'pins'));
  // (a batch holds 500 writes)
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = f.writeBatch(firestore);
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
}

@Injectable({ providedIn: 'root' })
export class TrackerStore {
  private readonly account = inject(AccountService);
  private readonly positions = inject(PositionService);
  readonly reader = new PinReader(inject(SeasonDataService));
  // (the specs pinned this visit, so the compare view's pin shows it's in)
  readonly pinnedSpecs = signal<ReadonlySet<string>>(new Set());

  private async pinsRef(uid: string) {
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    return { firestore, f, ref: f.collection(firestore, 'users', uid, 'pins') };
  }

  // A user's pins, in their order (the owner's, or one they may see: a rules failure otherwise)
  async list(uid: string): Promise<Pin[]> {
    const { f, ref } = await this.pinsRef(uid);
    const snap = await f.getDocs(f.query(ref, f.orderBy('order'), f.limit(PINS_MAX)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: String(data['title'] ?? ''),
        spec: String(data['spec'] ?? ''),
        sport: String(data['sport'] ?? ''),
        order: Number(data['order'] ?? 0),
        baseline: data['baseline'] as PinSnapshot,
        history: (data['history'] as PinPoint[] | undefined) ?? [],
        createdAt: millis(data['createdAt']),
      };
    });
  }

  // The compare view's comparison pinned (the sides, its tab, the sliders it's ranked with), first in the
  // owner's tracker; its snapshot now is the baseline
  async pinCompare(sides: CompareSide[], tab: string): Promise<string> {
    const user = this.account.user();
    if (!user) throw Object.assign(new Error('signed-out'), { code: 'signed-out' });
    const spec = specOf(this.positions.compareLink(sides, tab));
    const read = await this.reader.read(spec);
    if (!read) throw new Error('Nothing to pin');
    const { f, ref } = await this.pinsRef(user.uid);
    // (first: an order below every other; a full tracker turns it away)
    const pins = await f.getDocs(f.query(ref, f.orderBy('order'), f.limit(PINS_MAX)));
    if (pins.size >= PINS_MAX) throw Object.assign(new Error('full'), { code: 'full' });
    const order = pins.empty ? 0 : Number(pins.docs[0].data()['order'] ?? 0) - 1;
    const doc = f.doc(ref);
    await f.setDoc(doc, {
      title: defaultTitle(sides),
      spec,
      sport: SPORT.id,
      order,
      baseline: read.snapshot,
      history: [],
      createdAt: f.serverTimestamp(),
      updatedAt: f.serverTimestamp(),
    });
    this.pinnedSpecs.update((s) => new Set([...s, spec]));
    return doc.id;
  }

  // The compare view's comparison as a pin's link (to tell whether it's in)
  specFor(sides: CompareSide[], tab: string): string {
    return specOf(this.positions.compareLink(sides, tab));
  }

  private async update(uid: string, id: string, change: Record<string, unknown>): Promise<void> {
    const { f, ref } = await this.pinsRef(uid);
    await f.updateDoc(f.doc(ref, id), { ...change, updatedAt: f.serverTimestamp() });
  }

  rename(uid: string, id: string, title: string): Promise<void> {
    return this.update(uid, id, { title: cleanTitle(title) || 'Comparison' });
  }

  // A fresh start: the snapshot now is the baseline, the days since let go
  repin(uid: string, id: string, baseline: PinSnapshot): Promise<void> {
    return this.update(uid, id, { baseline, history: [] });
  }

  record(uid: string, id: string, history: PinPoint[]): Promise<void> {
    return this.update(uid, id, { history });
  }

  async remove(uid: string, id: string): Promise<void> {
    const { f, ref } = await this.pinsRef(uid);
    await f.deleteDoc(f.doc(ref, id));
  }

  // The pins in the order they've been dragged into (only the ones whose number changed are written)
  async reorder(uid: string, pins: Pin[]): Promise<void> {
    const { firestore, f, ref } = await this.pinsRef(uid);
    const batch = f.writeBatch(firestore);
    let writes = 0;
    pins.forEach((pin, i) => {
      if (pin.order === i) return;
      pin.order = i;
      batch.update(f.doc(ref, pin.id), { order: i, updatedAt: f.serverTimestamp() });
      writes++;
    });
    if (writes) await batch.commit();
  }

  // Someone's public profile (the page's name and picture for #tracker/<uid>)
  async profileOf(uid: string): Promise<{ displayName: string; username: string; photo: { kind: string; url: string } | null; tracker: string } | null> {
    const [firestore, f] = await Promise.all([db(), import('firebase/firestore')]);
    const snap = await f.getDoc(f.doc(firestore, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      displayName: String(data['displayName'] ?? ''),
      username: String(data['username'] ?? ''),
      photo: (data['photo'] as { kind: string; url: string } | null) ?? null,
      tracker: String(data['visibility']?.['tracker'] ?? 'friends'),
    };
  }
}
