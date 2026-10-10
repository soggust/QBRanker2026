// The community boards' plain pieces (no Angular, no Firebase): a board's key, the consensus ranking
// from everyone's submitted lists (a Borda count, worked out in the browser from the entries for now; an
// Admin tally into community/{key} can take over later), the entries sorted by their votes, and the
// leaderboard of the list makers. Tested by tests/lists.test.mjs.

// (one board per sport, tab and season: "nfl_QB_2026")
export function boardKey(sport: string, tab: string, season: number): string {
  return `${sport}_${tab}_${season}`;
}

export const BOARD_KEY = /^[a-z]{2,8}_[A-Za-z0-9]{1,12}_\d{4}$/;

export function readBoardKey(key: string): { sport: string; tab: string; season: number } | null {
  if (!BOARD_KEY.test(key)) return null;
  const [sport, tab, season] = key.split('_');
  return { sport, tab, season: Number(season) };
}

// A submitted list (community/{key}/entries/{uid}), as the app reads it
export interface CommunityEntry {
  owner: string;
  listId: string;
  title: string;
  ownerName: string;
  ids: string[];
  names: string[];
  logos: (string | null)[];
  submittedAt?: unknown;
}

export interface ConsensusRow {
  id: string;
  points: number;
  // (how many lists have him, and his average place in those)
  lists: number;
  avgRank: number;
  // (his best and worst place)
  best: number;
  worst: number;
}

// The consensus: a Borda count over every entry's order. Each list gives its #1 `depth` points, its #2
// one fewer, and so on (so a short list's players score as they'd score at the top of a long one); a
// player a list leaves out gets nothing from it. Most points first; a tie goes to the player more lists
// have, then the better average place, then the first one seen.
export function consensus(entries: { ids: string[] }[], depth = 50): ConsensusRow[] {
  const rows = new Map<string, { points: number; ranks: number[]; seen: number }>();
  let order = 0;
  for (const entry of entries) {
    const counted = new Set<string>();
    (entry.ids ?? []).slice(0, depth).forEach((id, i) => {
      if (!id || counted.has(id)) return;
      counted.add(id);
      let row = rows.get(id);
      if (!row) rows.set(id, (row = { points: 0, ranks: [], seen: order++ }));
      row.points += depth - i;
      row.ranks.push(i + 1);
    });
  }
  return [...rows]
    .map(([id, r]) => ({
      id,
      points: r.points,
      lists: r.ranks.length,
      avgRank: r.ranks.reduce((a, b) => a + b, 0) / r.ranks.length,
      best: Math.min(...r.ranks),
      worst: Math.max(...r.ranks),
      seen: r.seen,
    }))
    .sort((a, b) => b.points - a.points || b.lists - a.lists || a.avgRank - b.avgRank || a.seen - b.seen)
    .map(({ seen: _, ...row }) => row);
}

// A list's votes added up: the score (ups less downs), each, and the reader's own
export interface VoteTally {
  up: number;
  down: number;
  score: number;
  mine: 1 | -1 | 0;
}

export function tally(votes: { voter: string; value: number }[], me: string | null): VoteTally {
  let up = 0;
  let down = 0;
  let mine: 1 | -1 | 0 = 0;
  for (const vote of votes) {
    if (vote.value === 1) up++;
    else if (vote.value === -1) down++;
    else continue;
    if (me && vote.voter === me) mine = vote.value as 1 | -1;
  }
  return { up, down, score: up - down, mine };
}

// The entries best first: by score, then more votes, then the earlier submission's owner name
export function byScore<T extends { tally: VoteTally; entry: { ownerName: string } }>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      b.tally.score - a.tally.score ||
      b.tally.up + b.tally.down - (a.tally.up + a.tally.down) ||
      a.entry.ownerName.localeCompare(b.entry.ownerName),
  );
}

// The list makers by the votes their lists drew (every board given): total score, then lists made
export interface Maker {
  owner: string;
  name: string;
  score: number;
  lists: number;
}

export function leaderboard(cards: { tally: VoteTally; entry: { owner: string; ownerName: string } }[], top = 5): Maker[] {
  const makers = new Map<string, Maker>();
  for (const { tally: t, entry } of cards) {
    const maker = makers.get(entry.owner) ?? { owner: entry.owner, name: entry.ownerName, score: 0, lists: 0 };
    maker.score += t.score;
    maker.lists++;
    makers.set(entry.owner, maker);
  }
  return [...makers.values()]
    .sort((a, b) => b.score - a.score || b.lists - a.lists || a.name.localeCompare(b.name))
    .slice(0, top);
}

// The board to show when none was asked for (#community alone): the guess (the rankings' tab), unless its
// board is empty and another position's isn't; then the first with lists (in the sport's tab order). The
// lists counted per tab, in that order; -1 keeps the guess.
export function boardWithLists(counts: number[], guess: number): number {
  if (counts[guess] > 0) return -1;
  return counts.findIndex((n) => n > 0);
}
