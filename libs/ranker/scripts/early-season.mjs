// Early-season support grades (MLB, NBA, NHL data scripts). A team's grades (Lineup, Teammates,
// Linemates, Defense, Coaching...) come from this season's stats, which a few games barely measure.
// So early on, each player's grade starts from his team's grade last season (the average over last
// season's rows for that team; a team new to the league starts at a neutral C) and gives way to this
// season's as the team plays: this season counts (games / fullAt) ^ 0.5, all of it from fullAt games
// on (about a quarter of the season: 20 of 82, 40 of 162). Only the season being played: a finished
// season is all its own results. (The NFL does the same in the app, against its preseason grades.)
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const NEUTRAL = 6;

// This season's share of a grade after a team's games
export const seasonShare = (games, fullAt) => (games > 0 ? Math.min(1, (games / fullAt) ** 0.5) : 0);

// Blends the grades (keys) of every unit in rows (tab -> units) with last season's, in place. Team
// games played: the most games any of the team's players has played. Returns a line for the log.
export async function blendWithLastSeason({ staticDir, season, rows, keys, fullAt }) {
  const file = path.join(staticDir, 'seasons', String(season - 1), 'skill-players.json');
  let last;
  try {
    last = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return `early-season grades: no ${season - 1} file, none blended`;
  }
  // Last season's average grade per team and key
  const sums = new Map();
  for (const unit of Object.values(last).flat()) {
    for (const key of keys) {
      const grade = unit.stats?.[key];
      if (grade === null || grade === undefined) continue;
      const id = `${unit.teamLogo}|${key}`;
      const s = sums.get(id) ?? { sum: 0, n: 0 };
      sums.set(id, { sum: s.sum + grade, n: s.n + 1 });
    }
  }
  const before = (team, key) => {
    const s = sums.get(`${team}|${key}`);
    return s ? s.sum / s.n : NEUTRAL;
  };
  // This season's games per team
  const units = Object.values(rows).flat();
  const games = new Map();
  for (const unit of units) games.set(unit.teamLogo, Math.max(games.get(unit.teamLogo) ?? 0, unit.games ?? 0));

  let changed = 0;
  for (const unit of units) {
    const share = seasonShare(games.get(unit.teamLogo) ?? 0, fullAt);
    if (share >= 1) continue;
    for (const key of keys) {
      const now = unit.stats?.[key];
      if (now === null || now === undefined) continue;
      // (to a tenth, like the curved grades)
      const blended = Math.round((before(unit.teamLogo, key) + (now - before(unit.teamLogo, key)) * share) * 10) / 10;
      if (blended !== now) changed++;
      unit.stats[key] = blended;
    }
  }
  const shares = [...games.values()].map((g) => seasonShare(g, fullAt));
  const avg = shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length);
  return `early-season grades: this season ${Math.round(avg * 100)}% on average (full at ${fullAt} games), ${changed} grades moved toward ${season - 1}'s`;
}
