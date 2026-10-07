// The NFL's Depth Chart tab (the card's Team, O-Line, Defense and Head Coach rows): a team's file
// (scripts/build-depth.mjs: data/depth/<logo>.json) laid out as the engine draws it
// (@ranker/engine/player-card/depth-chart): the offense in its 3WR 1TE set and the defense in its base
// front, each slot placed on the field, then the special teams, who's played and what's changed.
import type { DepthPlayer, DepthSide, DepthSlot, DepthUsageGroup, DepthView } from '@ranker/engine/player-card/depth-chart';

// A team's file
interface DepthFile {
  team: string;
  at: string;
  teamGames: number;
  front: string | null;
  slots: { side: 'offense' | 'defense' | 'special'; key: string; abb: string; name: string; depth: string[] }[];
  players: Record<
    string,
    {
      name: string;
      espnId: string | null;
      headshot: string | null;
      pos: string | null;
      unit: string | null;
      off: number;
      def: number;
      st: number;
      games: number;
      chart: { key: string; depth: number } | null;
      status: string | null;
      injury: string | null;
    }
  >;
  changes: { side: string; key: string; name: string; from: string; to: string }[];
}

// Where each slot sits (x across, y down, in percent of the field): the offense facing up from the line
// of scrimmage (its receivers split wide, the slot inside), the defense above its line (the front on it,
// the linebackers behind, the corners wide, the safeties deep)
// (the offense on a wider, shorter field than the defense: the engine draws it at 2:1, the line near the top)
const OFFENSE_LOS = 22;
const OFFENSE: Record<string, [number, number]> = {
  WR1: [6, 26], WR8: [18, 36], LT3: [30, 22], LG4: [40, 22], C5: [50, 22], RG6: [60, 22], RT7: [70, 22],
  TE10: [81, 26], WR2: [94, 26], QB9: [50, 50], FB12: [50, 64], RB11: [50, 78],
};
const DEFENSE_LOS = 80;
const DEFENSE_34: Record<string, [number, number]> = {
  // (the outside linebackers on the edge, just outside the ends; the nickel out over the slot, between them
  // and the corner)
  LDE1: [38, 70], NT2: [50, 70], RDE3: [62, 70], WLB4: [25, 66], LILB5: [43, 46], RILB6: [57, 46], SLB7: [75, 66],
  LCB8: [6, 64], SS9: [63, 18], FS10: [37, 14], RCB11: [94, 64], NB12: [15, 48],
};
const DEFENSE_43: Record<string, [number, number]> = {
  LDE1: [30, 70], LDT2: [43, 70], RDT3: [57, 70], RDE4: [70, 70], WLB5: [30, 46], MLB6: [50, 44], SLB7: [70, 46],
  LCB8: [6, 64], SS9: [63, 18], FS10: [37, 14], RCB11: [94, 64], NB12: [17, 40],
};
// (a slot's label on the field: its position, the receivers by their roles)
const LABEL: Record<string, string> = { WR1: 'X', WR2: 'Z', WR8: 'SLOT', NB12: 'NICKEL' };
const OLINE = new Set(['LT3', 'LG4', 'C5', 'RG6', 'RT7']);

// The usage list's groups, in order
const UNITS: [string, string][] = [
  ['QB', 'Quarterbacks'], ['RB', 'Running Backs'], ['WR', 'Receivers'], ['TE', 'Tight Ends'], ['OL', 'Offensive Line'],
  ['DL', 'Defensive Line'], ['LB', 'Linebackers'], ['DB', 'Secondary'], ['ST', 'Specialists'],
];
const DEFENSE_UNITS = new Set(['DL', 'LB', 'DB']);

// The injury report's status, short
const STATUS: Record<string, string> = { Questionable: 'Q', Doubtful: 'D', Out: 'O', 'Injured Reserve': 'IR', Suspension: 'SUSP', 'Physically Unable to Perform': 'PUP' };

// A headshot as a small face crop: the NFL's originals are full-size PNGs (megabytes each), and its image
// server resizes on request (96px, cropped to the face: a few KB)
const thumb = (url: string | null | undefined): string | null =>
  url ? url.replace('/upload/f_auto,q_auto/', '/upload/f_auto,q_auto,w_96,h_96,c_thumb,g_face/') : null;

// "Lamar Jackson" -> "L. Jackson" (a suffix kept with the last name)
function shortName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(parts.at(-1)!) ? parts.pop() : null;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}${suffix ? ' ' + suffix : ''}`;
}

export async function loadDepthChart(logo: string, position: string): Promise<DepthView> {
  const res = await fetch(`data/depth/${logo}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`depth chart ${logo}: ${res.status}`);
  const file = (await res.json()) as DepthFile;

  const player = (id: string, side: 'offense' | 'defense' | 'special'): DepthPlayer => {
    const p = file.players[id];
    const snaps = !p ? null : side === 'offense' ? p.off : side === 'defense' ? p.def : p.st;
    return {
      name: p?.name ?? id,
      short: shortName(p?.name ?? id),
      headshot: thumb(p?.headshot) ?? (p?.espnId ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${p.espnId}.png&w=96&h=70` : null),
      snaps: p && p.games ? snaps : null,
      games: p?.games ?? 0,
      status: p?.status ? (STATUS[p.status] ?? p.status) : null,
      statusText: p?.status ?? null,
      injury: p?.injury ?? null,
    };
  };

  const side = (id: 'offense' | 'defense'): DepthSide => {
    const front = file.front ?? '4-3';
    const layout = id === 'offense' ? OFFENSE : front === '3-4' ? DEFENSE_34 : DEFENSE_43;
    const slots: DepthSlot[] = file.slots
      .filter((s) => s.side === id && layout[s.key])
      .map((s) => ({
        key: s.key,
        label: LABEL[s.key] ?? s.abb,
        name: s.name,
        x: layout[s.key][0],
        y: layout[s.key][1],
        sub: s.key === 'NB12',
        focus: position === 'OL' ? OLINE.has(s.key) : undefined,
        depth: s.depth.map((pid) => player(pid, id)),
      }));
    return {
      id,
      title: id === 'offense' ? 'Offense' : 'Defense',
      set: id === 'offense' ? '3WR 1TE' : `Base ${front}`,
      los: id === 'offense' ? OFFENSE_LOS : DEFENSE_LOS,
      slots,
    };
  };

  // (the card's side first: the Defense card leads with its defense)
  const sides = position === 'DEF' ? [side('defense'), side('offense')] : [side('offense'), side('defense')];

  const specialSlot = (abb: string) => file.slots.find((s) => s.side === 'special' && s.abb === abb);
  const special = [
    ['K', 'PK'], ['P', 'P'], ['LS', 'LS'], ['KR', 'KR'], ['PR', 'PR'],
  ].map(([label, abb]) => {
    const id = specialSlot(abb)?.depth[0];
    return { label, player: id ? player(id, 'special') : null };
  });

  // Who's played: everyone with a snap or on the chart, by unit, the most-used first (his own side's
  // snaps; a specialist's special teams')
  const usage: DepthUsageGroup[] = [];
  const order = position === 'DEF' ? [...UNITS.filter(([u]) => DEFENSE_UNITS.has(u)), ...UNITS.filter(([u]) => !DEFENSE_UNITS.has(u))] : UNITS;
  for (const [unit, title] of order) {
    const rows = Object.entries(file.players)
      .filter(([, p]) => p.unit === unit && (p.games > 0 || p.chart))
      .map(([id, p]) => {
        const sideOf = unit === 'ST' ? 'special' : DEFENSE_UNITS.has(unit) ? 'defense' : 'offense';
        return { ...player(id, sideOf), pos: p.pos, onChart: !!p.chart };
      })
      .sort((a, b) => (b.snaps ?? -1) - (a.snaps ?? -1));
    if (rows.length) usage.push({ title, rows });
  }

  const changes = file.changes.map((c) => ({
    label: LABEL[c.key] ?? c.key.replace(/\d+$/, ''),
    from: file.players[c.from]?.name ?? c.from,
    to: file.players[c.to]?.name ?? c.to,
  }));

  return { asOf: file.at, sides, special, usage, changes, teamGames: file.teamGames };
}
