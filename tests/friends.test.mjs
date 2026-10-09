// Friends' plain helpers (friends-helpers.ts): where two users stand, what a viewer may see of a profile
// (the same test firestore.rules' canSee makes: tests/rules/friends.test.mjs checks the rules themselves),
// the username search's prefix and range, profile addresses, the lists' order, and a settled-bets record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';

const h = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support/friends-entry.ts'), data: {} });

test('relation: yourself, none, or the status on your side', () => {
  assert.equal(h.relationOf('a', 'a', null), 'self');
  assert.equal(h.relationOf('a', 'a', 'friends'), 'self');
  assert.equal(h.relationOf('a', 'b', null), 'none');
  assert.equal(h.relationOf(null, 'b', null), 'none');
  for (const s of ['pending-out', 'pending-in', 'friends']) assert.equal(h.relationOf('a', 'b', s), s);
});

test('access: public to all, friends to friends, private to the owner alone', () => {
  const table = {
    public: { self: 'shown', friends: 'shown', none: 'shown', 'pending-out': 'shown', 'pending-in': 'shown' },
    friends: { self: 'shown', friends: 'shown', none: 'friends-only', 'pending-out': 'friends-only', 'pending-in': 'friends-only' },
    private: { self: 'shown', friends: 'private', none: 'private', 'pending-out': 'private', 'pending-in': 'private' },
  };
  for (const [setting, row] of Object.entries(table)) {
    for (const [relation, want] of Object.entries(row)) assert.equal(h.accessOf(setting, relation), want, `${setting} / ${relation}`);
  }
  // (no setting at all: hidden, as the rules would)
  assert.equal(h.accessOf(undefined, 'friends'), 'private');
  const all = h.accessAll({ lists: 'public', presets: 'friends', openBets: 'private', betHistory: 'friends', tracker: 'public' }, 'none');
  assert.deepEqual(all, { lists: 'shown', presets: 'friends-only', openBets: 'private', betHistory: 'friends-only', tracker: 'shown' });
  assert.match(h.hiddenNote('friends-only', 'Sam Lee'), /^Sam Lee shares this with friends only/);
  assert.match(h.hiddenNote('private', ''), /^This user keeps this private/);
});

test('the username search: a clean lowercase prefix, as a document-id range', () => {
  assert.equal(h.searchPrefix('  @Sam_9 '), 'sam_9');
  assert.equal(h.searchPrefix('s'), null);
  assert.equal(h.searchPrefix('sam lee'), null);
  assert.equal(h.searchPrefix('sam-lee'), null);
  assert.equal(h.searchPrefix('x'.repeat(21)), null);
  const [start, end] = h.prefixRange('sam');
  for (const id of ['sam', 'sam_9', 'samantha']) assert.ok(id >= start && id < end, id);
  for (const id of ['sal', 'sap', 'sbm', 'sa']) assert.ok(!(id >= start && id < end), id);
});

test('profile addresses round-trip', () => {
  assert.equal(h.profileHash('Sam_9'), '#u/Sam_9');
  assert.equal(h.usernameFromHash('#u/Sam_9'), 'Sam_9');
  assert.equal(h.usernameFromHash(h.profileHash('a b')), 'a b');
  assert.equal(h.usernameFromHash('#friends'), null);
  assert.equal(h.usernameFromHash('#u/'), null);
  assert.equal(h.usernameFromHash('#u/%E0%A4%A'), null);
});

test('the Friends page: requests newest first, friends by name', () => {
  const rows = [
    { uid: '1', status: 'friends', since: 5, name: 'zed' },
    { uid: '2', status: 'pending-in', since: 1, name: 'Old' },
    { uid: '3', status: 'pending-in', since: 9, name: 'New' },
    { uid: '4', status: 'friends', since: 2, name: 'Amy' },
    { uid: '5', status: 'pending-out', since: 3, name: 'Out' },
    { uid: '6', status: 'friends', since: 2, name: 'bob' },
  ];
  const g = h.sortFriends(rows);
  assert.deepEqual(g.incoming.map((r) => r.uid), ['3', '2']);
  assert.deepEqual(g.outgoing.map((r) => r.uid), ['5']);
  assert.deepEqual(g.friends.map((r) => r.name), ['Amy', 'bob', 'zed']);
});

test('a settled record: tallies, profit and ROI; open and void bets left out', () => {
  const r = h.betRecord([
    { status: 'won', stake: 100, profit: 90.91 },
    { status: 'lost', stake: 50, profit: -50 },
    { status: 'push', stake: 20, profit: 0 },
    { status: 'open', stake: 500 },
    { status: 'void', stake: 30, profit: 0 },
  ]);
  assert.deepEqual({ ...r }, { won: 1, lost: 1, push: 1, profit: 40.91, staked: 170, roi: 24.1 });
  assert.equal(h.recordText(r), '1-1-1');
  assert.equal(h.recordText({ ...r, push: 0 }), '1-1');
  assert.equal(h.betRecord([]).roi, null);
  assert.equal(h.money(1250), '1,250u');
  assert.equal(h.money(40.5, true), '+40.50u');
  assert.equal(h.money(-45), '-45u');
  assert.equal(h.money(0, true), '0u');
  assert.equal(h.oddsText(150), '+150');
  assert.equal(h.oddsText(-110), '-110');
  assert.equal(h.oddsText(null), '');
  assert.equal(h.millis({ seconds: 2 }), 2000);
  assert.equal(h.millis({ toMillis: () => 7 }), 7);
  assert.equal(h.millis(null), 0);
});
