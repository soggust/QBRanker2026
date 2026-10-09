import type { CardBreakdown, CardFlag } from '@ranker/engine/sport';
import { tintFrom, tintScale } from '@ranker/core/value-tint';
import type { SkillPlayer } from './positions';

// A team's card: vs Position (SportConfig.cardBreakdown). What it allowed to opposing forwards and
// defensemen a game, against those players' own averages in their other games, and the share of the
// points against it from defensemen: the team's vsPos (scripts/vs-position.mjs, on its coaches' rows and
// taken onto the Teams tab's row), every season's own. Display only: nothing in the ranking reads it.

type Role = 'F' | 'D';
interface RoleLine {
  goals: number | null;
  pts: number | null;
  shots: number | null;
  exp: number | null;
  vs: number | null;
  rank: number | null;
}
export type NhlVsPos = { games: number; F: RoleLine; D: RoleLine; share: { D: number | null; lg: number | null } };

export const nhlVsPosOf = (row: SkillPlayer): NhlVsPos | null => (row as { vsPos?: NhlVsPos | null }).vsPos ?? null;

const ROLE_INFO: Record<Role, { label: string; plural: string; title: string }> = {
  F: { label: 'Forwards', plural: 'forwards', title: "Every opposing center and winger: their goals, points and shots against this team a game" },
  D: { label: 'Defense', plural: 'defensemen', title: 'Every opposing defenseman: their goals, points and shots against this team a game' },
};

const signed = (v: number, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function nhlVsPositionBreakdown(player: SkillPlayer, position: string, rows: SkillPlayer[]): CardBreakdown | null {
  const vs = position === 'TM' ? nhlVsPosOf(player) : null;
  if (!vs || !vs.games) return null;
  const of = Math.max(rows.filter((r) => nhlVsPosOf(r)).length, vs.F.rank ?? 0, vs.D.rank ?? 0);
  const roles: Role[] = ['F', 'D'];
  // (each value tinted as the grid tints its columns: green the further under the other teams' average, red
  // the further over; less allowed is better)
  const tint = (role: Role, key: 'pts' | 'shots' | 'vs', value: number | null) =>
    value === null ? null : tintFrom(value, tintScale(rows.map((r) => (nhlVsPosOf(r)?.[role]?.[key] as number | null | undefined) ?? null)), true);
  const tableRows = roles.map((role) => {
    const line = vs[role];
    return {
      label: ROLE_INFO[role].label,
      title: ROLE_INFO[role].title,
      cells: [
        { text: line.pts !== null ? line.pts.toFixed(2) : '-', color: tint(role, 'pts', line.pts), title: line.goals !== null ? `${line.goals} goals and ${line.pts} points a game` : '' },
        { text: line.shots !== null ? line.shots.toFixed(1) : '-', color: tint(role, 'shots', line.shots), title: 'Shots on goal a game' },
        {
          text: line.vs !== null ? signed(line.vs) : '-',
          color: tint(role, 'vs', line.vs),
          title: line.exp !== null ? `${line.pts} points a game, against the ${line.exp} these ${ROLE_INFO[role].plural} averaged in their other games` : '',
        },
      ],
      rank: line.rank,
      of,
    };
  });


  const flags: CardFlag[] = [];
  const { D: share, lg } = vs.share;
  if (share !== null && lg !== null && Math.abs(share - lg) >= 0.03) {
    flags.push({
      icon: 'track_changes',
      tone: 'info',
      text: `Defensemen get ${pct(share)} of the points against it (league ${pct(lg)}): ${share > lg ? 'its blue line gets activated against' : 'the forwards do the damage'}`,
    });
  }
  return {
    title: 'vs Position',
    icon: 'person_search',
    help: "What this team allowed to opposing forwards and defensemen, a game, and against what those same skaters averaged in their other games: holding a top line under its usual output reads as good defense. Skaters the site doesn't list (a few games' call-ups) aren't counted.",
    note: share !== null && lg !== null ? `Defensemen's share of the points against it: ${pct(share)} (league ${pct(lg)})` : null,
    flags,
    columns: [
      { label: 'Pts / G', title: 'Points the group scored a game against this team' },
      { label: 'Shots / G', title: 'Shots on goal a game' },
      { label: 'vs Avg', title: 'Points a game against what those same skaters averaged in their other games (below zero: held under their norm)' },
    ],
    rows: tableRows,
    split: null,
  };
}
