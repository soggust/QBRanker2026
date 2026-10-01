import type { CardFlag, CardHost } from '@ranker/engine/sport';
import { CardSkill, standing, tierWord } from '@ranker/engine/skills';

// Run blocking (TEs mostly, WRs lightly) and a back's pass protection on the player card
// (SPORT.cardExtras): from who was on the field each play, published after each season
// (scripts/build-blocking.mjs). The table has Run Block EPA; the card reads the detail. A season that
// isn't charted yet (this one) says nothing, and only notable numbers do.

// blocking.json: runs on the field, team runs in his games, EPA and success per carry with him on,
// runs off, EPA and success with him off, his snaps, the team's snaps, dropbacks on the field, QB
// pressured on those, dropbacks off, pressured on those
type BlockingRow = [
  number,
  number,
  number | null,
  number | null,
  number,
  number | null,
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
];
type BlockingFile = Record<string, BlockingRow>;

export async function blockingExtras(card: CardHost): Promise<void> {
  if (!['TE', 'WR', 'RB'].includes(card.position)) return;
  const id = card.player.gsisId;
  const te = card.position === 'TE';
  const charted: { season: number; tilt: number; impact: number | null; share: number }[] = [];
  for (const season of card.seasons) {
    const row = (await card.seasonFile<BlockingFile>(season, 'blocking.json'))[id];
    if (!row) continue;
    const [on, teamRuns, epaOn, , off, epaOff, , snaps, teamSnaps] = row;
    if (snaps < 150 || !teamSnaps || !teamRuns) continue;
    charted.push({
      season,
      tilt: on / snaps / (teamRuns / teamSnaps),
      impact: off >= 40 && epaOn !== null && epaOff !== null ? epaOn - epaOff : null,
      share: on / teamRuns,
    });
  }
  // Only the card's own season counts: a season that isn't charted (this one, until it's over) says
  // nothing about run blocking rather than borrowing an older season's
  const latest = charted[charted.length - 1];
  if (!card.open() || !latest || latest.season !== card.season) return;
  // (backs are read on pass protection instead)
  if (card.position === 'RB') {
    await addPassProSkill(card, card.season);
    return;
  }
  await addBlockingSkill(card, latest.season);
  if (!card.open()) return;
  const flags: CardFlag[] = [];
  const epa = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  if (te) {
    if (latest.tilt >= 1.2) {
      flags.push({ icon: 'sports_mma', tone: 'info', text: `Blocking-first role: out there far more on runs than passes` });
    } else if (latest.tilt <= 0.65) {
      flags.push({ icon: 'open_with', tone: 'info', text: `Move tight end: rarely on the field for runs` });
    }
    if (latest.impact !== null && latest.impact >= 0.08) {
      flags.push({ icon: 'sports_mma', tone: 'good', text: `Run-game boost: ${epa(latest.impact)} EPA per carry with him on the field` });
    } else if (latest.impact !== null && latest.impact <= -0.08) {
      flags.push({ icon: 'sports_mma', tone: 'bad', text: `Runs fared worse with him on the field (${epa(latest.impact)} EPA per carry)` });
    }
    // Across the career: a steady plus in the run game
    const measured = charted.filter((c) => c.impact !== null);
    const plus = measured.filter((c) => c.impact! >= 0.05).length;
    if (measured.length >= 3 && plus / measured.length >= 0.7) {
      flags.push({ icon: 'verified', tone: 'good', text: `Consistent run-game boost: a plus in ${plus} of ${measured.length} charted seasons` });
    }
    // The archetype: a blocker who also produces is a complete tight end; a blocker who doesn't
    // catch much is a blocking tight end
    const scores = Object.fromEntries(card.skills().map((s) => [s.id, s.pct]));
    const catches = Math.max(scores['production'] ?? 0, scores['role'] ?? 0);
    const blocker =
      latest.impact !== null && latest.impact >= 0.08 && catches >= 0.7
        ? 'Complete Tight End'
        : latest.tilt >= 1.2 && catches <= 0.4
          ? 'Blocking Tight End'
          : null;
    if (blocker) card.setArchetype(blocker);
  } else {
    // Receivers: only the notable (a passing-down specialist, or a big run-game swing)
    if (latest.tilt <= 0.65) {
      flags.push({ icon: 'swap_vert', tone: 'info', text: `Passing-down specialist: rarely on the field for runs` });
    }
    if (latest.impact !== null && latest.impact >= 0.15) {
      flags.push({ icon: 'sports_mma', tone: 'info', text: `Runs gained ${epa(latest.impact)} EPA per carry with him on the field` });
    }
  }
  card.addFlags(flags);
}

// A Run Blocking skill on the radar and in the report (TEs; backs and receivers when there's an on/off
// sample): the share of his team's runs he was on the field for, and the run game with him on against
// off (when he sat for enough runs to tell), each as a percentile among that season's players at the
// position (finished seasons only).
async function addBlockingSkill(card: CardHost, season: number): Promise<void> {
  const [file, tes] = await Promise.all([card.seasonFile<BlockingFile>(season, 'blocking.json'), card.tabRows(season)]);
  const rows = tes
    .map((u) => ({ id: u.gsisId, row: file[u.gsisId] }))
    .filter((r): r is { id: string; row: BlockingRow } => !!r.row && r.row[7] >= 150);
  const mine = rows.find((r) => r.id === card.player.gsisId);
  if (!mine || rows.length < 5 || !card.open()) return;
  const share = (r: BlockingRow) => r[0] / r[1];
  const impact = (r: BlockingRow) => (r[4] >= 40 && r[2] !== null && r[5] !== null ? r[2] - r[5] : null);
  const pctOf = (values: number[], v: number) => values.filter((x) => x < v).length / Math.max(values.length - 1, 1);
  const shares = rows.map((r) => share(r.row));
  const impacts = rows.map((r) => impact(r.row)).filter((v): v is number => v !== null);
  const parts = [pctOf(shares, share(mine.row))];
  const myImpact = impact(mine.row);
  // (for backs and receivers, being on the field for runs mostly says they play every down: the axis
  // only shows when the run game with them on and off can be compared)
  if (card.position !== 'TE' && (myImpact === null || impacts.length < 5)) return;
  if (myImpact !== null && impacts.length >= 5) parts.push(pctOf(impacts, myImpact));
  const pct = Math.min(1, parts.reduce((a, v) => a + v, 0) / parts.length);
  const rankIn = (values: number[], v: number) => 1 + values.filter((x) => x > v).length;
  const skill: CardSkill = {
    id: 'blocking',
    name: 'Run Blocking',
    short: 'Run Block',
    pct,
    tier: tierWord(pct),
    standing: standing(pct),
    evidence: [
      { label: `Share of Runs On Field`, rank: rankIn(shares, share(mine.row)), of: shares.length },
      ...(myImpact !== null ? [{ label: `Run EPA On vs Off`, rank: rankIn(impacts, myImpact), of: impacts.length }] : []),
    ],
  };
  card.addSkill(skill);
}

// A back's Pass Pro skill on the radar and in the report, and a take when it's notable: the QB's
// pressure rate on dropbacks with him on the field against off (at least 40 dropbacks each way), as a
// percentile among that season's backs (lower pressure is better)
async function addPassProSkill(card: CardHost, season: number): Promise<void> {
  const [file, backs] = await Promise.all([card.seasonFile<BlockingFile>(season, 'blocking.json'), card.tabRows(season)]);
  const delta = (r: BlockingRow | undefined) => (r && r[9] >= 40 && r[11] >= 40 ? (r[10] / r[9] - r[12] / r[11]) * 100 : null);
  const values = backs.map((u) => delta(file[u.gsisId])).filter((v): v is number => v !== null);
  const mine = delta(file[card.player.gsisId]);
  if (mine === null || values.length < 5 || !card.open()) return;
  const pct = values.filter((v) => v > mine).length / Math.max(values.length - 1, 1);
  card.addSkill({
    id: 'passPro',
    name: 'Pass Protection',
    short: 'Pass Pro',
    pct: Math.min(1, pct),
    tier: tierWord(pct),
    standing: standing(pct),
    evidence: [{ label: 'QB Pressure On vs Off', rank: 1 + values.filter((v) => v < mine).length, of: values.length }],
  });
  const pts = (v: number) => `${Math.abs(v).toFixed(1)} points`;
  if (mine <= -5) {
    card.addFlags([{ icon: 'shield', tone: 'good', text: `Pass-pro plus: the QB was pressured ${pts(mine)} less often with him on the field` }]);
  } else if (mine >= 5) {
    card.addFlags([{ icon: 'shield', tone: 'bad', text: `Pass-pro concern: the QB was pressured ${pts(mine)} more often with him on the field` }]);
  }
}
