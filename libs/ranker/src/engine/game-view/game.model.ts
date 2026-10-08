// The game view's model: one game as the view shows it, shaped the same for every sport (game.ts reads it
// from ESPN's summary)

export interface GameTeam {
  id: string;
  name: string;
  short: string;
  abbr: string;
  logo: string | null;
  color: string;
  score: string;
  winner: boolean;
  record: string | null;
  // its score by period (the innings', the quarters', the periods' and overtime)
  periods: string[];
}

export interface GameLeader {
  category: string;
  name: string;
  short: string;
  line: string;
  headshot: string | null;
}

export interface GameTeamStat {
  label: string;
  away: string;
  home: string;
  // (each side's share of the two, for the bar: null when it isn't a number to compare)
  awayShare: number | null;
}

export interface GameBoxGroup {
  // ESPN's name for it ("passing", "rushing"; "batting", "pitching"), for fantasy scoring
  key: string;
  title: string;
  labels: string[];
  rows: { id: string; name: string; short: string; position: string | null; headshot: string | null; starter: boolean; values: string[]; dnp: string | null }[];
  totals: string[] | null;
}

export interface GameFantasy {
  side: 'away' | 'home';
  name: string;
  position: string | null;
  headshot: string | null;
  // his points before catches (the NFL's catches count as the Fantasy Scoring setting says: PPR, half, none),
  // and his catches
  points: number;
  receptions: number;
  // what scored it ("285 pass yds", "2 pass TD", "6 rec")
  parts: string[];
}

// The game's chart: where the shots were (a court's, a rink's), where the balls in play landed (a spray
// chart), or the passes by zone (the NFL's: short or deep, left, middle or right, from the play-by-play)
export interface GameMark {
  // on the chart's own scale: a half court in feet (0-50 across, the rim at 5.25 down), a rink in feet
  // (0-200 across, 0-85 down: away shooting left, home right), a field in Gameday's units (home plate
  // at 125, 200)
  x: number;
  y: number;
  side: 'away' | 'home';
  // made, missed (or blocked), a goal; a hit, a home run, an out
  result: 'made' | 'missed' | 'goal' | 'hit' | 'hr' | 'out';
  text: string;
  // the shooter's, or the batter's, name (the chart's player filter)
  player: string | null;
}

export interface GamePassZone {
  key: string;
  att: number;
  comp: number;
  yds: number;
  td: number;
  int: number;
}

// A pitch where it crossed the plate (the catcher's view, on Gameday's scale: the zone about 90-150
// across, 147-199 down), by whom, its type and speed
export interface GamePitch {
  x: number;
  y: number;
  // the pitching team's side
  side: 'away' | 'home';
  pitcher: string;
  type: string;
  mph: number | null;
  result: 'ball' | 'strike' | 'play';
}

// A pitcher's arsenal: his pitches, each type's share and average speed, most-thrown first
export interface GameArsenal {
  side: 'away' | 'home';
  pitcher: string;
  pitches: number;
  types: { type: string; share: number; mph: number | null }[];
}

export type GameChart =
  | { kind: 'court' | 'rink'; marks: GameMark[] }
  | { kind: 'diamond'; marks: GameMark[]; pitches: GamePitch[]; arsenals: GameArsenal[] }
  | { kind: 'football'; drives: GameDrive[]; teams: { side: 'away' | 'home'; passers: string[]; zones: GamePassZone[] }[] };

// A drive on the field: where it started and ended (0 the home team's goal line, 100 the away team's)
export interface GameDrive {
  side: 'away' | 'home';
  // the quarter it started in (5 on: overtime)
  quarter: number;
  start: number;
  end: number;
  result: string;
  scoring: boolean;
  label: string;
}

export interface GamePlay {
  clock: string | null;
  text: string;
  score: string | null;
  scoring: boolean;
  // its team's side: 'away' or 'home' (the tint), when it's known
  side: 'away' | 'home' | null;
  // the kind (a goal, a penalty, a home run...), for the filter
  kind: string | null;
  // a scoring play's scorer's headshot and name (the shooter, the goal scorer, the batter; the NFL's from its
  // text)
  headshot: string | null;
  scorer: string | null;
}

export interface GamePlayGroup {
  title: string;
  // (a drive's summary and its result: "8 plays, 75 yards, 4:12" / "Touchdown")
  sub: string | null;
  result: string | null;
  side: 'away' | 'home' | null;
  logo: string | null;
  scoring: boolean;
  plays: GamePlay[];
}

// A video of the game: a file to play, or a YouTube video to embed (the NFL's)
export interface GameVideo {
  title: string;
  src: string | null;
  youtube: string | null;
  thumb: string | null;
  // (seconds)
  duration: number | null;
}

export interface GameView {
  id: string;
  league: string;
  date: string;
  // the season it was in (ESPN's: the site's numbering, a season named by the year it ends in)
  seasonYear: number | null;
  // not played yet: a preview (the line, the predictor, the injuries, each team's form; no score or plays)
  preview: boolean;
  // (a preview's: ESPN's matchup predictor, each team's chance to win, 0-1)
  predictor: { away: number; home: number } | null;
  injuries: { side: 'away' | 'home'; rows: { name: string; position: string | null; status: string; detail: string | null; headshot: string | null }[] }[];
  // each team's last five games, newest first (ESPN's: each opens its game)
  form: { side: 'away' | 'home'; games: { event: string; result: string; score: string; vs: string; logo: string | null }[] }[];
  broadcast: string | null;
  // "Final", "Final/OT"
  status: string;
  // "Week 5", "Wild Card", "World Series - Game 3"
  label: string | null;
  away: GameTeam;
  home: GameTeam;
  periodLabels: string[];
  venue: { name: string; city: string | null; state: string | null; image: string | null; grass: boolean | null; roof: 'indoors' | 'retractable' | 'outdoors' } | null;
  attendance: number | null;
  officials: { name: string; role: string | null }[];
  duration: string | null;
  // the line before the game, and how the game came out against it
  line: { book: string | null; details: string; overUnder: number | null; spread: string | null; total: string | null } | null;
  // the home team's chance to win after each play (0-1), when ESPN has it
  winProbability: number[] | null;
  leaders: { side: 'away' | 'home'; rows: GameLeader[] }[];
  teamStats: GameTeamStat[];
  box: { side: 'away' | 'home'; groups: GameBoxGroup[] }[];
  // the chart (none when the play-by-play doesn't place anything)
  chart: GameChart | null;
  // each player's fantasy points from his line, best first (the component scores catches by the setting)
  fantasy: GameFantasy[];
  plays: GamePlayGroup[];
  // its videos in ESPN's summary (the game's highlights first; most games have none: highlights.ts looks
  // elsewhere)
  videos: GameVideo[];
}
