import { Observable, EMPTY, combineLatest, distinctUntilChanged, map, merge, shareReplay, tap } from 'rxjs';
import type { EngineHost, ValueContext } from '@ranker/engine/sport';
import type { SkillPlayer } from '@sport/positions';
import { SPORT } from '@sport/sport';

// Roster grades for a sport's Teams tab (SPORT.rosterGrades): how good a team's players are at a
// position group by YOUR rankings of them. Every player is graded by his spot on his own tab's ranking
// as last shown (#1 = 12, last = 0; sliders and drags included), the grades are averaged per team
// weighted by playing time (minutes, ice time, plate appearances...), and the teams are curved: the
// best group is an A+, the worst an F. Move a slider on a position tab and the Teams tab moves with it.
export interface RosterGrade {
  // The stat key on the Teams tab
  key: string;
  // The tabs the group is drawn from (the NHL's forwards: C, LW, RW)
  positions: string[];
  // A player's playing time, his weight in the team's grade
  usage: (player: SkillPlayer) => number;
}

// key -> team logo -> grade (0-12)
const grades = new Map<string, Map<string, number>>();

const curve = (scores: Map<string, number>): Map<string, number> => {
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map(([team], rank) => [team, 12 * (1 - rank / last)]));
};

function gradesFor(def: RosterGrade, lists: SkillPlayer[][]): Map<string, number> {
  const totals = new Map<string, { sum: number; usage: number }>();
  for (const list of lists) {
    const last = Math.max(list.length - 1, 1);
    list.forEach((player, rank) => {
      const weight = def.usage(player);
      if (!weight) return;
      const t = totals.get(player.teamLogo) ?? { sum: 0, usage: 0 };
      totals.set(player.teamLogo, { sum: t.sum + 12 * (1 - rank / last) * weight, usage: t.usage + weight });
    });
  }
  return curve(new Map([...totals].map(([team, t]) => [team, t.sum / t.usage])));
}

// Kept current from the tabs' rankings (hooked up once, with SPORT.connect): fires when a grade changes
export function connectRosterGrades(host: EngineHost): Observable<unknown> {
  const defs = SPORT.rosterGrades ?? [];
  if (!defs.length) return EMPTY;
  return merge(
    ...defs.map((def) =>
      combineLatest(def.positions.map((position) => host.rankedUnits(position))).pipe(
        map((lists) => gradesFor(def, lists)),
        distinctUntilChanged((a, b) => a.size === b.size && [...a].every(([team, grade]) => b.get(team) === grade)),
        tap((next) => grades.set(def.key, next)),
        shareReplay({ bufferSize: 1, refCount: false }),
      ),
    ),
  );
}

// A roster grade's value for a team row (undefined: not a roster grade). The table's season only:
// another season's card, or a default ranking, counts it as average (null)
export function rosterGradeValue(unit: SkillPlayer, key: string, context: ValueContext): number | null | undefined {
  if (!SPORT.rosterGrades?.some((def) => def.key === key)) return undefined;
  if (context.defaults || !context.tableSeason) return null;
  const grade = grades.get(key)?.get(unit.teamLogo);
  return grade === undefined ? null : Math.round(grade);
}
