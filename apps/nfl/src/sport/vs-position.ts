import type { CardBreakdown, CardFlag } from '@ranker/engine/sport';
import { rankPct } from '@ranker/core/format';
import type { SkillPlayer } from './positions';

// A defense's card: vs Position (SportConfig.cardBreakdown). What it allowed to each offense's WR1, WR2,
// WR3, TE1 and RB1, against those players' own averages, where the targets go against it, and whether
// offenses throw or run more than usual on it: a DEF row's vsPos (scripts/defense-vs-position.mjs),
// every season's own. Display only: nothing in the ranking reads it.

const ROLES = ['WR1', 'WR2', 'WR3', 'TE1', 'RB1'] as const;
type Role = (typeof ROLES)[number];
const GROUPS = ['WR', 'TE', 'RB'] as const;

interface RoleLine {
  g: number;
  tgt: number | null;
  rec: number | null;
  yds: number | null;
  td: number | null;
  ppr: number | null;
  exp: number | null;
  vs: number | null;
  ydsVs: number | null;
  rank: number | null;
}
export type VsPos = Record<Role, RoleLine> & {
  pass: { ypg: number | null; rank: number | null };
  run: { ypg: number | null; rank: number | null };
  funnel: { rate: number | null; exp: number | null; score: number | null; rank: number | null; neutral: boolean };
  pace: { plays: number | null; exp: number | null; diff: number | null; rank: number | null };
  targets: Record<(typeof GROUPS)[number], { share: number | null; lg: number | null; tgt: number | null; yds: number | null; ypt: number | null; rank: number | null }> | null;
};

export const vsPosOf = (player: SkillPlayer): VsPos | null => (player as { vsPos?: VsPos | null }).vsPos ?? null;

// Who each role is (the row's hover), and what the take calls them
const ROLE_INFO: Record<Role, { plural: string; title: string }> = {
  WR1: { plural: 'WR1s', title: "Each offense's top wide receiver: the biggest share of its targets in the games he played before this one" },
  WR2: { plural: 'WR2s', title: "Each offense's second wide receiver, by his share of its targets before this one" },
  WR3: { plural: 'WR3s', title: "Each offense's third wide receiver, by his share of its targets before this one" },
  TE1: { plural: 'TEs', title: "Each offense's top tight end, by his share of its targets before this one" },
  RB1: { plural: 'RBs', title: "Each offense's lead back, by his share of its carries before this one (his yards: rushing and receiving)" },
};
const GROUP_WORDS = { WR: 'wide receivers', TE: 'tight ends', RB: 'backs' };

const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const list = (items: string[]) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function vsPositionBreakdown(player: SkillPlayer, position: string, rows: SkillPlayer[]): CardBreakdown | null {
  const vs = position === 'DEF' ? vsPosOf(player) : null;
  if (!vs) return null;
  // (ranked among the defenses the season's part has: 32, or the playoff teams)
  const of = Math.max(rows.filter((r) => vsPosOf(r)).length, ...ROLES.map((r) => vs[r]?.rank ?? 0));

  // Every role, a dash where the season had no game for it
  const lines = ROLES.map((role) => ({ role, line: vs[role] }));
  const has = (line: RoleLine | undefined): line is RoleLine => !!line && line.g > 0;
  const tableRows = lines.map(({ role, line }) => {
    const ok = has(line);
    return {
      label: role,
      title: ROLE_INFO[role].title,
      cells: [
        {
          text: ok && line.ppr !== null ? line.ppr.toFixed(1) : '-',
          title: ok ? `${line.rec ?? 0} catches${line.tgt !== null ? ` on ${line.tgt} targets` : ''}, ${line.yds ?? 0} yards and ${line.td ?? 0} TDs a game` : '',
        },
        {
          text: ok && line.yds !== null ? line.yds.toFixed(1) : '-',
          title: ok && line.ydsVs !== null ? `${signed(line.ydsVs)} yards a game against their own averages` : '',
        },
        {
          text: ok && line.vs !== null ? signed(line.vs) : '-',
          tone: ok && line.rank !== null ? rankPct(line.rank, of) : null,
          title: ok && line.exp !== null ? `${line.ppr} PPR points a game, against the ${line.exp} these ${ROLE_INFO[role].plural} averaged in their other games` : '',
        },
      ],
      rank: ok ? line.rank : null,
      of,
    };
  });

  // The take: the roles it stops and the ones it gives up, then a funnel or a lopsided target split
  const ranked = lines.filter((l) => has(l.line) && l.line.rank !== null).sort((a, b) => a.line.rank! - b.line.rank!);
  const cut = Math.max(3, Math.round(of * 0.25));
  const strong = ranked.filter((l) => l.line.rank! <= cut).slice(0, 2);
  const weak = ranked.filter((l) => l.line.rank! > of - cut).reverse().slice(0, 2);
  const say = (l: (typeof lines)[0]) => `${ROLE_INFO[l.role].plural} (#${l.line.rank})`;
  const clauses: string[] = [];
  if (strong.length) clauses.push(`shuts down ${list(strong.map(say))}`);
  if (weak.length) clauses.push(`soft on ${list(weak.map(say))}`);
  if (!clauses.length) clauses.push(ranked.length ? 'middle of the pack against every role' : 'not enough games to say');
  const extra: string[] = [];
  const { score, rank: funnelRank } = vs.funnel;
  if (score !== null && funnelRank !== null && Math.abs(score) >= 3) {
    extra.push(score > 0 ? `a pass funnel (#${funnelRank})` : `a run funnel (#${of + 1 - funnelRank})`);
  }
  // (the groups whose share of the targets against it is 4 points or more off the league's, most first)
  const lopsided = vs.targets
    ? GROUPS.map((g) => ({ g, t: vs.targets![g] }))
        .filter((x) => x.t.share !== null && x.t.lg !== null && Math.abs(x.t.share - x.t.lg) >= 0.04)
        .sort((a, b) => Math.abs(b.t.share! - b.t.lg!) - Math.abs(a.t.share! - a.t.lg!))
    : [];
  if (lopsided.length) extra.push(`${GROUP_WORDS[lopsided[0].g]} see ${pct(lopsided[0].t.share!)} of the targets (league ${pct(lopsided[0].t.lg!)})`);
  let take = clauses.join(', ');
  if (extra.length) take += `; ${list(extra)}`;
  take = capital(take) + '.';

  // The Overview's takes, under the archetype: the funnel (run, pass or neutral), and where the targets
  // go when that's notable
  const flags: CardFlag[] = [];
  if (score !== null && funnelRank !== null) {
    const amount = `${Math.abs(score).toFixed(1)}%`;
    if (score >= 2) {
      flags.push({ icon: 'call_split', tone: 'info', text: `Pass funnel: opponents pass ${amount} more often than usual (#${funnelRank} of ${of})` });
    } else if (score <= -2) {
      flags.push({ icon: 'call_split', tone: 'info', text: `Run funnel: opponents pass ${amount} less often than usual (#${of + 1 - funnelRank} of ${of})` });
    } else {
      flags.push({ icon: 'call_split', tone: 'info', text: `Neutral funnel: opponents pass about as often as usual (${signed(score)}%)` });
    }
  }
  if (lopsided.length) {
    const says = lopsided.map((x) => `${GROUP_WORDS[x.g]} ${x.t.share! > x.t.lg! ? 'get' : 'get only'} ${pct(x.t.share!)} (league ${pct(x.t.lg!)})`);
    flags.push({ icon: 'track_changes', tone: 'info', text: `Targets against it: ${says.join('; ')}` });
  }

  // The context under the table: the pass and run defense, and the pace
  const pace = vs.pace.diff;
  const note = [
    vs.pass.ypg !== null ? `Pass D: ${Math.round(vs.pass.ypg)} receiving yards a game (#${vs.pass.rank})` : null,
    vs.run.ypg !== null ? `Run D: ${Math.round(vs.run.ypg)} rushing yards (#${vs.run.rank})` : null,
    pace !== null && Math.abs(pace) >= 2 ? `opponents run ${Math.abs(pace).toFixed(1)} ${pace > 0 ? 'more' : 'fewer'} plays a game than usual` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const split = vs.targets
    ? {
        title: 'Where the targets go',
        help: "The share of the targets against this defense that went to wide receivers, tight ends and backs; the white ticks are the league's split",
        parts: GROUPS.map((g) => {
          const t = vs.targets![g];
          const share = t.share ?? 0;
          const league = t.lg ?? 0;
          return {
            label: g,
            share,
            league,
            title: `${capital(GROUP_WORDS[g])}: ${pct(share)} of the targets against it (league ${pct(league)}), ${t.ypt?.toFixed(1) ?? '-'} yards a target (#${t.rank ?? '-'})`,
            note: `lg ${pct(league)} · ${t.ypt?.toFixed(1) ?? '-'} Y/T #${t.rank ?? '-'}`,
          };
        }),
      }
    : null;

  return {
    title: 'vs Position',
    icon: 'person_search',
    help:
      "What this defense allowed to each offense's WR1, WR2, WR3, top tight end and lead back (each set by his share of the team's targets or carries in the games before), per game, and against what those same players averaged in their other games: holding an elite WR1 to his average reads as good defense. Every play counts, garbage time too.",
    take,
    note: note || null,
    flags,
    columns: [
      { label: 'PPR / G', title: 'PPR fantasy points the role scored a game against this defense' },
      { label: 'Yds / G', title: "Receiving yards a game (a back's from scrimmage)" },
      { label: 'vs Avg', title: 'PPR points a game against what those same players averaged in their other games (below zero: held under their norm)' },
    ],
    rows: tableRows,
    split,
  };
}
