// The Team tab's Current / Starters knob (the season being played: its injury report): who's actually
// playing at each spot, or the chart's starters whatever the report says (their flags on them). Current
// never puts anyone the report keeps out on the field, even when the chart hasn't caught up: the next
// healthy one at his spot, else one borrowed from the nearest group (a back at fullback, a guard's backup
// at tackle, a safety at corner), else the side's next grouping (one without that spot). Whoever fills in
// is drawn like any starter, his hover saying whom he's in for.
import type { DepthPlayer, DepthSide, DepthSlot } from './depth-chart';

export type DepthMode = 'current' | 'starters';

// Who's on a spot's chip, and whom he's in for
export interface SlotLineup {
  // (null: nobody at the spot, or nobody healthy to put there)
  player: DepthPlayer | null;
  // his place on the spot's chart (0: its starter; -1: borrowed from another spot)
  depth: number;
  // the starter he's in for (null: the starter himself)
  inFor: DepthPlayer | null;
  // (the hover: "In for L. Jackson (IR)")
  note: string | null;
}

// (kept off the field: Out, Doubtful (the site's injured, as the grid's filter has it), injured reserve
// or an injured list, unable to perform, suspended; Questionable still plays)
const SIDELINED = new Set(['O', 'D', 'IR', 'IL', 'PUP', 'NFI', 'SUSP']);
export function sidelined(p: DepthPlayer | null | undefined): boolean {
  if (!p?.status) return false;
  return SIDELINED.has(p.status.toUpperCase()) || /\b(out|doubtful|reserve|injured list|suspen|unable to perform)/i.test(p.statusText ?? '');
}

const healthy = (p: DepthPlayer | null | undefined, taken: ReadonlySet<string>): p is DepthPlayer => !!p && !sidelined(p) && !taken.has(p.id);
const inFor = (player: DepthPlayer, depth: number, starter: DepthPlayer): SlotLineup => ({ player, depth, inFor: starter, note: `In for ${starter.short} (${starter.status})` });

// A spot on its own (a special teams' spot): its starter, or (current) the first healthy one behind him not
// already playing elsewhere (taken: by id); nobody healthy, nobody (Starters: always the starter)
export function slotLineup(depth: DepthPlayer[], mode: DepthMode, taken: ReadonlySet<string> = new Set()): SlotLineup {
  const starter = depth[0] ?? null;
  if (!starter) return { player: null, depth: 0, inFor: null, note: null };
  if (mode === 'starters' || !sidelined(starter)) return { player: starter, depth: 0, inFor: null, note: null };
  const i = depth.findIndex((p, d) => d > 0 && healthy(p, taken));
  return i < 0 ? { player: null, depth: 0, inFor: starter, note: `No healthy ${depth.length > 1 ? 'backup' : 'player'} for ${starter.short} (${starter.status})` } : inFor(depth[i], i, starter);
}

// A side's chips, by slot key: the healthy starters first (each keeps his spot), then each spot whose
// starter is out takes the next healthy one on its own chart, then a spot still open borrows a backup from
// its nearest groups (slot.near, in order: its own group's other spots first), nobody at two spots
export function sideLineup(slots: DepthSlot[], mode: DepthMode): Record<string, SlotLineup> {
  const lineup: Record<string, SlotLineup> = {};
  if (mode === 'starters') {
    for (const s of slots) lineup[s.key] = slotLineup(s.depth, 'starters');
    return lineup;
  }
  const taken = new Set<string>();
  for (const s of slots) if (s.depth[0] && !sidelined(s.depth[0])) taken.add(s.depth[0].id);
  for (const s of slots) {
    const line = slotLineup(s.depth, 'current', taken);
    if (line.player) taken.add(line.player.id);
    lineup[s.key] = line;
  }
  for (const s of slots) {
    const line = lineup[s.key];
    if (line.player || !line.inFor) continue;
    for (const group of s.near ?? (s.group ? [s.group] : [])) {
      // (the group's backups, the shallowest first, then by spot)
      const pool = slots
        .filter((o) => o.group === group)
        .flatMap((o) => o.depth.slice(1).map((p, i) => ({ p, d: i })))
        .sort((a, b) => a.d - b.d);
      const pick = pool.find(({ p }) => healthy(p, taken))?.p;
      if (pick) {
        lineup[s.key] = inFor(pick, -1, line.inFor);
        taken.add(pick.id);
        break;
      }
    }
  }
  return lineup;
}

// The side as drawn: its grouping and its chips. Starters: its main grouping, the chart's starters.
// Current: the main one when every spot can be filled with someone healthy, else the next of its others
// (side.others, the most used first) that can, else the one with the fewest open spots
export interface Formation {
  set: string | null;
  slots: DepthSlot[];
  lineup: Record<string, SlotLineup>;
  // (why it isn't the main grouping: "No healthy fullback: their next most-used grouping")
  note: string | null;
}

export function sideFormation(side: Pick<DepthSide, 'set' | 'slots' | 'others'>, mode: DepthMode): Formation {
  const main = { set: side.set, slots: side.slots, lineup: sideLineup(side.slots, mode), note: null };
  if (mode === 'starters') return main;
  const holes = (f: { slots: DepthSlot[]; lineup: Record<string, SlotLineup> }) => f.slots.filter((s) => !f.lineup[s.key]?.player);
  const open = holes(main);
  if (!open.length || !side.others?.length) return main;
  const why = `No healthy ${[...new Set(open.map((s) => s.name.toLowerCase()))].join(' or ')}: their next most-used grouping`;
  let best: Formation = main;
  let fewest = open.length;
  for (const o of side.others) {
    const f = { set: o.set, slots: o.slots, lineup: sideLineup(o.slots, mode), note: why };
    const n = holes(f).length;
    if (!n) return f;
    if (n < fewest) [best, fewest] = [f, n];
  }
  return best;
}
