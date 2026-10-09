// ESPN's game summary (site.api.espn.com/.../summary?event=), the parts the game view reads, and the
// small readers its modules share

export interface EspnTeamRef {
  id: string;
  alternateColor?: string;
  abbreviation?: string;
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  color?: string;
  logos?: { href: string }[];
  logo?: string;
}
export interface EspnAthlete {
  id?: string;
  displayName?: string;
  shortName?: string;
  headshot?: { href?: string } | string;
  position?: { abbreviation?: string };
}
export interface EspnPlay {
  id?: string;
  type?: { text?: string; type?: string; abbreviation?: string };
  text?: string;
  awayScore?: number;
  homeScore?: number;
  period?: { number?: number; displayValue?: string; type?: string };
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  shootingPlay?: boolean;
  participants?: { type?: string; athlete?: { id?: string } }[];
  atBatId?: string;
  alternativeType?: { text?: string };
  pitchCoordinate?: { x?: number; y?: number };
  pitchType?: { text?: string };
  pitchVelocity?: number;
  coordinate?: { x?: number; y?: number };
  hitCoordinate?: { x?: number; y?: number };
  team?: { id?: string };
}
export interface EspnSummary {
  // (the game's videos, a few days after it: the NBA's and the NHL's highlights)
  videos?: { headline?: string; duration?: number; thumbnail?: string; links?: { source?: { href?: string } } }[];
  header?: {
    week?: number;
    season?: { year?: number; type?: number };
    gameNote?: string;
    competitions?: {
      date?: string;
      neutralSite?: boolean;
      status?: { type?: { detail?: string; shortDetail?: string; description?: string; completed?: boolean; state?: string } };
      broadcasts?: { media?: { shortName?: string } }[];
      competitors?: {
        homeAway: 'home' | 'away';
        winner?: boolean;
        score?: string;
        team: EspnTeamRef;
        record?: { type?: string; summary?: string; displayValue?: string }[];
        linescores?: { displayValue?: string }[];
      }[];
    }[];
  };
  gameInfo?: {
    venue?: { fullName?: string; address?: { city?: string; state?: string }; grass?: boolean; images?: { href?: string }[] };
    attendance?: number;
    officials?: { displayName?: string; position?: { displayName?: string } }[];
    gameDuration?: string;
  };
  pickcenter?: {
    provider?: { name?: string };
    details?: string;
    overUnder?: number;
    spread?: number;
    homeTeamOdds?: { favorite?: boolean };
    awayTeamOdds?: { favorite?: boolean };
  }[];
  winprobability?: { homeWinPercentage?: number }[];
  predictor?: { homeTeam?: { id?: string; gameProjection?: string }; awayTeam?: { id?: string; gameProjection?: string } };
  injuries?: {
    team?: { id?: string };
    injuries?: { status?: string; athlete?: EspnAthlete; details?: { type?: string; detail?: string; returnDate?: string } }[];
  }[];
  lastFiveGames?: {
    team?: { id?: string };
    events?: {
      id?: string;
      gameResult?: string;
      week?: number;
      gameDate?: string;
      homeTeamScore?: string;
      awayTeamScore?: string;
      atVs?: string;
      opponent?: { abbreviation?: string; logo?: string };
      opponentLogo?: string;
    }[];
  }[];
  leaders?: { team?: { id?: string }; leaders?: { displayName?: string; leaders?: { displayValue?: string; athlete?: EspnAthlete }[] }[] }[];
  boxscore?: {
    teams?: { team?: { id?: string }; statistics?: { name?: string; label?: string; displayName?: string; abbreviation?: string; displayValue?: string; stats?: { abbreviation?: string; displayName?: string; displayValue?: string }[] }[] }[];
    players?: {
      team?: { id?: string };
      statistics?: {
        name?: string;
        text?: string;
        type?: string;
        labels?: string[];
        totals?: string[];
        athletes?: { athlete?: EspnAthlete; starter?: boolean; didNotPlay?: boolean; reason?: string; stats?: string[] }[];
      }[];
    }[];
  };
  plays?: EspnPlay[];
  drives?: {
    previous?: {
      description?: string;
      displayResult?: string;
      result?: string;
      isScore?: boolean;
      team?: EspnTeamRef;
      start?: { period?: { number?: number }; clock?: { displayValue?: string }; yardLine?: number };
      end?: { yardLine?: number };
      yards?: number;
      offensivePlays?: number;
      plays?: EspnPlay[];
    }[];
  };
}

// (the away team's first, as the score reads)
export const awayFirst = (a: { side: 'away' | 'home' | null }, b: { side: 'away' | 'home' | null }): number => (a.side === b.side ? 0 : a.side === 'away' ? -1 : 1);
export const headshotOf = (a: EspnAthlete | undefined): string | null => (typeof a?.headshot === 'string' ? a.headshot : (a?.headshot?.href ?? null));
export const logoOf = (t: EspnTeamRef | undefined): string | null => t?.logos?.[0]?.href ?? t?.logo ?? null;
export const numberOf = (text: string): number | null => {
  const m = text.match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
