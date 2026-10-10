import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firestoreSdk } from '@ranker/core/firebase';
import { SPORT } from '@sport/sport';
import { AccountService } from '../account.service';
import { PresetSettings, UserPreset } from '../lists/lists-helpers';

// The signed-in user's presets (users/{uid}/presets/{id}: a tab's sliders and switched-off stats and
// groups under a name), this sport's, followed live while they're signed in; nothing loads for anyone
// signed out
@Injectable({ providedIn: 'root' })
export class PresetsStore {
  private readonly account = inject(AccountService);
  private readonly all = signal<UserPreset[]>([]);
  // (this sport's, by name)
  readonly presets = computed(() => this.all().filter((p) => p.sport === SPORT.id).sort((a, b) => a.name.localeCompare(b.name)));
  private stop: (() => void) | null = null;
  private following: string | null = null;

  constructor() {
    effect(() => void this.follow(this.account.user()?.uid ?? null));
  }

  forTab(tab: string): UserPreset[] {
    return this.presets().filter((p) => p.tab === tab);
  }

  byId(id: string): UserPreset | undefined {
    return this.all().find((p) => p.id === id);
  }

  private async follow(uid: string | null): Promise<void> {
    if (uid === this.following) return;
    this.stop?.();
    this.stop = null;
    this.following = uid;
    this.all.set([]);
    if (!uid) return;
    const [firestore, f] = await firestoreSdk();
    if (this.following !== uid) return;
    this.stop = f.onSnapshot(
      f.query(f.collection(firestore, 'users', uid, 'presets'), f.where('sport', '==', SPORT.id)),
      (snap) => this.all.set(snap.docs.map((d) => ({ ...(d.data() as Omit<UserPreset, 'id'>), id: d.id }))),
      (error) => console.error('Presets', error),
    );
  }

  private async uid(): Promise<string> {
    await this.account.start();
    const uid = this.account.user()?.uid;
    if (!uid) throw Object.assign(new Error('signed out'), { code: 'permission-denied' });
    return uid;
  }

  async create(tab: string, name: string, settings: PresetSettings): Promise<string> {
    const uid = await this.uid();
    const [firestore, f] = await firestoreSdk();
    const ref = f.doc(f.collection(firestore, 'users', uid, 'presets'));
    await f.setDoc(ref, { sport: SPORT.id, tab, name: name.trim(), settings, createdAt: f.serverTimestamp(), updatedAt: f.serverTimestamp() });
    return ref.id;
  }

  async update(id: string, change: { name?: string; settings?: PresetSettings }): Promise<void> {
    const uid = await this.uid();
    const [firestore, f] = await firestoreSdk();
    const fields = { ...change, ...(change.name !== undefined && { name: change.name.trim() }) };
    await f.updateDoc(f.doc(firestore, 'users', uid, 'presets', id), { ...fields, updatedAt: f.serverTimestamp() });
  }

  async remove(id: string): Promise<void> {
    const uid = await this.uid();
    const [firestore, f] = await firestoreSdk();
    await f.deleteDoc(f.doc(firestore, 'users', uid, 'presets', id));
  }
}
