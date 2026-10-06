// The card's Analysis tab: an AI write-up of a player's season, the coming game, the rest of the season and
// any betting angles (written nightly by the sport's analysis script, from his numbers only: e.g.
// apps/nfl/scripts/analysis). The site reads the index of who has one, then a player's file when the tab
// opens.

// A number behind a point: its name, the value, its rank in the position this season (when ranked)
export interface AnalysisEvidence {
  label: string;
  value: number | string;
  rank?: number;
  of?: number;
}
export interface AnalysisPoint {
  title: string;
  body: string;
  evidence: AnalysisEvidence[];
}
export interface AnalysisBet {
  market: string;
  lean: string;
  // like (green): solid; lean (yellow): slight; fade (red): the side to go against (an older report's
  // strong reads as like)
  strength: 'fade' | 'lean' | 'like' | 'strong';
  reason: string;
}
export interface PlayerAnalysis {
  // when it was written, and by what
  at: string;
  model: string;
  // the game it previews: the week, the opponent, home or away, the sportsbook's line when posted
  game: { week: number; date: string; opp: string; at: 'home' | 'away'; line: { line: string; overUnder: number | null; hisTeamMoneyline: string | null; book: string | null } | null } | null;
  report: {
    archetype: { name: string; definition: string };
    headline: string;
    take: string;
    strengths: AnalysisPoint[];
    concerns: AnalysisPoint[];
    trend: { direction: 'rising' | 'falling' | 'steady' | 'volatile'; note: string };
    nextGame: { outlook: 'favorable' | 'tough' | 'neutral'; headline: string; body: string; keyMatchups: AnalysisPoint[]; watch: string };
    restOfSeason: { body: string; projections: { stat: string; low: number; high: number }[]; swingFactors: string[] };
    bets: AnalysisBet[];
    confidence: { level: 'low' | 'medium' | 'high'; note: string };
  };
}

// The written-up players: row id -> its file (loaded once a visit; empty when there are none)
let index: Promise<Record<string, string>> | null = null;
export function analysisIndex(): Promise<Record<string, string>> {
  index ??= fetch('data/analysis/index.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return index;
}

export async function loadAnalysis(file: string): Promise<PlayerAnalysis> {
  const res = await fetch(`data/analysis/${file}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// A text's paragraphs (split on blank lines)
export const paragraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

// An evidence value as shown: ".363" for small rates, "10.74", "967"
export function evidenceText(value: number | string): string {
  if (typeof value !== 'number') return value;
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  if (Math.abs(value) < 1) return value.toFixed(3).replace(/^(-?)0\./, '$1.');
  return String(Math.round(value * 100) / 100);
}
