import type { EngineHost, SportSettings, ValueContext } from '@ranker/engine/sport';
import { Observable, combineLatest, distinctUntilChanged, map, merge, shareReplay } from 'rxjs';
import {
  FantasyScoring,
  RANK_METRICS,
  RankBasis,
  SkillPlayer,
  SkillPosition,
  SkillStat,
  SkillStatKey,
  fantasyPoints,
  unitStat,
} from '@sport/positions';
import { dataWeight, preseasonCoaching, preseasonOline, preseasonWeapons, teamGamesPlayed } from '@sport/qb-rows';

// The NFL's values worked out in the app (SPORT.computedValue): fantasy points in the chosen scoring,
// the head coaches' league ranks, and the team grades each tab gets from the others' rankings (a
// better O-line on the Offensive Lines tab is a better O-line grade on every tab).

// ---------------------------------------------------------------------------
// League ranks (1 = best) for the head coaches' offense and defense, on the stat the Unit Ranks
// setting picks. Ties share a rank. Worked out once per season's rows and setting.
// ---------------------------------------------------------------------------
export type UnitRankKey = keyof typeof RANK_METRICS;

function unitRanks(units: SkillPlayer[], settings: SportSettings): Map<SkillPlayer, Record<UnitRankKey, number | null>> {
  const basis = settings['rankBasis'] as RankBasis;
  const ranks = new Map(units.map((unit) => [unit, { offRank: null, defRank: null } as Record<UnitRankKey, number | null>]));
  for (const key of Object.keys(RANK_METRICS) as UnitRankKey[]) {
    const [stat, higherIsBetter] = RANK_METRICS[key][basis];
    const values = units.map((unit) => unitStat(unit, stat, settings));
    units.forEach((unit, i) => {
      const v = values[i];
      if (v === null || v === undefined) return;
      const better = values.filter((o) => o !== null && o !== undefined && (higherIsBetter ? o > v : o < v)).length;
      ranks.get(unit)![key] = better + 1;
    });
  }
  return ranks;
}

const rankCache = new WeakMap<SkillPlayer[], Map<string, Map<SkillPlayer, Record<UnitRankKey, number | null>>>>();

function rankOf(player: SkillPlayer, key: UnitRankKey, units: SkillPlayer[], settings: SportSettings): number | null {
  let bySetting = rankCache.get(units);
  if (!bySetting) rankCache.set(units, (bySetting = new Map()));
  const settingKey = `${settings['rankBasis']}.${settings['garbageTime']}`;
  let ranks = bySetting.get(settingKey);
  if (!ranks) bySetting.set(settingKey, (ranks = unitRanks(units, settings)));
  return ranks.get(player)?.[key] ?? null;
}

// ---------------------------------------------------------------------------
// Team grades (0-12) from the tabs' rankings, as last shown (drags included; the default slider
// ranking before a tab has been opened). Each tab only re-sorts while it's on screen, so they can feed
// each other without looping.
// ---------------------------------------------------------------------------

// Team grades from a ranked list: #1 grades 12 (A+), last grades 0 (F)
function gradesByRank(ranked: { teamLogo: string }[]): Map<string, number> {
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map((unit, rank) => [unit.teamLogo, 12 * (1 - rank / last)]));
}

// Grades on a curve: highest score grades 12 (A+), lowest 0 (F), the rest spread evenly by rank.
// Used for every support grade, so each always runs the full F to A+ range.
function curveGrades<K>(scores: Map<K, number>): Map<K, number> {
  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const last = Math.max(ranked.length - 1, 1);
  return new Map(ranked.map(([key], rank) => [key, 12 * (1 - rank / last)]));
}

// Only emit when some team's grade actually changed; shared so every tab sees the same grades
function distinctGrades() {
  return (source: Observable<Map<string, number>>) =>
    source.pipe(
      distinctUntilChanged<Map<string, number>>(
        (a, b) => a.size === b.size && [...a].every(([team, grade]) => b.get(team) === grade),
      ),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
}

// A team grade for one position from its ranked list: each player graded by his spot (#1 = 12,
// last = 0), averaged per team weighted by usage (carries, targets...)
function teamGradesByUsage(ranked: SkillPlayer[], usage: (player: SkillPlayer) => number): Map<string, number> {
  const last = Math.max(ranked.length - 1, 1);
  const totals = new Map<string, { sum: number; usage: number }>();
  ranked.forEach((player, rank) => {
    const weight = usage(player);
    if (!weight) return;
    const total = totals.get(player.teamLogo) ?? { sum: 0, usage: 0 };
    totals.set(player.teamLogo, { sum: total.sum + 12 * (1 - rank / last) * weight, usage: total.usage + weight });
  });
  return new Map([...totals].map(([team, { sum, usage }]) => [team, sum / usage]));
}

// A receiver's targets, or his catches in the seasons that didn't record targets (2003-2008)
const looks = (p: SkillPlayer) => p.stats.targets ?? p.stats.receptions ?? 0;

// How much each position counts toward a team's weapons grade (receivers lead: it's mostly about
// who the QB throws to). A team missing a position splits its share among the others.
const WEAPONS_SHARES: [SkillPosition, number, (player: SkillPlayer) => number][] = [
  ['WR', 0.5, (p) => looks(p)],
  ['RB', 0.3, (p) => (p.stats.carries ?? 0) + looks(p)],
  ['TE', 0.2, (p) => looks(p)],
];

// The O-line grade's two leans, from the Offensive Lines tab's sliders: for QBs pass protection counts
// five times run blocking, for RBs the reverse (penalties count the same either way); head coaches
// get the balanced grade. OLINE_LEAN: which, by tab (the column reads "O-Line (Pass)").
// The pass lean leans on the per-dropback stats; total sacks stay at their usual weight, since a team
// that runs a lot drops back less and gives up fewer whatever its line.
const PASS_PRO = ['qbHitRate', 'pressureRate', 'sackRate', 'timeToThrow'];
const PASS_TOTALS = ['sacksAllowed'];
const RUN_BLOCKING = ['ypc', 'stuffRate', 'shortYardagePct', 'runEpa', 'runSuccess', 'yardsBeforeContact'];
const lean = (more: string[], less: string[]) =>
  Object.fromEntries([...more.map((key) => [key, 1.5]), ...less.map((key) => [key, 0.3])]);
const PASS_LEAN = lean(PASS_PRO, RUN_BLOCKING);
const RUN_LEAN = lean(RUN_BLOCKING, [...PASS_PRO, ...PASS_TOTALS]);
export const OLINE_LEAN: Record<string, 'Pass' | 'Run'> = { QB: 'Pass', RB: 'Run' };

// The grades every tab reads (team logo -> 0-12), kept current by connectTeamGrades
let defenseGrades = new Map<string, number>();
let qbPlayGrades = new Map<string, number>();
let rbPlayGrades = new Map<string, number>();
// Preseason blended with the Offensive Lines / RB, WR and TE / Head Coaches rankings, then curved
let olineCurve = new Map<string, number>();
let olinePassCurve = new Map<string, number>();
let olineRunCurve = new Map<string, number>();
let weaponsCurve = new Map<string, number>();
let coachingCurve = new Map<string, number>();

// SPORT.connect: the grade streams from the engine's rankings, subscribed once at startup (before any
// page, so the grades are current when the pages hear about a change). Fires when any grade changes.
export function connectTeamGrades(host: EngineHost): Observable<unknown> {
  const ranked = (position: SkillPosition) => host.rankedUnits(position);
  const teamGradesFrom = (position: 'DEF' | 'HC' | 'OL') => ranked(position).pipe(map(gradesByRank), distinctGrades());

  // Every team in the loaded season (logo path), for grades that cover the whole league (31 teams
  // before 2002)
  const allTeams = () => (host.rows()['DEF'] ?? []).map((unit) => unit.teamLogo);

  // A team grade that starts from preseason: each team's preseason grade blended with this season's
  // grade (leaning on this season more with every game played), then curved so the best team is an
  // A+ and the worst an F
  const blendedCurve = (preseason: (team: string) => number, season: Map<string, number>): Map<string, number> =>
    curveGrades(
      new Map(
        allTeams().map((team) => {
          const start = preseason(team);
          const now = season.get(team);
          return [team, now === undefined ? start : start + (now - start) * dataWeight(teamGamesPlayed(team))];
        }),
      ),
    );

  const defense$ = teamGradesFrom('DEF');
  const coaching$ = teamGradesFrom('HC');
  const oline$ = teamGradesFrom('OL');
  const olinePass$ = host.rankedUnits('OL', PASS_LEAN).pipe(map(gradesByRank), distinctGrades());
  const olineRun$ = host.rankedUnits('OL', RUN_LEAN).pipe(map(gradesByRank), distinctGrades());

  // QB Play: each QB graded by his spot in the QB rankings (#1 = 12, last = 0), averaged per team by
  // his starts there, then curved
  const qbPlay$ = ranked('QB').pipe(
    map((list) => {
      const last = Math.max(list.length - 1, 1);
      const totals = new Map<string, { sum: number; starts: number }>();
      list.forEach((qb, rank) => {
        for (const [team, starts] of Object.entries(qb.starts ?? {})) {
          const total = totals.get(team) ?? { sum: 0, starts: 0 };
          totals.set(team, { sum: total.sum + 12 * (1 - rank / last) * starts, starts: total.starts + starts });
        }
      });
      return curveGrades(new Map([...totals].map(([team, { sum, starts }]) => [team, sum / starts])));
    }),
    distinctGrades(),
  );

  // RB Play: each back graded by his spot in the RB rankings, averaged per team weighted by carries,
  // so the lead back counts most
  const rbPlay$ = ranked('RB').pipe(
    map((list) => curveGrades(teamGradesByUsage(list, (rb) => rb.stats.carries ?? 0))),
    distinctGrades(),
  );

  // Weapons from this season: the team's RBs, WRs and TEs graded by the RB / WR / TE tabs' orders
  // (by usage within each position), combined by WEAPONS_SHARES; blended with preseason below
  const weapons$ = combineLatest(WEAPONS_SHARES.map(([position]) => ranked(position))).pipe(
    map((lists) => {
      const byPosition = lists.map((list, i) => teamGradesByUsage(list, WEAPONS_SHARES[i][2]));
      const teams = new Set(byPosition.flatMap((grades) => [...grades.keys()]));
      return new Map(
        [...teams].map((team) => {
          let sum = 0;
          let shares = 0;
          byPosition.forEach((grades, i) => {
            const grade = grades.get(team);
            if (grade === undefined) return;
            sum += grade * WEAPONS_SHARES[i][1];
            shares += WEAPONS_SHARES[i][1];
          });
          return [team, sum / shares];
        }),
      );
    }),
    distinctGrades(),
  );

  oline$.subscribe((grades) => (olineCurve = blendedCurve(preseasonOline, grades)));
  olinePass$.subscribe((grades) => (olinePassCurve = blendedCurve(preseasonOline, grades)));
  olineRun$.subscribe((grades) => (olineRunCurve = blendedCurve(preseasonOline, grades)));
  weapons$.subscribe((grades) => (weaponsCurve = blendedCurve(preseasonWeapons, grades)));
  coaching$.subscribe((grades) => (coachingCurve = blendedCurve(preseasonCoaching, grades)));
  defense$.subscribe((grades) => (defenseGrades = grades));
  qbPlay$.subscribe((grades) => (qbPlayGrades = grades));
  rbPlay$.subscribe((grades) => (rbPlayGrades = grades));
  return merge(defense$, coaching$, qbPlay$, oline$, olinePass$, olineRun$, weapons$, rbPlay$);
}

// The grades from other tabs (support stats but a QB's own Responsibility, and the Teams tab's roster
// grades, the same grades as the team's own strengths): the table's season only
const TEAM_GRADES = new Set(['qbPlay', 'rbPlay', 'weapons', 'oline', 'defense', 'coaching']);
export function fromOtherTabs(stat: SkillStat): boolean {
  return (!!stat.support && stat.key !== 'responsibility') || TEAM_GRADES.has(stat.key);
}

// SPORT.computedValue: fantasy points, unit ranks and team grades; undefined reads the data
export function computedValue(player: SkillPlayer, stat: SkillStat, context: ValueContext): number | null | undefined {
  const { settings } = context;
  switch (stat.key) {
    // (a default ranking scores PPR)
    case 'fantasy': {
      const scoring = (context.defaults ? 'ppr' : settings['fantasyScoring']) as FantasyScoring;
      return fantasyPoints(player.stats.fantasyStd ?? 0, player.stats.receptions ?? 0, scoring);
    }
    case 'offRank':
    case 'defRank':
      return rankOf(player, stat.key, context.rows[context.position] ?? [], settings);
  }
  if (!fromOtherTabs(stat)) return undefined;
  // Another season's card, or a default ranking: grades from other tabs count as average
  if (context.defaults || !context.tableSeason) return null;
  const team = player.teamLogo;
  switch (stat.key) {
    // (a QB's leans on pass protection, a back's on run blocking)
    case 'oline': {
      const lean = OLINE_LEAN[context.position];
      const curve = lean === 'Pass' ? olinePassCurve : lean === 'Run' ? olineRunCurve : olineCurve;
      return Math.round(curve.get(team) ?? 6);
    }
    case 'weapons':
      return Math.round(weaponsCurve.get(team) ?? 6);
    case 'coaching':
      return Math.round(coachingCurve.get(team) ?? 6);
    // Teams without a graded QB yet count as average
    case 'qbPlay':
      return qbPlayGrades.get(team) ?? 6;
    case 'rbPlay':
      return rbPlayGrades.get(team) ?? 6;
    case 'defense':
      return Math.round(defenseGrades.get(team) ?? 6);
    default:
      return unitStat(player, stat.key as SkillStatKey, settings);
  }
}
