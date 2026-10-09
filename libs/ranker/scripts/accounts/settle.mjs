// The play-money settler: every user's open bet on a game that's begun, settled from ESPN's final score by the
// bettor's own rules (settle-lib.mjs: won, lost or pushed, its winnings paid into the user's wallet; void, its
// stake back, when the game's called off, the player didn't play, or its price wasn't one on the board), each in
// a transaction of its own (a bet already settled is left alone, so a run cut short or run twice pays nothing
// twice). Then the leaderboards (leaderboards/{week|season|all}: the public players' records) from each user's
// tally (tallies/{uid}, kept here). And each run, the next three days' lines snapshotted (lines/{sport}_{event}),
// so a bet's price can be checked against the board it was placed from.
//
//   node libs/ranker/scripts/accounts/settle.mjs [--dry]
//
// Run hourly by the Model Desk workflow after the bettor (its ledgers fresh), skipped without the secret.
// Credentials: FIREBASE_SERVICE_ACCOUNT (the service account's JSON) or GOOGLE_APPLICATION_CREDENTIALS; with
// FIRESTORE_EMULATOR_HOST set it works on the emulator instead. --dry: reads and reports, writes nothing.
// Free: ESPN's public API, and a few hundred Firestore reads and writes a run.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { get } from '../model/sources.mjs';
import { gameOf, linesOf } from '../model/espn.mjs';
import { statInFinal } from '../model/props.mjs';
import {
  DAY,
  addToTally,
  botObservations,
  coreObservations,
  creditOf,
  observationsOf,
  periodsAt,
  leaderboard,
  round2,
  settlePlayBet,
} from './settle-lib.mjs';

const PROJECT = 'qbranker2026';
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
export const LEAGUES = { nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
// (how many snapshots a game keeps: an hourly run's worth for a week and more)
const SNAPS = 240;

function adminApp() {
  if (getApps().length) return getApps()[0];
  if (process.env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId: process.env.GCLOUD_PROJECT || PROJECT });
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    let account;
    try {
      account = JSON.parse(json);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT isn’t valid JSON');
    }
    return initializeApp({ credential: cert(account), projectId: account.project_id ?? PROJECT });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return initializeApp({ projectId: PROJECT });
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT (the JSON) or GOOGLE_APPLICATION_CREDENTIALS (its path)');
}

// (the bettor's ledgers, each sport's: its own bets, for the props' values and the price check)
export function readLedgers(root = ROOT) {
  const out = {};
  for (const sport of Object.keys(LEAGUES)) {
    try {
      out[sport] = JSON.parse(fs.readFileSync(path.join(root, 'apps', sport, 'src/StaticData/model/ledger.json'), 'utf8')).bets ?? [];
    } catch {
      out[sport] = [];
    }
  }
  return out;
}

// (ESPN's day for a date: US Eastern, "20261011")
const espnDay = (t) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
  const part = (k) => parts.find((p) => p.type === k)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}`;
};

const iso = (v) => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v?.toDate === 'function' ? v.toDate().toISOString() : String(v));

// A game by its ESPN id, from its summary: as the bettor keeps it (gameOf), and the summary (its box score)
async function gameAndBox(fetchJson, sport, event) {
  const body = await fetchJson(`${SITE}/${LEAGUES[sport]}/summary?event=${event}`);
  const h = body?.header;
  const c = h?.competitions?.[0];
  return { game: c ? gameOf({ ...h, date: c.date, status: c.status }) : null, body };
}

// ---------------------------------------------------------------------------
// The lines' snapshots
// ---------------------------------------------------------------------------
export async function snapshotLines(db, { fetchJson = get, now = Date.now(), dry = false, log = console.log } = {}) {
  let written = 0;
  for (const [sport, league] of Object.entries(LEAGUES)) {
    for (let d = 0; d < 3; d++) {
      const events = (await fetchJson(`${SITE}/${league}/scoreboard?dates=${espnDay(now + d * DAY)}&limit=200`))?.events ?? [];
      for (const e of events) {
        if (e.competitions?.[0]?.status?.type?.state !== 'pre') continue;
        const lines = linesOf(e);
        if (!lines) continue;
        const snap = { spread: lines.spread, total: lines.total, ml: lines.ml };
        const ref = db.doc(`lines/${sport}_${e.id}`);
        const doc = await ref.get();
        const snaps = doc.exists ? (doc.get('snaps') ?? []) : [];
        const last = snaps.at(-1);
        if (last && JSON.stringify({ spread: last.spread, total: last.total, ml: last.ml }) === JSON.stringify(snap)) continue;
        written++;
        if (!dry) await ref.set({ sport, event: String(e.id), start: e.date, snaps: [...snaps, { at: new Date(now).toISOString(), ...snap }].slice(-SNAPS) });
      }
    }
  }
  log(`lines: ${written} game${written === 1 ? '' : 's'} with new prices${dry ? ' (dry)' : ''}`);
  return written;
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------
export async function settleOpen(db, { fetchJson = get, now = Date.now(), ledgers = readLedgers(), dry = false, log = console.log } = {}) {
  const snap = await db.collectionGroup('bets').where('status', '==', 'open').get();
  const due = snap.docs.filter((d) => d.ref.parent.parent?.parent?.id === 'users' && iso(d.get('start')) <= new Date(now).toISOString());
  const byGame = new Map();
  for (const d of due) {
    const key = `${d.get('sport')}|${d.get('event')}`;
    byGame.set(key, [...(byGame.get(key) ?? []), d]);
  }
  const counts = { settled: 0, void: 0, waiting: 0 };
  for (const [key, docs] of byGame) {
    const [sport, event] = key.split('|');
    if (!LEAGUES[sport]) continue;
    const { game, body } = await gameAndBox(fetchJson, sport, event);
    // (what was on the board: the open and the close, the settler's snapshots, the bettor's own bets)
    const mine = (ledgers[sport] ?? []).filter((b) => String(b.event) === String(event));
    let observations = botObservations(mine);
    if (game?.final && docs.some((d) => d.get('market') !== 'prop')) {
      const [kind, lg] = LEAGUES[sport].split('/');
      observations.push(...coreObservations(await fetchJson(`${CORE}/${kind}/leagues/${lg}/events/${event}/competitions/${event}/odds/100?lang=en&region=us`)));
      const lines = await db.doc(`lines/${sport}_${event}`).get();
      for (const s of lines.exists ? (lines.get('snaps') ?? []) : []) observations.push(...observationsOf(s, 'snap', Date.parse(s.at)));
    }
    for (const d of docs) {
      const bet = { ...d.data(), id: d.id, start: iso(d.get('start')), placedAt: iso(d.get('placedAt')) };
      let propValue;
      if (bet.market === 'prop' && game?.final) {
        // (the bettor's graded value for the same pick, else the box score's count)
        const graded = mine.find((b) => b.id === bet.ref && b.status !== 'open' && b.actual !== undefined);
        propValue = graded ? graded.actual : await statInFinal(sport, bet, body, null);
        if (propValue === null && !graded && bet.propType === 'tb') propValue = undefined;
      }
      const result = settlePlayBet(bet, game, { observations, propValue, now });
      if (!result) {
        counts.waiting++;
        continue;
      }
      counts[result.status === 'void' ? 'void' : 'settled']++;
      log(`${sport} ${bet.matchup} ${bet.pick} ${bet.odds} x${bet.stake}: ${result.status}${result.note ? ` (${result.note})` : ''}`);
      if (dry) continue;
      await settleOne(db, d.ref, result);
    }
  }
  log(`bets: ${counts.settled} settled, ${counts.void} void, ${counts.waiting} waiting${dry ? ' (dry)' : ''}`);
  return counts;
}

// One bet settled, its wallet paid and its owner's tally added to, together (a bet no longer open is left
// alone: settled already). A bet placed before a reload counts in the record; its payout stays with its run.
export async function settleOne(db, ref, result) {
  const uid = ref.parent.parent.id;
  const walletRef = db.doc(`users/${uid}/wallet/main`);
  const tallyRef = db.doc(`tallies/${uid}`);
  return db.runTransaction(async (tx) => {
    const [bet, wallet, tally] = await tx.getAll(ref, walletRef, tallyRef);
    if (!bet.exists || bet.get('status') !== 'open') return false;
    const data = { ...bet.data(), start: iso(bet.get('start')) };
    tx.update(ref, {
      status: result.status,
      profit: result.profit,
      ...(result.final ? { final: result.final } : {}),
      ...(result.note ? { note: result.note } : {}),
      settledAt: FieldValue.serverTimestamp(),
    });
    const credit = creditOf(data.stake, result);
    if (credit > 0 && wallet.exists && (wallet.get('resets') ?? 0) === (data.run ?? 0)) {
      tx.update(walletRef, { balance: round2((wallet.get('balance') ?? 0) + credit) });
    }
    tx.set(tallyRef, { ...addToTally(tally.exists ? tally.data() : null, data, result), updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

// ---------------------------------------------------------------------------
// The leaderboards
// ---------------------------------------------------------------------------
export async function writeLeaderboards(db, { now = Date.now(), dry = false, log = console.log } = {}) {
  const tallies = await db.collection('tallies').get();
  const profiles = tallies.empty ? [] : await db.getAll(...tallies.docs.map((t) => db.doc(`users/${t.id}`)));
  const entries = [];
  for (const [i, t] of tallies.docs.entries()) {
    // (a tally whose account is gone: removed, and off the boards)
    if (!profiles[i].exists) {
      if (!dry) await t.ref.delete();
      continue;
    }
    entries.push({ uid: t.id, profile: profiles[i].data(), tally: t.data() });
  }
  const periods = periodsAt(now);
  const boards = {};
  for (const [period, { from, label }] of Object.entries(periods)) {
    boards[period] = { period, label, from, rows: leaderboard(entries, from), updatedAt: new Date(now).toISOString() };
    if (!dry) await db.doc(`leaderboards/${period}`).set({ ...boards[period], updatedAt: FieldValue.serverTimestamp() });
  }
  log(`leaderboards: ${boards.week.rows.length} this week, ${boards.season.rows.length} this season, ${boards.all.rows.length} all time${dry ? ' (dry)' : ''}`);
  return boards;
}

// The whole run: settle, then the boards, then the lines' snapshots (each part on its own: one failing doesn't
// stop the others)
export async function run({ db = getFirestore(adminApp()), fetchJson = get, now = Date.now(), ledgers, dry = false, log = console.log } = {}) {
  let failed = false;
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (error) {
      failed = true;
      console.error(`${name} failed: ${error.code ?? ''} ${error.message}`.trim());
      return null;
    }
  };
  const counts = await step('Settling', () => settleOpen(db, { fetchJson, now, ledgers: ledgers ?? readLedgers(), dry, log }));
  const boards = await step('Leaderboards', () => writeLeaderboards(db, { now, dry, log }));
  const lines = await step('Lines', () => snapshotLines(db, { fetchJson, now, dry, log }));
  return { counts, boards, lines, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ dry: process.argv.includes('--dry') })
    .then(({ failed }) => process.exit(failed ? 1 : 0))
    .catch((error) => {
      console.error(`Settler failed: ${error.code ?? ''} ${error.message}`.trim());
      process.exit(1);
    });
}
