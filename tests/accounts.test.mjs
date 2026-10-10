// The account module's plain helpers (account-helpers.ts): usernames (the rules' pattern, cleaning, ones
// made from a name), the profile's limits, passwords, Firebase's error codes in plain words, and the
// avatar upload's crop and size. firestore.rules checks the same limits (tests/rules, with the emulator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEngine } from './support/engine.mjs';

const h = await loadEngine('nfl', { entry: path.join(import.meta.dirname, 'support/accounts-entry.ts'), data: {} });

test('usernames: 3 to 20 letters, numbers or underscores; the claim is the lowercase name', () => {
  for (const ok of ['abc', 'Ace_1', 'a'.repeat(20), '@sam_99', '  bo_b  ']) assert.equal(h.usernameProblem(ok), null, ok);
  assert.match(h.usernameProblem(''), /Pick/);
  assert.match(h.usernameProblem('ab'), /At least 3/);
  assert.match(h.usernameProblem('a'.repeat(21)), /At most 20/);
  for (const bad of ['has space', 'dash-ed', 'émile', 'dot.name', 'a@b']) assert.match(h.usernameProblem(bad), /Letters, numbers/, bad);
  assert.equal(h.cleanUsername('  @@Sam_99 '), 'Sam_99');
  assert.equal(h.usernameKey(' @Sam_99'), 'sam_99');
});

test('a username made from a name, or the email, with room for a number', () => {
  assert.equal(h.usernameFrom('August Gieseman'), 'august_gieseman');
  assert.equal(h.usernameFrom('José  Núñez-Ortiz!'), 'jose_nunez_ortiz');
  assert.equal(h.usernameFrom('李', 'fan.club+x@example.com'), 'fan_club_x');
  assert.equal(h.usernameFrom('', 'ab@example.com'), 'fan');
  assert.equal(h.usernameFrom(null), 'fan');
  const long = h.usernameFrom('Bartholomew Montgomery-Fitzgerald');
  assert.ok(long.length <= 16 && !long.endsWith('_'), long);
  const names = h.usernameCandidates('sam', () => 0.5);
  assert.deepEqual(names.slice(0, 3), ['sam', 'sam2', 'sam3']);
  assert.equal(names.at(-1), 'sam5500');
  for (const n of h.usernameCandidates(long)) assert.equal(h.usernameProblem(n), null, n);
});

test('the profile\'s fields and passwords', () => {
  assert.match(h.displayNameProblem('  '), /Add/);
  assert.equal(h.displayNameProblem('x'.repeat(40)), null);
  assert.match(h.displayNameProblem('x'.repeat(41)), /At most 40/);
  assert.equal(h.bioProblem('x'.repeat(200)), null);
  assert.match(h.bioProblem('x'.repeat(201)), /At most 200/);
  assert.match(h.passwordProblem('short1'), /At least 8/);
  assert.match(h.passwordProblem('longenough'), /letter and one number/);
  assert.match(h.passwordProblem('12345678'), /letter and one number/);
  assert.equal(h.passwordProblem('secret123'), null);
  assert.equal(h.emailProblem(' a@b.co '), null);
  assert.ok(h.emailProblem('a@b'));
  assert.equal(h.firstName('  August  Gieseman '), 'August');
  assert.equal(h.initials('August Q Gieseman'), 'AG');
  assert.equal(h.initials('cher'), 'CH');
  assert.equal(h.initials(''), '?');
  assert.deepEqual(Object.keys(h.DEFAULT_VISIBILITY), h.VISIBILITY_KINDS.map((k) => k.kind));
});

test('Firebase\'s error codes in plain words', () => {
  const err = (code) => Object.assign(new Error('x'), { code });
  assert.match(h.errorMessage(err('auth/invalid-credential')), /don’t match/);
  assert.match(h.errorMessage(err('auth/email-already-in-use')), /already uses that email/);
  assert.match(h.errorMessage(err('auth/popup-blocked')), /pop-ups/);
  assert.match(h.errorMessage(err('username-taken')), /taken/);
  assert.match(h.errorMessage(err('firestore/permission-denied')), /permission/);
  assert.match(h.errorMessage(err('auth/something-new')), /Something went wrong/);
  assert.match(h.errorMessage('not an error'), /Something went wrong/);
  assert.equal(h.quietError(err('auth/popup-closed-by-user')), true);
  assert.equal(h.quietError(err('auth/invalid-credential')), false);
});

test('the avatar: the middle square, 160px at most, never scaled up; under 40 KB', () => {
  assert.deepEqual(h.avatarCrop(400, 300), { sx: 50, sy: 0, side: 300, out: 160 });
  assert.deepEqual(h.avatarCrop(300, 1000), { sx: 0, sy: 350, side: 300, out: 160 });
  assert.deepEqual(h.avatarCrop(90, 120), { sx: 0, sy: 15, side: 90, out: 90 });
  assert.equal(h.avatarCrop(1, 1).out, 1);
  assert.equal(h.fitsAvatar('x'.repeat(40 * 1024)), true);
  assert.equal(h.fitsAvatar('x'.repeat(40 * 1024 + 1)), false);
  // (what's stored stays under the rules' 60 KB cap)
  assert.ok(h.AVATAR_BYTES < h.PHOTO_MAX);
  assert.deepEqual([...h.AVATAR_QUALITIES].sort((a, b) => b - a), h.AVATAR_QUALITIES);
});

test('the name filter: obscenities past their disguises, short words only whole, the site’s own names reserved', () => {
  // (anywhere in a name, past case, look-alikes, repeats and padding)
  for (const name of ['fuck', 'xx_FUCK_xx', 'fuuuck99', 'f_u_c_k', 'FuCk_u']) assert.equal(h.isOffensive(name), true, name);
  // (short words only as a whole word: on their own, split by case, digits or underscores)
  for (const name of ['shit', 'Big_Dick', 'BigDick', 'd1ck_69', '$hit', 'ass']) assert.equal(h.isOffensive(name), true, name);
  // (ordinary names they hide inside)
  for (const name of ['otter_raccoon', 'Dickson', 'classy', 'Sussex', 'Nazir', 'cocktail_hour', 'passion', 'August Gieseman']) assert.equal(h.isOffensive(name), false, name);
  assert.equal(h.isReservedUsername('Admin'), true);
  assert.equal(h.isReservedUsername('admin_1'), true);
  assert.equal(h.isReservedUsername('SeasonRankerHQ'), true);
  assert.equal(h.isReservedUsername('badminton'), false);
  // (the checks the forms use)
  assert.equal(h.usernameProblem('admin'), 'That username is reserved.');
  assert.equal(h.usernameProblem('big_dick'), 'Pick a different username.');
  assert.equal(h.usernameProblem('otter_raccoon'), null);
  assert.equal(h.displayNameProblem('Shit Head'), 'Pick a different display name.');
  assert.equal(h.displayNameProblem('Butkus'), null);
  // (a name made from a sign-in that the filter turns away: the email's name instead, else "fan")
  assert.equal(h.usernameFrom('Big Dick', 'jo.smith@example.com'), 'jo_smith');
  assert.equal(h.usernameFrom('Admin', null), 'fan');
});
