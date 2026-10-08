// A context term: its key, its group (what gathers its facts and decides whether they're fetched: rest,
// travel, starters, weather, officials, strength, matchups, ranker, park), whether it moves the margin (m: the
// home side's edge, a positive size favoring the side it names) or the total (t), and its words (label, and
// the unit its size is per)
export const term = (key, group, on, label, unit) => ({ key, group, on, label, unit });
