// The player card's data (click a name): built by player-cards.ts, drawn by the player card component
import { SkillPlayer, SkillPosition } from '@sport/positions';
import { AwardWin } from '@sport/awards';
import { CardFlag } from '@ranker/engine/sport';
import { CardSkill } from '@ranker/engine/skills';

export type { CardFlag, CardSkill };

export type CardTab = 'overview' | 'analysis' | 'stats' | 'seasons' | 'history' | 'games' | 'depth' | 'zones';

// A stat's value, where it ranks in the list and how that compares
export interface CardStat {
  key: string;
  // Its stat group (the tile's sideline color)
  group: string;
  label: string;
  name: string;
  display: string;
  // Recent: the last five results as dots instead of a number
  dots?: number[];
  rank: number | null;
  tied: boolean;
  of: number;
  // 0 (last) to 1 (first) in the list
  pct: number | null;
  avg: string | null;
  // Counts in the strengths / weak spots (not display-only stats or the team's support around them)
  trait: boolean;
  // The value's color when the Color-Coded Values setting is on (as in the table), else null
  tint: string | null;
}

// The radar: an axis per skill (line end, label spot), rings, and the shapes (this season, and last
// season's as a ghost once it loads)
export interface CardRadar {
  axes: { x: number; y: number; lx: number; ly: number; anchor: string; label: string; pct: number }[];
  rings: string[];
  shape: string;
  dots: { x: number; y: number; pct: number }[];
}

export interface CardOverview {
  archetype: string;
  blurb: string;
  skills: CardSkill[];
  // Every skill, best first: strengths, then average, then weaknesses
  report: { title: string; tone: 'good' | 'mid' | 'bad'; icon: string; list: CardSkill[] }[];
  flags: CardFlag[];
  radar: CardRadar;
  // Last season's skills (for the radar's ghost and the trend flags), once loaded
  prev: { season: number; shape: string; pcts: Map<string, number> } | null;
  // The archetype came from run blocking (a complete or blocking tight end)
  blockingArchetype?: boolean;
}

// One season of a career, for the Overview's history: where they ranked and their skills
export interface CareerSeason {
  season: number;
  rank: number;
  of: number;
  pct: number;
  skills: CardSkill[];
  archetype: string;
}

// A similar season
export interface CardComp {
  season: number;
  gsisId: string;
  name: string;
  // 0-100
  match: number;
  logo: string;
  color: string;
  whiteLogo: boolean;
  // The headshot's id, and its URL
  espnId: number | null;
  photo: string | null;
}

// A season on the Seasons tab: team, games, rank with the default sliders, headline stats
export interface CardSeason {
  season: number;
  // The team's logo as it looked that season, and the team's own logo path (its key)
  logo: string;
  teamLogo: string;
  games: number;
  rank: number;
  of: number;
  // 0 (last) to 1 (first)
  pct: number;
  // The headline stats: shown value, label, and how it compares across their seasons (share of their
  // best, and whether this is their best)
  stats: { text: string; label: string; value: number | null; share: number; best: boolean; tint?: string | null }[];
  // Ranked with the current sliders (or that season's dragged order) yet; until then, the default rank
  yours?: boolean;
}

// A season other than the table's, for its cards: its rows, its list (ranked with the current sliders,
// or as dragged by hand this visit) and the stats it didn't record
export interface SeasonContext {
  season: number;
  rows: Record<SkillPosition, SkillPlayer[]>;
  list: SkillPlayer[];
  empty: (key: string) => boolean;
  // The list is that season's hand-dragged order
  manual?: boolean;
  // The tab it's for, when not the table's (a card opened from a roster or the hero's team name)
  position?: SkillPosition;
}

export interface PlayerCard {
  player: SkillPlayer;
  season: number;
  // The list it's ranked in (the table's, or that season's), and that season when it isn't the table's
  list: SkillPlayer[];
  context: SeasonContext | null;
  // Every season they're in (null while loading), and their similar seasons (null: not for this season)
  seasons: CardSeason[] | null;
  // The Seasons tab's re-ranking has started
  careerRanked?: boolean;
  comps: CardComp[] | null;
  name: string;
  positionName: string;
  // the hero's: a player's position short ("QB", "SP"); a team unit's or a coach's in full
  positionLabel: string;
  seasonLabel: string;
  teamName: string | null;
  // The team's own card that season, when the site has it (the hero's team name a link to it)
  teamLink: { position: string; gsisId: string } | null;
  logo: string;
  color: string;
  // the hero's background: the team's color as the game view draws it (ESPN's, made to read), once it's in
  heroColor?: string | null;
  whiteLogo: boolean;
  photo: string | null;
  rank: number;
  of: number;
  awards: AwardWin[];
  groups: { id: string; title: string; icon: string; stats: CardStat[] }[];
  overview: CardOverview;
}

// Built by scripts/build-comps.mjs: per position, id -> [season, id, name, ESPN id, team, match]
// (comps.json), and id -> [season, team, games, rank, of, headline stats] for every finished season
// (careers.json)
export type CompsFile = Partial<Record<SkillPosition, Record<string, [number, string, string, number | null, string, number][]>>>;
export type CareersFile = Partial<
  Record<SkillPosition, Record<string, [number, string, number, number, number, (number | null)[]][]>>
>;
