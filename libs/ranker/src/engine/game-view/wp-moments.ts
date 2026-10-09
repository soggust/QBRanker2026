// The win probability's game time: each point's moment, from its play (ESPN's winprobability entries
// carry the play's id; the plays, or the NFL's drives' plays, its period, clock and score). The chart's
// readout plays them along with the line: "Q3 8:42", "P2 12:10", "OT 3:05", "Top 6th".

import { ordinal } from '@ranker/core/format';
import { EspnPlay, EspnSummary } from './espn-summary';
import { GameMoment } from './game.model';

// A play's moment by name: football's and basketball's quarters ("Q3 8:42", "OT 4:10", "2OT 0:31"),
// hockey's periods ("P2 12:10", "OT 3:05", a regular season's shootout "SO", the playoffs' "2OT"),
// baseball's half innings ("Top 6th", "Bot 9th"); null for a play without its period
export function momentLabel(league: string, play: EspnPlay, playoffs = false): string | null {
  const n = play.period?.number;
  if (!n || n < 1) return null;
  if (league.includes('baseball')) {
    const half = play.period?.type ?? '';
    // (Top, Bot; Mid and End between them)
    const name = /^bot/i.test(half) ? 'Bot' : half ? half.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) : '';
    return `${name} ${ordinal(n)}`.trim();
  }
  const clock = play.clock?.displayValue ?? '';
  const hockey = league.includes('hockey');
  const regulation = hockey ? 3 : 4;
  let period: string;
  if (n <= regulation) period = `${hockey ? 'P' : 'Q'}${n}`;
  else if (hockey && !playoffs && (n > regulation + 1 || /shootout/i.test(play.period?.displayValue ?? ''))) return 'SO';
  else period = n === regulation + 1 ? 'OT' : `${n - regulation}OT`;
  return `${period} ${clock}`.trim();
}

// Each win probability point's moment, in step with game.winProbability: its play's, or the one before's
// where its play can't be found (none before the first found: the NFL's first point, before the kickoff);
// null when no point's play is found at all
export function wpMoments(league: string, s: EspnSummary): (GameMoment | null)[] | null {
  const points = s.winprobability ?? [];
  if (!points.length) return null;
  const plays = new Map<string, EspnPlay>();
  for (const p of s.plays ?? []) if (p.id) plays.set(String(p.id), p);
  for (const d of s.drives?.previous ?? []) for (const p of d.plays ?? []) if (p.id) plays.set(String(p.id), p);
  const playoffs = s.header?.season?.type === 3;
  let last: GameMoment | null = null;
  let found = false;
  const moments = points.map((w) => {
    const play = w.playId !== undefined ? plays.get(String(w.playId)) : undefined;
    const when = play ? momentLabel(league, play, playoffs) : null;
    if (play && when) {
      found = true;
      last = { when, away: play.awayScore ?? last?.away ?? null, home: play.homeScore ?? last?.home ?? null };
    }
    return last;
  });
  return found ? moments : null;
}

// Where the win probability's chart has drawn to, a share of the way across it (0-1; the line and its
// fills sweep open together, a play's worth each step): its head on the chart (1000 by 200, up is home)
// and the point it's nearest
export function lineHead(points: number[], share: number): { x: number; y: number; i: number } {
  const n = points.length;
  if (n < 2) return { x: 0, y: (1 - (points[0] ?? 0.5)) * 200, i: 0 };
  const at = Math.min(1, Math.max(0, share)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(at));
  const t = at - i;
  const p = points[i] + (points[i + 1] - points[i]) * t;
  return { x: (at / (n - 1)) * 1000, y: (1 - p) * 200, i: Math.round(at) };
}
