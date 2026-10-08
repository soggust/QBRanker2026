// The card's Depth Chart tab (a team's: SPORT.depthChart), as the sport lays it out: each side's
// formation on a field (every slot placed by the sport, its starter and the ones behind him), the special
// teams, who's played this season, and the starters who've changed. The engine draws it; the sport
// (apps/<sport>/src/sport/depth-chart.ts) builds it from its data.

// A player on the chart or in the usage list
export interface DepthPlayer {
  // his ids (the sport's: the NFL's gsis id, and ESPN's), to find him among the site's players
  id: string;
  espnId: string | null;
  // his card, when the site has him (filled in by the card: player-cards.ts)
  link?: { position: string; gsisId: string } | null;
  name: string;
  // (the chip's short name: "L. Jackson")
  short: string;
  headshot: string | null;
  // his share of his side's snaps this season, 0-1 (null: none yet)
  snaps: number | null;
  games: number;
  // the injury report: "Q", "D", "O", "IR" (and its words), or null
  status: string | null;
  statusText: string | null;
  injury: string | null;
}

// A slot in a formation: where it sits on the field (x and y in percent: x across, y down from the
// side's back line), its label ("LT"), and its players by depth
export interface DepthSlot {
  key: string;
  label: string;
  name: string;
  x: number;
  y: number;
  // (a sub package's spot, like the nickel back: drawn quieter)
  sub?: boolean;
  // (the card's focus: the O-line card's linemen)
  focus?: boolean;
  depth: DepthPlayer[];
}

export interface DepthSide {
  id: 'offense' | 'defense';
  title: string;
  // its set ("3WR 1TE", "Base 3-4")
  set: string | null;
  // the line of scrimmage, y in percent
  los: number;
  slots: DepthSlot[];
  // just a line (an O-Line card's five): a short strip of field
  line?: boolean;
}

// A coach on the staff: his role, and his card when the site has him (a head coach)
export interface DepthCoach {
  role: string;
  name: string;
  link?: { position: string; gsisId: string } | null;
}

export interface DepthCoachGroup {
  title: string;
  rows: DepthCoach[];
}

export interface DepthUsageGroup {
  title: string;
  rows: (DepthPlayer & { pos: string | null; onChart: boolean })[];
}

export interface DepthChange {
  label: string;
  from: DepthPlayer;
  to: DepthPlayer;
  // why, when it's known: its kind (injury, ir, released, traded, retired, inactive, coach, moved: the tag's
  // color), the tag ("Injury", "Coach's Decision"), and the detail ("Out (ankle)", "Moved to C")
  reason: string | null;
  tag: string | null;
  note: string | null;
}

export interface DepthView {
  // when the depth chart was last updated (ISO)
  asOf: string;
  sides: DepthSide[];
  special: { label: string; player: DepthPlayer | null }[];
  usage: DepthUsageGroup[];
  // the season's positional changes, week by week (the weeks with any)
  timeline: { week: number; changes: DepthChange[] }[];
  // the coaching staff, by unit (none when the sport or the season doesn't have it)
  coaches: DepthCoachGroup[];
  teamGames: number;
}
