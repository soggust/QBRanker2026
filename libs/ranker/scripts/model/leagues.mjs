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
//
// context (context.mjs: the terms beyond the ratings, their sizes fit by the replay, not set here):
//   restCap  days of rest past which more counts no more (a season's first game counts as this)
// guard (the desk's caution, not fit yet: the ledger keeps what each bet saw so it can be): a line that's
// moved this far since it opened (spread or total in points, moneyline in the home side's fair chance) cuts
// the bet to the 0.5-unit minimum, twice as far skips it
// deepen   the season the history reaches back to (the NFL's older ones from nflverse)
//
// PROP_CAPS (props.mjs, run.mjs): how much the props may stake. untested: a prop type whose trust isn't fit
// yet (fewer than 40 graded): at most maxUnits a prop, perGame of them a game, perDay units of them a day in
// the sport. tested: once its trust is fit (perDay null: no daily cap)
// BOOK: the one sportsbook the desk bets, for every market and prop: its lines and prices are the ones
// priced and placed (The Odds API's key for it; ESPN's free board, the fallback, is DraftKings' too)
export const BOOK = 'draftkings';

// (no count caps: the user wants all the exposure the data can give, the money's play money; an untested type
// still stakes at most 1 unit a prop)
export const PROP_CAPS = {
  untested: { maxUnits: 1, perGame: null, perDay: null },
  tested: { maxUnits: 3, perGame: null, perDay: null },
};

export const LEAGUES = {
  nfl: {
    league: 'football/nfl',
    label: 'NFL',
    deepen: 2016,
    context: { restCap: 10 },
    guard: { spread: 1.5, total: 2, ml: 0.06 },
    priors: { k: 0.08, hfa: 1.8, revert: 0.65, kO: 0.06, sigma: 13.5, sigmaT: 13.5, avg: 22.5 },
    grid: { k: [0.04, 0.06, 0.08, 0.11, 0.14], hfa: [0.8, 1.4, 2, 2.6], revert: [0.5, 0.65, 0.8], kO: [0.03, 0.05, 0.08, 0.12] },
  },
  nba: {
    league: 'basketball/nba',
    label: 'NBA',
    context: { restCap: 3 },
    guard: { spread: 2, total: 3, ml: 0.06 },
    priors: { k: 0.05, hfa: 2.4, revert: 0.7, kO: 0.03, sigma: 12.5, sigmaT: 18, avg: 113 },
    grid: { k: [0.02, 0.035, 0.05, 0.07, 0.1], hfa: [1.2, 1.9, 2.6, 3.3], revert: [0.5, 0.7, 0.85], kO: [0.01, 0.02, 0.035, 0.05] },
  },
  nhl: {
    league: 'hockey/nhl',
    label: 'NHL',
    context: { restCap: 3 },
    // (the puck line stays at 1.5, a side flipping it is the moneyline moving: no spread guard)
    guard: { spread: null, total: 1, ml: 0.06 },
    priors: { k: 0.04, hfa: 0.2, revert: 0.7, kO: 0.03, sigma: 2.3, sigmaT: 2.3, avg: 3.1 },
    grid: { k: [0.015, 0.025, 0.04, 0.06, 0.09], hfa: [0.05, 0.15, 0.25, 0.35], revert: [0.5, 0.7, 0.85], kO: [0.01, 0.02, 0.035, 0.05] },
  },
  mlb: {
    league: 'baseball/mlb',
    label: 'MLB',
    context: { restCap: 2 },
    guard: { spread: null, total: 1, ml: 0.06 },
    priors: { k: 0.025, hfa: 0.15, revert: 0.7, kO: 0.02, sigma: 4.2, sigmaT: 4.4, avg: 4.5 },
    grid: { k: [0.01, 0.018, 0.025, 0.035, 0.05], hfa: [0.05, 0.15, 0.25, 0.35], revert: [0.5, 0.7, 0.85], kO: [0.008, 0.015, 0.025, 0.04] },
  },
};
