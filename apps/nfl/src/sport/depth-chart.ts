// The NFL's Roster tab (the card's Team, O-Line, Defense and Head Coach rows): a team's file
// (scripts/build-depth.mjs: data/depth/<logo>.json for the season being played, data/seasons/<year>/depth
// for past ones) laid out as the engine draws it (@ranker/engine/player-card/depth-chart): the offense in
// its main personnel (two tight ends or a fullback where that's what it mostly played) and the defense in
// its base front, each slot placed on the field, then the special teams, who's played and what changed.
import type { DepthPlayer, DepthSide, DepthSlot, DepthUsageGroup, DepthView } from '@ranker/engine/player-card/depth-chart';

// A team's file
interface DepthFile {
  team: string;
  season: number;
  at: string;
  teamGames: number;
  front: string | null;
  // its main personnel: how many backs, tight ends and receivers it had on the field (from the snap counts:
  // 2012 on)
  personnel: { rb: number; te: number; wr: number } | null;
  slots: { side: 'offense' | 'defense' | 'special'; key: string; abb: string; name: string; depth: string[] }[];
  players: Record<
    string,
    {
      name: string;
      espnId: string | null;
      // (the NFL's image id, "league/abc123", or a whole link)
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
  // the season's positional changes, week by week (why, when known: the injury report, or a move)
  timeline: { week: number; changes: { side: string; key: string; name: string; from: string; to: string; reason: string | null; note: string | null }[] }[];
}

// Where each spot sits (x across, y down, in percent of the field): the offense facing up from the line
// of scrimmage, near the top of its wider, shorter field (the engine draws it at 2:1); the defense above
// its line (the front on it, the linebackers behind, the corners wide, the safeties deep)
const OFFENSE_LOS = 22;
const SPOT: Record<string, [number, number]> = {
  X: [6, 26], SLOT: [18, 36], Z: [94, 26], LT: [30, 22], LG: [40, 22], C: [50, 22], RG: [60, 22], RT: [70, 22],
  TE: [81, 26], TE2: [20, 24], QB: [50, 50], FB: [50, 64], RB: [50, 78],
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
const OLINE = new Set(['LT', 'LG', 'C', 'RG', 'RT']);

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
const NFL_IMAGES = 'https://static.www.nfl.com/image/upload/f_auto,q_auto,w_96,h_96,c_thumb,g_face/';
const thumb = (id: string | null | undefined): string | null =>
  !id ? null : id.startsWith('http') ? id.replace('/upload/f_auto,q_auto/', '/upload/f_auto,q_auto,w_96,h_96,c_thumb,g_face/') : NFL_IMAGES + id;

// "Lamar Jackson" -> "L. Jackson" (a suffix kept with the last name)
function shortName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(parts.at(-1)!) ? parts.pop() : null;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}${suffix ? ' ' + suffix : ''}`;
}

export async function loadDepthChart(logo: string, position: string, season: number, current: boolean): Promise<DepthView> {
  const res = await fetch(current ? `data/depth/${logo}.json` : `data/seasons/${season}/depth/${logo}.json`, { cache: current ? 'no-cache' : 'default' });
  if (!res.ok) throw new Error(`depth chart ${logo} ${season}: ${res.status}`);
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
  const chain = (key: string) => file.slots.find((s) => s.key === key)?.depth ?? [];

  // The offense in its main personnel: three receivers (X, the slot, Z), or two with a second tight end
  // (on the line's left) or a fullback (behind the quarterback), as the team mostly played
  const offense = (): DepthSide => {
    const p = file.personnel ?? { rb: 1, te: 1, wr: 3 };
    const te = chain('TE10');
    const rb = chain('RB11');
    const fb = chain('FB12');
    const spots: [string, string, string, string[]][] = [
      ['X', 'X', 'Wide Receiver', chain('WR1')],
      ['LT', 'LT', 'Left Tackle', chain('LT3')],
      ['LG', 'LG', 'Left Guard', chain('LG4')],
      ['C', 'C', 'Center', chain('C5')],
      ['RG', 'RG', 'Right Guard', chain('RG6')],
      ['RT', 'RT', 'Right Tackle', chain('RT7')],
      ['QB', 'QB', 'Quarterback', chain('QB9')],
      // (two tight ends: the second on the chart lines up on the left, the rest behind the first)
      ['TE', 'TE', 'Tight End', p.te >= 2 ? [te[0], ...te.slice(2)].filter(Boolean) : te],
      ['RB', 'RB', 'Running Back', p.rb >= 2 && !fb.length ? [rb[0], ...rb.slice(2)].filter(Boolean) : rb],
    ];
    if (p.wr >= 2) spots.push(['Z', 'Z', 'Wide Receiver', chain('WR2')]);
    if (p.wr >= 3) spots.push(['SLOT', 'SLOT', 'Slot Receiver', chain('WR8')]);
    if (p.te >= 2 && te[1]) spots.push(['TE2', 'TE', 'Tight End', [te[1]]]);
    if (p.rb >= 2) spots.push(['FB', 'FB', 'Fullback', fb.length ? fb : rb[1] ? [rb[1]] : []]);
    const slots: DepthSlot[] = spots.map(([key, label, name, depth]) => ({
      key,
      label,
      name,
      x: SPOT[key][0],
      y: SPOT[key][1],
      focus: position === 'OL' ? OLINE.has(key) : undefined,
      depth: depth.map((id) => player(id, 'offense')),
    }));
    return {
      id: 'offense',
      title: 'Offense',
      set: file.personnel ? `${p.rb}${p.te} Personnel` : null,
      los: OFFENSE_LOS,
      slots,
    };
  };

  const defense = (): DepthSide => {
    const front = file.front ?? '4-3';
    const layout = front === '3-4' ? DEFENSE_34 : DEFENSE_43;
    const slots: DepthSlot[] = file.slots
      .filter((s) => s.side === 'defense' && layout[s.key])
      .map((s) => ({
        key: s.key,
        label: s.key === 'NB12' ? 'NICKEL' : s.abb,
        name: s.name,
        x: layout[s.key][0],
        y: layout[s.key][1],
        sub: s.key === 'NB12',
        depth: s.depth.map((id) => player(id, 'defense')),
      }));
    return { id: 'defense', title: 'Defense', set: `Base ${front}`, los: DEFENSE_LOS, slots };
  };

  // (the card's side first: the Defense card leads with its defense)
  const sides = position === 'DEF' ? [defense(), offense()] : [offense(), defense()];

  const special = [
    ['K', 'PK'], ['P', 'P'], ['LS', 'LS'], ['KR', 'KR'], ['PR', 'PR'],
  ].map(([label, key]) => {
    const id = file.slots.find((s) => s.side === 'special' && s.key === key)?.depth[0];
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

  // The season's positional changes, week by week, each tagged with why
  const REASON_TAG: Record<string, string> = {
    injury: 'Injury', ir: 'IR', released: 'Released', traded: 'Traded', retired: 'Retired', inactive: 'Inactive', coach: "Coach's Decision", moved: 'Moved',
  };
  const LABEL: Record<string, string> = { WR1: 'X', WR2: 'Z', WR8: 'SLOT', NB12: 'NICKEL' };
  const timeline = (file.timeline ?? []).map((w) => ({
    week: w.week,
    changes: w.changes.map((c) => ({
      label: LABEL[c.key] ?? c.key.replace(/\d+$/, ''),
      from: file.players[c.from]?.name ?? c.from,
      to: file.players[c.to]?.name ?? c.to,
      reason: c.reason ?? null,
      tag: c.reason ? (REASON_TAG[c.reason] ?? null) : null,
      // (the detail when it adds to the tag: the injury, where someone moved)
      note: c.reason === 'injury' || c.reason === 'moved' ? c.note : c.reason === 'coach' ? c.note?.replace(/^Coach's decision,?\s*/, '') || null : null,
    })),
  }));

  return { asOf: file.at, sides, special, usage, timeline, teamGames: file.teamGames };
}
