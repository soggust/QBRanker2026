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
  // EPA a play to him (a target; the lead back's targets and carries), its rank (1 the stingiest); none
  // before 2006
  epa?: number | null;
  epaRank?: number | null;
  rank: number | null;
}
export type VsPos = Record<Role, RoleLine> & {
  pass: { ypg: number | null; rank: number | null };
  run: { ypg: number | null; rank: number | null };
  // (method: 'proe' over nflverse's expected pass rate, 2006 on; 'rate' the plain pass rate before; missing on
  // files built before it was kept: 'rate')
  funnel: { rate: number | null; exp: number | null; score: number | null; rank: number | null; neutral: boolean; method?: 'proe' | 'rate' };
  pace: { plays: number | null; exp: number | null; diff: number | null; rank: number | null };
  targets: Record<(typeof GROUPS)[number], { share: number | null; lg: number | null; tgt: number | null; yds: number | null; ypt: number | null; rank: number | null }> | null;
};

export const vsPosOf = (player: SkillPlayer): VsPos | null => (player as { vsPos?: VsPos | null }).vsPos ?? null;

// The funnel's hover help, by how it was measured (vsPos.funnel.method)
export function funnelHelp(funnel: VsPos['funnel']): string {
  const when = funnel.neutral ? ' in neutral situations (win probability 20-80%, outside each half\'s last two minutes)' : '';
  return funnel.method === 'proe'
    ? `Pass rate over expected: opponents' pass rate against this defense${when} over nflverse's expected pass rate for each play (it knows the down, distance, field position, time and score), against those same offenses' own pass rate over expected in their other games. Their usual rate is what they'd throw on those same plays elsewhere. The tick is their usual rate.`
    : `Plain pass rate (no expected pass rate before 2006): opponents' pass rate against this defense${when}, against those same offenses' own rates in their other games. The tick is their usual rate.`;
}

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
      group: GROUPS.indexOf(role.slice(0, 2) as (typeof GROUPS)[number]),
      title: ROLE_INFO[role].title,
      cells: [
        {
          text: ok && line.epa != null ? signed(line.epa, 2) : '-',
          tone: ok && line.epaRank != null ? rankPct(line.epaRank, of) : null,
          title: ok && line.epa != null ? `${signed(line.epa, 2)} EPA a ${role === 'RB1' ? 'target or carry' : 'target'} to these ${ROLE_INFO[role].plural} (#${line.epaRank} of ${of})` : '',
        },
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

  const { score, rank: funnelRank } = vs.funnel;
  // (the groups whose share of the targets against it is 4 points or more off the league's, most first)
  const lopsided = vs.targets
    ? GROUPS.map((g) => ({ g, t: vs.targets![g] }))
        .filter((x) => x.t.share !== null && x.t.lg !== null && Math.abs(x.t.share - x.t.lg) >= 0.04)
        .sort((a, b) => Math.abs(b.t.share! - b.t.lg!) - Math.abs(a.t.share! - a.t.lg!))
    : [];

  // The Overview's takes, under the archetype: the funnel (run, pass or neutral), and where the targets
  // go when that's notable
  const flags: CardFlag[] = [];
  if (score !== null && funnelRank !== null) {
    const amount = `${Math.abs(score).toFixed(1)}%`;
    // (over expected: against what the down, distance, field position, time and score call for)
    const usual = vs.funnel.method === 'proe' ? 'usual for the situation' : 'usual';
    if (score >= 2) {
      flags.push({ icon: 'call_split', tone: 'info', text: `Pass funnel: opponents pass ${amount} more often than ${usual} (#${funnelRank} of ${of})` });
    } else if (score <= -2) {
      flags.push({ icon: 'call_split', tone: 'info', text: `Run funnel: opponents pass ${amount} less often than ${usual} (#${of + 1 - funnelRank} of ${of})` });
    } else {
      flags.push({ icon: 'call_split', tone: 'info', text: `Neutral funnel: opponents pass about as often as ${usual} (${signed(score)}%)` });
    }
  }
  if (lopsided.length) {
    const says = lopsided.map((x) => `${GROUP_WORDS[x.g]} ${x.t.share! > x.t.lg! ? 'get' : 'get only'} ${pct(x.t.share!)} (league ${pct(x.t.lg!)})`);
    flags.push({ icon: 'track_changes', tone: 'info', text: `Targets against it: ${says.join('; ')}` });
  }

  // The headline: which way offenses lean against it, their pass rate here against their usual
  const lean =
    score !== null && vs.funnel.rate !== null
      ? (() => {
          const way: 'pass' | 'run' | null = score >= 2 ? 'pass' : score <= -2 ? 'run' : null;
          const rank = funnelRank === null ? '' : way === 'pass' ? ` (#${funnelRank} of ${of})` : way === 'run' ? ` (#${of + 1 - funnelRank} of ${of})` : '';
          const usual = vs.funnel.exp !== null ? `, against ${pct(vs.funnel.exp)} usually` : '';
          return {
            label: way === 'pass' ? 'Pass funnel' : way === 'run' ? 'Run funnel' : 'Neutral funnel',
            tone: way,
            text:
              (way ? `Teams lean ${way} here${rank}` : 'Teams play it straight here') +
              `: opponents pass on ${pct(vs.funnel.rate)} of plays${usual}` +
              (way ? `, ${Math.abs(score).toFixed(1)} points ${way === 'pass' ? 'more' : 'less'} than they usually do` : ''),
            pass: vs.funnel.rate,
            usual: vs.funnel.exp,
            help: funnelHelp(vs.funnel),
          };
        })()
      : null;

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
    flags,
    columns: [
      { label: 'EPA / Play', title: "Expected points added a play to the role: a receiver's targets, the lead back's targets and carries (below zero: the defense won those plays; ranked, #1 the stingiest)" },
      { label: 'PPR / G', title: 'PPR fantasy points the role scored a game against this defense' },
      { label: 'Yds / G', title: "Receiving yards a game (a back's from scrimmage)" },
      { label: 'vs Avg', title: 'PPR points a game against what those same players averaged in their other games (below zero: held under their norm)' },
    ],
    rows: tableRows,
    lean,
    split,
  };
}
