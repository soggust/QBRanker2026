// Helpers for the sports' data scripts (apps/<sport>/scripts/update-data.mjs)

// Grades on a curve (0 = F ... 12 = A+) from scores (higher = better): the best gets 12, the worst 0,
// evenly between. The support grades (a lineup, a supporting cast, a coaching job) are made this way.
// scores: Map of key -> score (scores that aren't numbers get no grade)
export function curve(scores) {
  const ranked = [...scores].filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map(([key], rank) => [key, Math.round(12 * (1 - rank / last) * 10) / 10]));
}
