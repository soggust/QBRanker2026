// The model desk's leagues: ESPN's path for each, and where its ratings start before the history fits them.
// Ratings are in the sport's own scoring unit (points, goals, runs): a team rated 3 better than another is
// expected to win by 3 on a neutral field.
//
//   k       how far one game's surprise moves a rating (share of the miss)
//   hfa     home advantage, in the unit
//   revert  how much of a rating carries into the next season (the rest drifts back to average)
//   kO      how far one game moves a team's scoring and allowing rates
//   sigma   spread of a game's margin around its expected margin (fit as the history's own)
//   sigmaT  spread of a game's total around its expected total
//   avg     a team's average score a game (the history keeps it current)

export const LEAGUES = {
  nfl: {
    league: 'football/nfl',
    label: 'NFL',
    priors: { k: 0.08, hfa: 1.8, revert: 0.65, kO: 0.06, sigma: 13.5, sigmaT: 13.5, avg: 22.5 },
    grid: { k: [0.04, 0.06, 0.08, 0.11, 0.14], hfa: [0.8, 1.4, 2, 2.6], revert: [0.5, 0.65, 0.8], kO: [0.03, 0.05, 0.08, 0.12] },
  },
  nba: {
    league: 'basketball/nba',
    label: 'NBA',
    priors: { k: 0.05, hfa: 2.4, revert: 0.7, kO: 0.03, sigma: 12.5, sigmaT: 18, avg: 113 },
    grid: { k: [0.02, 0.035, 0.05, 0.07, 0.1], hfa: [1.2, 1.9, 2.6, 3.3], revert: [0.5, 0.7, 0.85], kO: [0.01, 0.02, 0.035, 0.05] },
  },
  nhl: {
    league: 'hockey/nhl',
    label: 'NHL',
    priors: { k: 0.04, hfa: 0.2, revert: 0.7, kO: 0.03, sigma: 2.3, sigmaT: 2.3, avg: 3.1 },
    grid: { k: [0.015, 0.025, 0.04, 0.06, 0.09], hfa: [0.05, 0.15, 0.25, 0.35], revert: [0.5, 0.7, 0.85], kO: [0.01, 0.02, 0.035, 0.05] },
  },
  mlb: {
    league: 'baseball/mlb',
    label: 'MLB',
    priors: { k: 0.025, hfa: 0.15, revert: 0.7, kO: 0.02, sigma: 4.2, sigmaT: 4.4, avg: 4.5 },
    grid: { k: [0.01, 0.018, 0.025, 0.035, 0.05], hfa: [0.05, 0.15, 0.25, 0.35], revert: [0.5, 0.7, 0.85], kO: [0.008, 0.015, 0.025, 0.04] },
  },
};
