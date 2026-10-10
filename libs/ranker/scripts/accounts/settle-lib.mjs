// The play-money settler's own logic, pure (no Firestore, no network: tests/wallet.test.mjs runs it on made-up
// games): what a user's bet comes to once its game is final, by the bettor's own rules (desk.mjs settle, voidOf;
// props.mjs settleProp), the check that its price was one on the board, the tallies the leaderboards come from.
//
// The price check (checkPrice): a bet stands only if its market, side, line and price were on DraftKings' board
// for its game. What the settler knows of that board:
//   open    DraftKings' opening line and price for each side (ESPN's core API keeps them after the game)
//   close   its closing line and price (the same; before kickoff, the current one: the board the slip showed)
//   snap    the settler's own snapshots of ESPN's scoreboard (lines/{sport}_{event}), taken each hourly run for
//           the next three days' games whenever a line or price moved
//   bot     the bettor's own bets on the game (its ledger: its side's line and price when it bet, and the last
//           it saw); a prop is only ever the bot's pick, at the bot's price (the Bets page shows nothing else)
// A bet matches one of these when it's the same market and side, the same line (a moneyline has none), and its
// price is within TOLERANCE cents of that one's (cents: American odds on one scale, -110 is -10, +120 is +20;
// a long price, past 250 either way, a little more room: 4% of it). The open, the close and the bot's are
// good whenever the bet was placed (before the start: checked first); a snapshot only within WINDOW of its time.
// Limits: between snapshots a line can move and move back unseen, so a bet on a short-lived price can be voided
// ("price didn't match the board"); a bet whose game was never snapshotted is checked against the open, the
// close and the bot's alone; and a tampered slip could still take the open or a price from up to WINDOW away.
// Play money: the check keeps the record honest, it doesn't need to be airtight.

import { outcomeOf, settle as settleGame, voidOf } from '../model/desk.mjs';
import { PROP_WAIT, settleProp } from '../model/props.mjs';

export const START = 1000;
export const DAY = 864e5;
export const TOLERANCE = 10;
export const WINDOW = 3 * 36e5;
// (a prop the box score never counts, or a game ESPN never finishes: void after this long, its stake back; a
// final's count not read yet waits longer, PROP_WAIT, as the bettor's own pick does)
export const GIVE_UP = 3 * DAY;

export const round2 = (v) => Math.round(v * 100) / 100;

// (American odds on one straight scale: -110 is -10, +100 is 0, +120 is +20)
export const cents = (a) => (a > 0 ? a - 100 : a + 100);

// (whether a bet's price is close enough to one seen: TOLERANCE cents, 4% of a long price)
export function priceNear(mine, seen) {
  if (!Number.isFinite(mine) || !Number.isFinite(seen)) return false;
  const room = Math.max(TOLERANCE, Math.abs(seen) > 250 ? Math.abs(seen) * 0.04 : 0);
  return Math.abs(cents(mine) - cents(seen)) <= room + 1e-9;
}

// ---------------------------------------------------------------------------
// What was on the board
// ---------------------------------------------------------------------------

// (ESPN's numbers: "+150", "-110", "EVEN"; a line "-3.5", "o47.5", "PK")
export const priceOf = (v) => {
  const s = String(v ?? '').trim();
  if (/^even$/i.test(s)) return 100;
  const n = Number(s.replace('+', ''));
  return s && Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};
export const lineOf = (v) => {
  const s = String(v ?? '').trim();
  if (/^(pk|pick|even)$/i.test(s)) return 0;
  const n = Number(s.replace(/^[ou+]/i, ''));
  return s && Number.isFinite(n) ? n : null;
};

// A board's lines (espn.mjs linesOf's shape: spread.{home,away}.{line,odds}, total.{line,over,under},
// ml.{home,away}) as observations: one a market's side
export function observationsOf(lines, kind, at = null) {
  if (!lines) return [];
  const out = [];
  const add = (market, side, line, odds) => {
    if (Number.isFinite(odds) && (market === 'ml' || Number.isFinite(line))) out.push({ kind, at, market, side, line: market === 'ml' ? null : line, odds });
  };
  for (const side of ['home', 'away']) {
    add('spread', side, lines.spread?.[side]?.line, lines.spread?.[side]?.odds);
    add('ml', side, null, lines.ml?.[side]);
  }
  add('total', 'over', lines.total?.line, lines.total?.over);
  add('total', 'under', lines.total?.line, lines.total?.under);
  return out;
}

// ESPN's core API's DraftKings odds for an event (sports.core.api.espn.com .../odds/100): the opening and the
// closing lines, each as observations
export function coreObservations(body) {
  if (!body) return [];
  const side = (t, when) => ({ line: lineOf(t?.[when]?.pointSpread?.american), odds: priceOf(t?.[when]?.spread?.american), ml: priceOf(t?.[when]?.moneyLine?.american) });
  const out = [];
  for (const when of ['open', 'close']) {
    const h = side(body.homeTeamOdds, when);
    const a = side(body.awayTeamOdds, when);
    const t = body[when];
    out.push(
      ...observationsOf(
        {
          spread: { home: { line: h.line, odds: h.odds }, away: { line: a.line, odds: a.odds } },
          total: { line: lineOf(t?.total?.american), over: priceOf(t?.over?.american), under: priceOf(t?.under?.american) },
          ml: { home: h.ml, away: a.ml },
        },
        when,
      ),
    );
  }
  return out;
}

// The bettor's own bets on the game as observations (its side, its price when it bet, and the last it saw)
export function botObservations(ledgerBets) {
  const out = [];
  for (const b of ledgerBets ?? []) {
    const base = { market: b.market, side: b.side, propType: b.propType ?? null, athlete: b.athlete != null ? String(b.athlete) : null };
    out.push({ ...base, kind: 'bot', at: Date.parse(b.placedAt), line: b.market === 'ml' ? null : b.line, odds: b.odds });
    if (b.seen && Number.isFinite(b.seen.odds)) out.push({ ...base, kind: 'bot', at: Date.parse(b.seen.at), line: b.market === 'ml' ? null : (b.seen.line ?? b.line), odds: b.seen.odds });
  }
  return out;
}

// The price check: { ok: true, by } or { ok: false, why }
export function checkPrice(bet, observations) {
  const placed = Date.parse(bet.placedAt);
  const mine = observations.filter(
    (o) => o.market === bet.market && o.side === bet.side && (bet.market !== 'prop' || (o.propType === bet.propType && String(o.athlete) === String(bet.athlete))),
  );
  if (!mine.length) return { ok: false, why: 'couldn’t check the price: no board for this market' };
  const timely = (o) => o.kind !== 'snap' || (Number.isFinite(o.at) && Math.abs(placed - o.at) <= WINDOW);
  const sameLine = (o) => bet.market === 'ml' || o.line === bet.line;
  const match = mine.find((o) => timely(o) && sameLine(o) && priceNear(bet.odds, o.odds));
  return match ? { ok: true, by: match.kind } : { ok: false, why: 'price didn’t match the board' };
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

// (what a stake wins on top of itself, to the cent)
export const toWin = (stake, odds) => round2(odds > 0 ? (stake * odds) / 100 : (stake * 100) / -odds);

const voided = (why, final = null) => ({ status: 'void', profit: 0, note: why, ...(final ? { final } : {}) });

// A user's bet against its game (espn.mjs gameOf's shape, or null when ESPN has none), what was on the board,
// and, for a prop, the player's count (the bettor's graded value for the same pick, else the box score's;
// undefined when neither has it yet): its result ({ status: won | lost | push | void, profit, final, note? })
// or null while it waits
export function settlePlayBet(bet, game, { observations = [], propValue, now = Date.now() } = {}) {
  const start = Date.parse(bet.start);
  if (!game) return now - start > GIVE_UP ? voided('game not found') : null;
  if (`${game.awayAbbr} @ ${game.homeAbbr}` !== bet.matchup) return voided('not this game');
  // (placed once it had begun: no action)
  if (Date.parse(bet.placedAt) >= Date.parse(game.date) && !game.off) return voided('placed after the start');
  // (called off, by DraftKings' rule: desk.mjs voidOf)
  const off = voidOf({ ...bet, units: bet.stake }, game, now);
  if (off) return voided(off.why.replace(/^Void: /, ''), off.final);
  if (!game.final) return bet.market === 'prop' && now - start > GIVE_UP ? voided('couldn’t settle the prop') : null;
  const price = checkPrice(bet, observations);
  if (!price.ok) return voided(price.why);
  const priced = { ...bet, units: bet.stake };
  if (bet.market === 'prop') {
    // (a count not read yet waits as long as the bettor's own pick does (props.mjs PROP_WAIT), so the two end alike)
    if (propValue === undefined) return now - start > Math.max(GIVE_UP, PROP_WAIT) ? voided('couldn’t read the stat') : null;
    const r = settleProp(priced, propValue);
    if (r.void) return voided(r.final ?? 'did not play');
    return { status: r.status, profit: r.status === 'won' ? toWin(bet.stake, bet.odds) : r.status === 'lost' ? -bet.stake : 0, final: r.final };
  }
  const r = settleGame(priced, game);
  // (a run line or total on an MLB game cut short: void, the bettor's own rule)
  if (r.void) return voided(r.why.replace(/^Void: /, ''), r.final);
  return { status: r.status, profit: r.status === 'won' ? toWin(bet.stake, bet.odds) : r.status === 'lost' ? -bet.stake : 0, final: r.final };
}

// (the bettor's graded pick a prop is settled by: the one its ref names, and only if it's the same stat of the
// same player; a ref to another pick, one whose player had a big night, would otherwise settle it by that count)
export function gradedPick(bet, ledgerBets) {
  return (ledgerBets ?? []).find(
    (b) =>
      b.id === bet.ref &&
      b.market === 'prop' &&
      b.propType === bet.propType &&
      String(b.athlete) === String(bet.athlete) &&
      b.status !== 'open' &&
      b.actual !== undefined,
  );
}

// (whether a settled bet pays into the wallet as it is now: the same run (a reload starts another) and placed
// after the wallet was made; a wallet deleted and made again is back at run 0, and must not collect the old
// one's bets. Timestamps or anything with toMillis, or ISO strings)
const millisOf = (v) => (typeof v?.toMillis === 'function' ? v.toMillis() : v == null ? null : Date.parse(v));
export function paysInto(bet, wallet) {
  if (!wallet || (wallet.resets ?? 0) !== (bet.run ?? 0)) return false;
  const made = millisOf(wallet.createdAt);
  const placed = millisOf(bet.placedAt);
  return made == null || (Number.isFinite(placed) && placed >= made);
}

// (what goes back in the wallet: the stake and the winnings on a win, the stake on a push or a void)
export const creditOf = (stake, result) => (result.status === 'won' ? round2(stake + result.profit) : result.status === 'lost' ? 0 : stake);

// (outcomeOf kept in reach: the bettor's own rule for a result's profit)
export { outcomeOf };

// ---------------------------------------------------------------------------
// Tallies and leaderboards
// ---------------------------------------------------------------------------

// (the day a game's filed under: its start's day in US Eastern time, "2026-10-11")
export function etDate(t) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t));
  const get = (k) => parts.find((p) => p.type === k)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// A tally with one more settled bet in it: lifetime (all) and its game's day (days: [won, lost, push, staked,
// profit]); a void counts only as a void
export function addToTally(tally, bet, result) {
  const all = { won: 0, lost: 0, push: 0, void: 0, staked: 0, profit: 0, ...(tally?.all ?? {}) };
  const days = { ...(tally?.days ?? {}) };
  if (result.status === 'void') {
    all.void++;
    return { all, days };
  }
  all[result.status]++;
  all.staked = round2(all.staked + bet.stake);
  all.profit = round2(all.profit + result.profit);
  const key = etDate(bet.start);
  const d = [...(days[key] ?? [0, 0, 0, 0, 0])];
  d[['won', 'lost', 'push'].indexOf(result.status)]++;
  d[3] = round2(d[3] + bet.stake);
  d[4] = round2(d[4] + result.profit);
  days[key] = d;
  return { all, days };
}

// The leaderboards' periods at a moment: this week (Monday to Sunday, US Eastern), the season (August 1 on),
// all time; each its first day and its name
export function periodsAt(now) {
  const today = etDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const weekday = (new Date(noon).getUTCDay() + 6) % 7;
  const monday = new Date(noon - weekday * DAY).toISOString().slice(0, 10);
  const seasonYear = m >= 8 ? y : y - 1;
  return {
    week: { from: monday, label: `Week of ${new Date(`${monday}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` },
    season: { from: `${seasonYear}-08-01`, label: `${seasonYear}-${String(seasonYear + 1).slice(2)} season` },
    all: { from: '0000-00-00', label: 'All time' },
  };
}

// (a leaderboard's photo: an address, never an upload's data, which would swell the board past a document's size)
const boardPhoto = (photo) => (photo && typeof photo.url === 'string' && !photo.url.startsWith('data:') ? { kind: photo.kind, url: photo.url } : null);

// A period's leaderboard: the public players (their bet history public) with a settled bet in it, by profit
// (then the return on their stakes), the top 50; each row with its reloads (the wallet's resets: a record
// built over several bankrolls says so beside it)
export function leaderboard(entries, from, limit = 50) {
  const rows = [];
  for (const { uid, profile, tally, wallet } of entries) {
    if (profile?.visibility?.betHistory !== 'public' || !profile.username) continue;
    const t = { won: 0, lost: 0, push: 0, staked: 0, profit: 0 };
    for (const [day, [won, lost, push, staked, profit]] of Object.entries(tally?.days ?? {})) {
      if (day < from) continue;
      t.won += won;
      t.lost += lost;
      t.push += push;
      t.staked += staked;
      t.profit += profit;
    }
    if (!(t.won + t.lost + t.push)) continue;
    rows.push({
      uid,
      username: profile.username,
      displayName: profile.displayName ?? profile.username,
      photo: boardPhoto(profile.photo),
      won: t.won,
      lost: t.lost,
      push: t.push,
      staked: round2(t.staked),
      profit: round2(t.profit),
      roi: t.staked ? Math.round((t.profit / t.staked) * 1e4) / 1e4 : null,
      reloads: Math.max(0, Math.floor(Number(wallet?.resets) || 0)),
    });
  }
  return rows.sort((a, b) => b.profit - a.profit || (b.roi ?? 0) - (a.roi ?? 0) || a.username.localeCompare(b.username)).slice(0, limit);
}
