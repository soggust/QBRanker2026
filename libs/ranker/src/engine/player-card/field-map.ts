// The card's Field Map (the NFL's, on the Overview: SPORT.fieldMap): a season by where on the field it
// happened, from field-maps.json (apps/nfl/scripts/build-field-maps.mjs). A passer's throws, a catcher's
// targets and what a defense allowed by zone (three across, four deep, looking downfield from behind the
// offense); a runner's carries and what a defense allowed by lane; a kicker's field goals by distance (his
// misses by how they missed, marked round the rings); a punter's punts down the field. Each part tinted
// against the league's in the same file (every team's plays pooled), green the good side for the card's own
// row (a defense's weak spot red). Plain functions and the charts' geometry (no Angular), so the tests read
// them as the card does.

export type FieldDepth = 'behind' | 'short' | 'mid' | 'deep';
export type FieldSide = 'left' | 'middle' | 'right';

// A zone (always 12: behind-left, behind-middle, behind-right, short-left, ... deep-right): its throws or
// targets, the catches, yards, touchdowns, picks and EPA a throw
export interface FieldZone {
  depth: FieldDepth;
  side: FieldSide;
  att: number;
  comp: number;
  yds: number;
  td: number;
  int: number;
  epa: number;
}

// A lane (always 7, from the offense's left: left end ... right end): carries, yards, touchdowns, EPA a
// carry and the share that gained (EPA above 0)
export interface FieldLane {
  lane: string;
  att: number;
  yds: number;
  td: number;
  epa: number;
  success: number;
}

// A field goal distance band (always 5: <30, 30-39, 40-49, 50-59, 60+)
export interface FieldBand {
  band: string;
  att: number;
  made: number;
}

export interface FieldPunt {
  n: number;
  gross: number;
  net: number;
  inside20: number;
  touchbacks: number;
  fairCatches: number;
  blocked: number;
  bands: { band: string; n: number }[];
}

// (a kick's misses by how: [wide left, wide right, short, blocked, other], the file's fields.miss order)
export type KickMisses = number[];

export interface FieldMapEntry {
  pass?: FieldZone[];
  targets?: FieldZone[];
  runs?: FieldLane[];
  fg?: FieldBand[];
  // (each band's misses, in fg's order; files from before they were read have none)
  fgMiss?: KickMisses[];
  xp?: { att: number; made: number };
  xpMiss?: KickMisses;
  punt?: FieldPunt;
}

// One part of a season (the regular season, the playoffs, or both): the league's, each player's (by the
// row's id: a player's gsisId, a QB's ESPN id) and what each defense allowed (DEF-ARI)
export interface FieldMapSection {
  league: { pass: FieldZone[]; runs: FieldLane[]; fg: FieldBand[]; punt: FieldPunt; xp?: { att: number; made: number } };
  players: Record<string, FieldMapEntry>;
  defenses: Record<string, { pass?: FieldZone[]; runs?: FieldLane[] }>;
}

export interface FieldMapsFile {
  season: number;
  updated: string;
  regular: FieldMapSection | null;
  post: FieldMapSection | null;
  all: FieldMapSection | null;
}

// ---- the file as written: each zone, lane and band a packed tuple in its fixed order (the file's `fields`
// says which), a punt's bands a plain count array; read back into the shapes above once a season

type Packed = number[];
interface PackedEntry {
  pass?: Packed[];
  targets?: Packed[];
  runs?: Packed[];
  fg?: Packed[];
  fgMiss?: Packed[];
  xp?: { att: number; made: number };
  xpMiss?: Packed;
  punt?: Omit<FieldPunt, 'bands'> & { bands: number[] };
}
interface PackedSection {
  league: PackedEntry;
  players: Record<string, PackedEntry>;
  defenses: Record<string, PackedEntry>;
}
export interface PackedFieldMaps {
  season: number;
  updated: string;
  fields?: { fgBands?: string[]; puntBands?: string[] };
  regular: PackedSection | null;
  post: PackedSection | null;
  all: PackedSection | null;
}

const FG_BANDS = ['<30', '30-39', '40-49', '50-59', '60+'];
const PUNT_BANDS = ['<40', '40-49', '50-59', '60+'];

const zone = (t: Packed, i: number): FieldZone => ({ depth: DEPTHS[Math.floor(i / 3)], side: SIDES[i % 3], att: t[0], comp: t[1], yds: t[2], td: t[3], int: t[4], epa: t[5] });
const lane = (t: Packed, i: number): FieldLane => ({ lane: LANES[i], att: t[0], yds: t[1], td: t[2], epa: t[3], success: t[4] });

function expandEntry(e: PackedEntry, fgBands: string[], puntBands: string[]): FieldMapEntry {
  const out: FieldMapEntry = {};
  if (e.pass) out.pass = e.pass.map(zone);
  if (e.targets) out.targets = e.targets.map(zone);
  if (e.runs) out.runs = e.runs.map(lane);
  if (e.fg) out.fg = e.fg.map((t, i) => ({ band: fgBands[i], att: t[0], made: t[1] }));
  if (e.fgMiss) out.fgMiss = e.fgMiss;
  if (e.xp) out.xp = e.xp;
  if (e.xpMiss) out.xpMiss = e.xpMiss;
  if (e.punt) out.punt = { ...e.punt, bands: e.punt.bands.map((n, i) => (typeof n === 'number' ? { band: puntBands[i], n } : (n as { band: string; n: number }))) };
  return out;
}

const expandAll = <T>(rows: Record<string, PackedEntry>, read: (e: PackedEntry) => T) => Object.fromEntries(Object.entries(rows ?? {}).map(([id, e]) => [id, read(e)]));

// The file read back: every section's league, players and defenses as objects (a file already in objects, as
// the first ones were, passes through)
export function expandFieldMaps(file: PackedFieldMaps): FieldMapsFile {
  const fg = file.fields?.fgBands ?? FG_BANDS;
  const punt = file.fields?.puntBands ?? PUNT_BANDS;
  const read = (e: PackedEntry) => (Array.isArray(e.pass?.[0] ?? e.targets?.[0] ?? e.runs?.[0] ?? e.fg?.[0] ?? []) ? expandEntry(e, fg, punt) : (e as unknown as FieldMapEntry));
  const section = (s: PackedSection | null): FieldMapSection | null =>
    s && {
      league: read(s.league) as FieldMapSection['league'],
      players: expandAll(s.players, read),
      defenses: expandAll(s.defenses, read),
    };
  return { season: file.season, updated: file.updated, regular: section(file.regular), post: section(file.post), all: section(file.all) };
}

// ---- the tint: a value against the league's, -1 (bad) to 1 (good) for the card's row

// (how many plays it takes before a part's tint reads at full strength: a few throws to a zone say little)
const SETTLE = { zone: 12, lane: 12, band: 4, punt: 12 };

// A value against the league's, in the spread of everyone's with enough plays (the same zone, lane or band,
// the same kind of row), at full strength 2 spreads out, faded by how few plays it rests on; flipped for a
// defense (what it allowed: more is worse)
export function tone(value: number, league: number, spread: number, plays: number, settle: number, flip = false): number {
  if (!plays || !spread) return 0;
  const z = Math.max(-1, Math.min(1, (value - league) / spread / 2));
  return Math.round((flip ? -z : z) * (plays / (plays + settle)) * 1000) / 1000;
}

// The spread of a part's values across the rows with enough plays in it (the standard deviation; null: too
// few rows to tell)
export function spread(values: { value: number; plays: number }[], min: number): number | null {
  const known = values.filter((v) => v.plays >= min).map((v) => v.value);
  if (known.length < 3) return null;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / known.length);
  return sd || null;
}

const GOOD = [62, 224, 122];
const BAD = [255, 90, 79];

// A part's fill on the field: green or red, stronger the further from the league's (none: the turf's own,
// faintly chalked)
export function toneFill(t: number, base = 0.14, reach = 0.66): string {
  if (Math.abs(t) < 0.03) return 'rgba(255, 255, 255, 0.05)';
  const [r, g, b] = t > 0 ? GOOD : BAD;
  return `rgba(${r}, ${g}, ${b}, ${(base + reach * Math.abs(t)).toFixed(3)})`;
}

// A number in its tone: white, leaning green or red the further it is from the league's (as the grid's tint)
export function toneText(t: number): string {
  const [r, g, b] = t >= 0 ? GOOD : BAD;
  const k = Math.min(1, Math.abs(t)) * 0.85;
  const mix = (c: number) => Math.round(255 + (c - 255) * k);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ---- words

const signed = (v: number, places = 2) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(places)}`;
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '-');
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const DEPTHS: FieldDepth[] = ['behind', 'short', 'mid', 'deep'];
const SIDES: FieldSide[] = ['left', 'middle', 'right'];
const DEPTH_WORDS: Record<FieldDepth, { name: string; range: string }> = {
  behind: { name: 'Behind the line', range: 'behind the line of scrimmage' },
  short: { name: 'Short', range: '0-9 air yds' },
  mid: { name: 'Intermediate', range: '10-19 air yds' },
  deep: { name: 'Deep', range: '20+ air yds' },
};

// "Deep middle", "Behind the line, left"
export function zoneName(depth: FieldDepth, side: FieldSide): string {
  return depth === 'behind' ? `Behind the line, ${side}` : `${DEPTH_WORDS[depth].name} ${side}`;
}

export const LANES = ['left end', 'left tackle', 'left guard', 'middle', 'right guard', 'right tackle', 'right end'];
const LANE_SHORT = ['LE', 'LT', 'LG', 'MID', 'RG', 'RT', 'RE'];
const laneName = (lane: string) => lane[0].toUpperCase() + lane.slice(1);

// (a chart short of the row's own count in the grid: the plays the play-by-play gave no direction, said in its
// hover)
function shortOf(total: number, grid: number | undefined, noun: string): string {
  return grid !== undefined && grid > total ? `\n${total} of ${grid} ${noun} charted: plays logged without a direction can't be placed` : '';
}

// ---- the pass map: a field segment looking downfield, the line of scrimmage near the bottom, wider at the
// near end (a touch of perspective); 8 yards behind the line up to 36 past it

export const PASS_BOX = { x: -4, y: -18, w: 308, h: 304 };
const V_MIN = -8;
const V_MAX = 36;
const Y_BOTTOM = 282;
const Y_YARD = (Y_BOTTOM - 8) / (V_MAX - V_MIN);
// (each depth's yards: behind the line, 0-9, 10-19, 20 on)
const BAND_YARDS: Record<FieldDepth, [number, number]> = { behind: [V_MIN, 0], short: [0, 10], mid: [10, 20], deep: [20, V_MAX] };

const fy = (v: number) => Y_BOTTOM - (v - V_MIN) * Y_YARD;
const halfWidth = (v: number) => 150 - (v - V_MIN) * 0.92;
// A spot on the field: u across it (0 the left sideline, 1 the right), v yards past the line
const spot = (u: number, v: number): [number, number] => [r1(150 + (u - 0.5) * 2 * halfWidth(v)), r1(fy(v))];
const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (list: [number, number][]) => list.map(([x, y]) => `${x},${y}`).join(' ');

// The field itself: its outline, the turf's mowed stripes (every 5 yards), the yard lines, the hash marks,
// the numbers at the 10s along both sidelines, the line of scrimmage
export interface PassField {
  outline: string;
  stripes: string[];
  lines: { d: string; band: boolean }[];
  hashes: string;
  numbers: { x: number; y: number; text: string; rotate: number }[];
  los: { x1: number; x2: number; y: number };
  sides: { x: number; y: number; text: string }[];
}

function passField(): PassField {
  const stripes: string[] = [];
  for (let v = V_MIN; v < V_MAX; v += 5) {
    const top = Math.min(v + 5, V_MAX);
    if (((v - V_MIN) / 5) % 2 === 0) stripes.push(pts([spot(0, v), spot(1, v), spot(1, top), spot(0, top)]));
  }
  const lines: { d: string; band: boolean }[] = [];
  for (let v = -5; v < V_MAX; v += 5) {
    if (v === 0) continue;
    const [x1, y] = spot(0, v);
    const [x2] = spot(1, v);
    lines.push({ d: `M${x1} ${y}H${x2}`, band: v === 10 || v === 20 });
  }
  // (a tick every yard at the hashes and in from each sideline)
  let hashes = '';
  for (let v = V_MIN + 1; v < V_MAX; v++) {
    if (v % 5 === 0) continue;
    for (const u of [0.025, 0.44, 0.56, 0.975]) {
      const [x, y] = spot(u, v);
      hashes += `M${r1(x - 2.2)} ${y}h4.4`;
    }
  }
  const numbers: PassField['numbers'] = [];
  for (const v of [10, 20, 30]) {
    for (const [u, rotate] of [
      [0.075, 90],
      [0.925, -90],
    ] as const) {
      const [x, y] = spot(u, v);
      numbers.push({ x, y, text: String(v), rotate });
    }
  }
  const [losL, losY] = spot(0, 0);
  const [losR] = spot(1, 0);
  return {
    outline: pts([spot(0, V_MIN), spot(1, V_MIN), spot(1, V_MAX), spot(0, V_MAX)]),
    stripes,
    lines,
    hashes,
    numbers,
    los: { x1: losL, x2: losR, y: losY },
    sides: SIDES.map((s, i) => ({ x: spot((i + 0.5) / 3, V_MAX)[0], y: r1(fy(V_MAX) - 7), text: s.toUpperCase() })),
  };
}

export const PASS_FIELD = passField();

export type PassKind = 'pass' | 'targets' | 'allowed';

export interface PassZoneView {
  key: string;
  depth: FieldDepth;
  side: FieldSide;
  points: string;
  cx: number;
  cy: number;
  // (efficiency: the zone tinted; volume: a bubble at its center, sized by its share of the throws)
  fill: string;
  r: number;
  bubble: string;
  main: string;
  sub: string;
  subColor: string;
  count: string;
  share: string;
  title: string;
  tone: number;
  empty: boolean;
}

export interface PassMapView {
  kind: PassKind;
  title: string;
  // (its total, "412 throws", beside the title; what it shows, in the title's hover)
  count: string;
  help: string;
  total: number;
  zones: PassZoneView[];
  aria: string;
}

// (the zones' share of the throws the biggest bubble gets: every bubble sized against the busiest zone)
const BUBBLE_MIN = 3.5;
const BUBBLE_MAX = 27;

function passMap(kind: PassKind, zones: FieldZone[], league: FieldZone[], spreads: (number | null)[], who: string, grid?: number): PassMapView {
  const total = zones.reduce((a, z) => a + z.att, 0);
  const most = Math.max(1, ...zones.map((z) => z.att));
  const flip = kind === 'allowed';
  const views = DEPTHS.flatMap((depth) =>
    SIDES.map((side, s) => {
      const i = DEPTHS.indexOf(depth) * 3 + s;
      const z = zones.find((x) => x.depth === depth && x.side === side) ?? { depth, side, att: 0, comp: 0, yds: 0, td: 0, int: 0, epa: 0 };
      const lg = league.find((x) => x.depth === depth && x.side === side);
      const [v0, v1] = BAND_YARDS[depth];
      const [u0, u1] = [s / 3, (s + 1) / 3];
      const [cx, cy] = spot((u0 + u1) / 2, (v0 + v1) / 2);
      const t = lg ? tone(z.epa, lg.epa, spreads[i] ?? 0.4, z.att, SETTLE.zone, flip) : 0;
      const empty = !z.att;
      const where = `${zoneName(depth, side)} (${DEPTH_WORDS[depth].range})`;
      const caught = kind === 'targets' ? `${plural(z.comp, 'catch', 'catches')} on ${plural(z.att, 'target')}` : `${kind === 'allowed' ? 'Allowed ' : ''}${z.comp} of ${z.att} (${pct(z.comp, z.att)})`;
      const rest = [`${z.yds} yds`, z.td ? `${z.td} TD` : '', z.int ? `${z.int} INT` : ''].filter(Boolean).join(', ');
      const share = total ? `${pct(z.att, total)} of ${who}` : '';
      const title = empty
        ? `${where}: none`
        : `${where}: ${caught}, ${rest}\n${signed(z.epa)} EPA a ${kind === 'targets' ? 'target' : 'throw'}${lg ? ` (league ${signed(lg.epa)})` : ''} · ${share}`;
      return {
        key: `${depth}-${side}`,
        depth,
        side,
        points: pts([spot(u0, v0), spot(u1, v0), spot(u1, v1), spot(u0, v1)]),
        cx,
        cy,
        fill: toneFill(t),
        r: empty ? 0 : r1(BUBBLE_MIN + (BUBBLE_MAX - BUBBLE_MIN) * Math.sqrt(z.att / most)),
        bubble: toneFill(t, 0.32, 0.5),
        main: empty ? '' : kind === 'allowed' ? pct(z.comp, z.att) : `${z.comp}/${z.att}`,
        sub: empty ? '' : signed(z.epa),
        subColor: toneText(t),
        count: empty ? '' : String(z.att),
        share: empty ? '' : pct(z.att, total),
        title,
        tone: t,
        empty,
      };
    }),
  );
  const noun = kind === 'targets' ? 'targets' : 'throws';
  return {
    kind,
    title: kind === 'pass' ? 'Passing' : kind === 'targets' ? 'Targets' : 'Pass Defense',
    count: kind === 'targets' ? plural(total, 'target') : plural(total, 'throw'),
    help:
      (kind === 'pass' ? 'Where his throws went' : kind === 'targets' ? 'Where he was thrown to' : 'What it allowed, by where the ball went') +
      ' (air yards past the line, from behind the offense; throws with no spot charted left out). ' +
      (kind === 'allowed' ? 'Each zone: completion % allowed and EPA a throw' : kind === 'targets' ? 'Each zone: catches / targets and EPA a target' : 'Each zone: completions / attempts and EPA a throw') +
      ", tinted against the league's in that zone" +
      shortOf(total, grid, kind === 'targets' ? 'targets' : 'throws'),
    total,
    zones: views,
    aria: passAria(kind, views, total, noun),
  };
}

// (the chart in words: where most of it went, the best and worst zone against the league's)
function passAria(kind: PassKind, zones: PassZoneView[], total: number, noun: string): string {
  const head = `${kind === 'pass' ? 'Passing' : kind === 'targets' ? 'Targets' : 'Passes allowed'} by zone, ${total} ${noun}`;
  if (!total) return head;
  const busiest = [...zones].sort((a, b) => Number.parseInt(b.count || '0') - Number.parseInt(a.count || '0'))[0];
  const ranked = zones.filter((z) => !z.empty).sort((a, b) => b.tone - a.tone);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const words = (z: PassZoneView) => zoneName(z.depth, z.side).toLowerCase();
  return [
    head,
    `most ${words(busiest)} (${busiest.share})`,
    best && best.tone > 0.05 ? `best against the league ${words(best)}` : '',
    worst && worst.tone < -0.05 ? `worst ${words(worst)}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

// ---- the run lanes: arrows fanning from the backfield through the line's gaps, each as far past the line as
// its yards a carry, as thick as its share of the carries

export const RUN_BOX = { x: 0, y: 0, w: 320, h: 226 };
const LOS_Y = 162;
const RUN_YARD = 11;
const BACK = { x: 160, y: 214 };
// (where each lane crosses the line: outside the tight end, between the tackle and the tight end, between
// the guard and the tackle, over the center)
const CROSS = [-108, -74, -44, 0, 44, 74, 108];
const LINE_GAP = 29;

export interface RunField {
  los: number;
  // (the yard lines past the line, every 5, and the 5s marked)
  lines: { y: number; text: string }[];
  linemen: { x: number; y: number; te: boolean }[];
  back: { x: number; y: number };
}

export const RUN_FIELD: RunField = {
  los: LOS_Y,
  lines: [5, 10].map((yd) => ({ y: r1(LOS_Y - yd * RUN_YARD), text: String(yd) })),
  linemen: [-3, -2, -1, 0, 1, 2, 3].map((j) => ({ x: 160 + j * LINE_GAP, y: LOS_Y + 9, te: Math.abs(j) === 3 })),
  back: BACK,
};

export interface LaneView {
  key: string;
  short: string;
  name: string;
  path: string;
  head: string;
  width: number;
  color: string;
  lx: number;
  ly: number;
  main: string;
  sub: string;
  fill: string;
  title: string;
  tone: number;
  empty: boolean;
}

export interface RunMapView {
  title: string;
  count: string;
  help: string;
  total: number;
  lanes: LaneView[];
  aria: string;
}

function runMap(lanes: FieldLane[], league: FieldLane[], spreads: (number | null)[], who: string, allowed: boolean, grid?: number): RunMapView {
  const total = lanes.reduce((a, l) => a + l.att, 0);
  const most = Math.max(1, ...lanes.map((l) => l.att));
  const views = LANES.map((lane, k) => {
    const l = lanes.find((x) => x.lane === lane) ?? { lane, att: 0, yds: 0, td: 0, epa: 0, success: 0 };
    const lg = league.find((x) => x.lane === lane);
    const t = lg ? tone(l.epa, lg.epa, spreads[k] ?? 0.25, l.att, SETTLE.lane, allowed) : 0;
    const empty = !l.att;
    const ypc = l.att ? l.yds / l.att : 0;
    // (the arrow: from the back, bending out through its gap, then straight on to as many yards past the
    // line as it gains a carry, fanning a little outward)
    const cross = { x: 160 + CROSS[k], y: LOS_Y };
    const reach = Math.max(1.2, Math.min(10.5, empty ? 1.2 : ypc)) * RUN_YARD;
    const lean = (k - 3) * 0.11;
    const tip = { x: r1(cross.x + lean * reach), y: r1(LOS_Y - reach) };
    const start = { x: BACK.x + (k - 3) * 3, y: BACK.y - 8 };
    const path = `M${start.x} ${start.y}C${start.x} ${LOS_Y + 26},${r1(cross.x - lean * 22)} ${LOS_Y + 22},${cross.x} ${LOS_Y}L${tip.x} ${tip.y}`;
    const width = empty ? 1.5 : r1(2.2 + 8.5 * Math.sqrt(l.att / most));
    // (its head: a triangle at the tip, along the arrow's last stretch, a touch wider than the shaft)
    const dx = tip.x - cross.x;
    const dy = tip.y - cross.y;
    const len = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / len, dy / len];
    const hw = Math.max(4.5, width * 0.9 + 2);
    const hl = hw * 1.25;
    const head = pts([
      [r1(tip.x + ux * hl), r1(tip.y + uy * hl)],
      [r1(tip.x - uy * hw), r1(tip.y + ux * hw)],
      [r1(tip.x + uy * hw), r1(tip.y - ux * hw)],
    ]);
    const lgYpc = lg && lg.att ? lg.yds / lg.att : null;
    const carries = allowed ? 'carries against it' : 'carries';
    const title = empty
      ? `${laneName(lane)}: no carries`
      : `${laneName(lane)}: ${plural(l.att, 'carry', 'carries').replace('carries', carries)} (${pct(l.att, total)} of ${who}), ${l.yds} yds, ${ypc.toFixed(1)} a carry${lgYpc !== null ? ` (league ${lgYpc.toFixed(1)})` : ''}${l.td ? `, ${l.td} TD` : ''}\n${signed(l.epa)} EPA a carry${lg ? ` (league ${signed(lg.epa)})` : ''} · ${Math.round(l.success * 100)}% successful`;
    return {
      key: lane,
      short: LANE_SHORT[k],
      name: laneName(lane),
      path,
      head,
      width,
      color: empty ? 'rgba(255, 255, 255, 0.25)' : toneArrow(t),
      lx: r1(tip.x + ux * (hl + 4)),
      ly: r1(tip.y + uy * (hl + 4)),
      main: empty ? '' : ypc.toFixed(1),
      sub: empty ? '' : String(l.att),
      fill: toneFill(t),
      title,
      tone: t,
      empty,
    };
  });
  const ranked = views.filter((v) => !v.empty).sort((a, b) => b.tone - a.tone);
  const busiest = [...views].sort((a, b) => Number(b.sub || 0) - Number(a.sub || 0))[0];
  const aria = [
    `${allowed ? 'Runs allowed' : 'Runs'} by lane, ${total} carries`,
    total ? `most ${busiest.name.toLowerCase()} (${busiest.main} a carry)` : '',
    ranked.length && ranked[0].tone > 0.05 ? `best ${ranked[0].name.toLowerCase()}` : '',
    ranked.length && ranked[ranked.length - 1].tone < -0.05 ? `worst ${ranked[ranked.length - 1].name.toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return { title: allowed ? 'Run Defense' : 'Run Lanes', count: plural(total, 'carry', 'carries'),
    help: allowed
      ? "Yards a carry allowed by lane (where the runs against it went, from the offense's left), tinted against the league's in that lane"
      : "Where his carries went, from the offense's left (scrambles and kneels left out): each arrow as far as his yards a carry, as wide as its share, tinted by EPA a carry against the league's in that lane" +
        shortOf(total, grid, 'carries'),
    total, lanes: views, aria };
}

// (an arrow's color: the chalk's white, leaning green or red, solid)
function toneArrow(t: number): string {
  if (Math.abs(t) < 0.03) return 'rgb(225, 228, 222)';
  const [r, g, b] = t > 0 ? GOOD : BAD;
  const k = 0.35 + 0.65 * Math.min(1, Math.abs(t));
  const mix = (c: number) => Math.round(225 + (c - 225) * k);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ---- the kicks: field goals by distance, rings stepping away from the uprights (the nearer the band, the
// closer to the posts), each its makes over its tries

export const KICK_BOX = { x: 0, y: 0, w: 320, h: 232 };
const POSTS = { x: 160, y: 40 };
const RING_IN = 24;
const RING_STEP = 33;
const RING_ANGLE = (40 * Math.PI) / 180;

export interface KickBandView {
  key: string;
  label: string;
  path: string;
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  main: string;
  sub: string;
  subColor: string;
  fill: string;
  title: string;
  tone: number;
  empty: boolean;
}

export interface KickMapView {
  bands: KickBandView[];
  count: string;
  total: string;
  xp: string | null;
  xpTitle: string;
  posts: { x: number; y: number };
  // (the misses, marked round the rings, and said under the chart; null: a file from before they were read)
  misses: KickMissesView | null;
  aria: string;
}

// ---- a kicker's misses: each band's marked round its ring, wide left out past its left end, wide right past
// its right (as he sees the posts), short, blocked and the rest inside it, a row after its makes over tries;
// a count by a mark of more than one (a phone's: in its hover), all of them said in a line under the chart

export const MISS_KINDS = ['left', 'right', 'short', 'blocked', 'other'] as const;
export type MissKind = (typeof MISS_KINDS)[number];
const MISS_WORDS: Record<MissKind, string> = { left: 'wide left', right: 'wide right', short: 'short', blocked: 'blocked', other: 'missed another way' };
// (how far past a ring's end a wide one sits, along its arc: clear of the band's label; the row inside, its
// marks and counts, after the ring's makes over tries, a hand-written figure about this wide)
const WIDE_OUT = 12;
const FIGURE = 2.9;
const NEAR_MARK = 6;
const NEAR_COUNT = 5;
const NEAR_GAP = 3;

export interface KickMissMark {
  key: string;
  kind: MissKind;
  band: string;
  n: number;
  x: number;
  y: number;
  // (the count beside it, more than one; anchored away from the ring)
  count: string;
  nx: number;
  ny: number;
  anchor: 'start' | 'end';
  // (its shape: a ball wide or the rest, a ball dropping short, a cross blocked)
  d: string;
  title: string;
}

export interface KickMissesView {
  marks: KickMissMark[];
  // ("2 wide right · 1 short", the extra points' apart; none: "No misses")
  fg: string;
  xp: string;
  none: boolean;
  aria: string;
}

// (a mark's shape at x, y)
function missShape(kind: MissKind, x: number, y: number): string {
  const r = 2.8;
  const at = (dx: number, dy: number) => `${r1(x + dx)} ${r1(y + dy)}`;
  if (kind === 'blocked') return `M${at(-2.6, -2.6)}L${at(2.6, 2.6)}M${at(2.6, -2.6)}L${at(-2.6, 2.6)}`;
  if (kind === 'short') return `M${at(-3.2, -2.4)}H${r1(x + 3.2)}L${at(0, 3)}Z`;
  return `M${at(-r, 0)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

const yardsOf = (band: string) => (band === '<30' ? 'under 30 yds' : band === '60+' ? '60+ yds' : `${bandLabel(band)} yds`);
const missList = (m: KickMisses | undefined) =>
  MISS_KINDS.map((kind, i) => ({ kind, n: m?.[i] ?? 0 }))
    .filter((k) => k.n)
    .map((k) => `${k.n} ${k.kind === 'other' ? 'other' : MISS_WORDS[k.kind]}`)
    .join(' · ');

// The misses' marks and words (bands: the field goal bands' names, fgMiss's order); null when the file has
// no misses to read
// (mains: each ring's makes over tries as it reads, "9/11": the row inside goes after it)
export function kickMisses(bands: string[], fgMiss: KickMisses[] | undefined, xpMiss?: KickMisses, mains: string[] = []): KickMissesView | null {
  if (!fgMiss) return null;
  const marks: KickMissMark[] = [];
  bands.forEach((band, i) => {
    const m = fgMiss[i] ?? [];
    const r0 = RING_IN + i * RING_STEP;
    const rm = r0 + RING_STEP / 2;
    const title = (kind: MissKind, n: number) => `${n} ${MISS_WORDS[kind]} from ${yardsOf(band)}`;
    // (wide: out past the ring's ends, at its middle)
    for (const [k, side] of [[0, -1], [1, 1]] as const) {
      const n = m[k] ?? 0;
      if (!n) continue;
      const a = side * (RING_ANGLE + WIDE_OUT / rm);
      const x = r1(POSTS.x + rm * Math.sin(a));
      const y = r1(POSTS.y + rm * Math.cos(a));
      const kind = MISS_KINDS[k];
      marks.push({ key: `${band}-${kind}`, kind, band, n, x, y, count: n > 1 ? String(n) : '', nx: r1(x + side * 5.5), ny: r1(y + 3), anchor: side < 0 ? 'end' : 'start', d: missShape(kind, x, y), title: title(kind, n) });
    }
    // (short, blocked, other: a row inside the ring, after its makes over tries)
    const near = [2, 3, 4].filter((k) => m[k]).map((k) => ({ kind: MISS_KINDS[k], n: m[k] }));
    // (each a mark and, more than one, its count after it)
    const widths = near.map((k) => NEAR_MARK + (k.n > 1 ? NEAR_COUNT : 0));
    let left = POSTS.x + (mains[i] ?? '').length * FIGURE + 4;
    near.forEach((k, j) => {
      const x = left + NEAR_MARK / 2;
      const y = r1(POSTS.y + rm - 3);
      marks.push({ key: `${band}-${k.kind}`, kind: k.kind, band, n: k.n, x: r1(x), y, count: k.n > 1 ? String(k.n) : '', nx: r1(x + NEAR_MARK / 2 + 1), ny: r1(y + 2.8), anchor: 'start', d: missShape(k.kind, x, y), title: title(k.kind, k.n) });
      left += widths[j] + NEAR_GAP;
    });
  });
  const fg = missList(fgMiss.reduce((t, m) => t.map((v, i) => v + (m[i] ?? 0)), [0, 0, 0, 0, 0]));
  const xp = missList(xpMiss);
  return {
    marks,
    fg,
    xp,
    none: !fg && !xp,
    aria: !fg && !xp ? 'No misses' : [fg && `Field goals missed: ${fg.replaceAll(' · ', ', ')}`, xp && `extra points missed: ${xp.replaceAll(' · ', ', ')}`].filter(Boolean).join('; '),
  };
}

// An annular slice: rings r0 to r1 around the posts, swung either side of straight down
function ring(r0: number, r1: number): string {
  const at = (r: number, a: number) => `${(POSTS.x + r * Math.sin(a)).toFixed(1)} ${(POSTS.y + r * Math.cos(a)).toFixed(1)}`;
  return `M${at(r0, -RING_ANGLE)}L${at(r1, -RING_ANGLE)}A${r1} ${r1} 0 0 0 ${at(r1, RING_ANGLE)}L${at(r0, RING_ANGLE)}A${r0} ${r0} 0 0 1 ${at(r0, -RING_ANGLE)}Z`;
}

const bandLabel = (band: string) => band.replace('-', '–');

function kickMap(
  fg: FieldBand[],
  xp: { att: number; made: number } | undefined,
  league: FieldBand[],
  spreads: (number | null)[],
  leagueXp: number | null,
  fgMiss?: KickMisses[],
  xpMiss?: KickMisses,
): KickMapView {
  const misses = kickMisses(
    fg.map((b) => b.band),
    fgMiss,
    xpMiss,
    fg.map((b) => (b.att ? `${b.made}/${b.att}` : '')),
  );
  const bands = fg.map((b, i) => {
    const lg = league.find((x) => x.band === b.band);
    const rate = b.att ? b.made / b.att : 0;
    const lgRate = lg && lg.att ? lg.made / lg.att : null;
    const t = lgRate !== null ? tone(rate, lgRate, spreads[i] ?? 0.15, b.att, SETTLE.band) : 0;
    const r0 = RING_IN + i * RING_STEP;
    const rm = r0 + RING_STEP / 2;
    const empty = !b.att;
    const yards = yardsOf(b.band);
    const missed = missList(fgMiss?.[i]);
    return {
      key: b.band,
      label: bandLabel(b.band),
      path: ring(r0 + 1, r0 + RING_STEP - 1),
      cx: POSTS.x,
      cy: r1(POSTS.y + rm + 1),
      lx: r1(POSTS.x + (rm + 2) * Math.sin(RING_ANGLE) + 6),
      ly: r1(POSTS.y + (rm + 2) * Math.cos(RING_ANGLE) + 3),
      main: empty ? '' : `${b.made}/${b.att}`,
      sub: empty ? '' : pct(b.made, b.att),
      subColor: toneText(t),
      fill: empty ? 'rgba(255, 255, 255, 0.03)' : toneFill(t, 0.14, 0.6),
      title: empty
        ? `Field goals ${yards}: none tried`
        : `Field goals ${yards}: ${b.made} of ${b.att} (${pct(b.made, b.att)})${lgRate !== null ? ` · league ${Math.round(lgRate * 100)}%` : ''}${missed ? `\nMissed: ${missed}` : ''}`,
      tone: t,
      empty,
    };
  });
  const made = fg.reduce((a, b) => a + b.made, 0);
  const att = fg.reduce((a, b) => a + b.att, 0);
  const long = [...fg].reverse().find((b) => b.made);
  return {
    bands,
    count: plural(att, 'try', 'tries'),
    total: att ? `${made}/${att} field goals (${pct(made, att)})` : 'No field goals tried',
    xp: xp && xp.att ? `${xp.made}/${xp.att} extra points (${pct(xp.made, xp.att)})` : null,
    xpTitle: xp && xp.att ? `Extra points: ${xp.made} of ${xp.att}${leagueXp !== null ? ` · league ${Math.round(leagueXp * 100)}%` : ''}` : '',
    posts: POSTS,
    misses,
    aria: `Field goals by distance: ${bands.map((b) => `${b.label} ${b.empty ? 'none' : b.main.replace('/', ' of ')}`).join(', ')}${long ? `; makes out to ${long.band}` : ''}${misses ? `. ${misses.aria}` : ''}`,
  };
}

// ---- the punts: down the field from a usual spot (his own 35), the average punt's flight to where it came
// down (gross), the return back to where it ended (net), the league's of each as ticks; under it how far
// they went, band by band, the league's share of each as a tick

export const PUNT_BOX = { x: 0, y: 0, w: 340, h: 172 };
const PUNT_LOS = 14;
const PUNT_YARD = 4;
const FIELD_TOP = 40;
const FIELD_BOTTOM = 96;
// (the punt spot's yard line: the 35, 65 yards to the goal line)
const TO_GOAL = 65;

export interface PuntView {
  // (the punts kicked: blocked ones counted apart, as the grid's Punts does)
  count: string;
  los: number;
  top: number;
  bottom: number;
  goal: number;
  end: number;
  lines: { x: number; major: boolean }[];
  numbers: { x: number; text: string }[];
  arc: string;
  landX: number;
  netX: number;
  leagueGross: number;
  leagueNet: number;
  grossText: string;
  netText: string;
  grossTitle: string;
  netTitle: string;
  grossColor: string;
  netColor: string;
  bars: { x: number; w: number; y: number; h: number; label: string; n: string; leagueY: number | null; title: string }[];
  chips: { label: string; value: string; sub: string; color: string; title: string }[];
  aria: string;
}

const px = (yards: number) => r1(PUNT_LOS + Math.max(0, Math.min(TO_GOAL + 10, yards)) * PUNT_YARD);

function puntView(p: FieldPunt, league: FieldPunt, spreads: { gross: number | null; net: number | null; inside20: number | null; touchbacks: number | null; fairCatches: number | null }): PuntView {
  const lines: PuntView['lines'] = [];
  for (let yd = 5; yd < TO_GOAL; yd += 5) lines.push({ x: px(yd), major: (yd + 35) % 10 === 0 });
  // (the yard numbers: own 40, midfield, their 40 down to their 10)
  const numbers = [5, 15, 25, 35, 45, 55].map((yd) => {
    const line = 35 + yd;
    return { x: px(yd), text: String(line <= 50 ? line : 100 - line) };
  });
  const landX = px(p.gross);
  const apex = FIELD_TOP - 30;
  const mid = (PUNT_LOS + landX) / 2;
  const arc = `M${PUNT_LOS} ${FIELD_TOP + 22}Q${r1(mid)} ${apex - 26},${landX} ${FIELD_TOP + 22}`;
  const gt = tone(p.gross, league.gross, spreads.gross ?? 2.5, p.n, SETTLE.punt);
  const nt = tone(p.net, league.net, spreads.net ?? 2.5, p.n, SETTLE.punt);
  const leagueN = league.bands.reduce((a, b) => a + b.n, 0);
  const total = p.bands.reduce((a, b) => a + b.n, 0);
  // (each band's bar under its stretch of the field: under 40 its last ten yards before 40)
  const spans: Record<string, [number, number]> = { '<40': [30, 40], '40-49': [40, 50], '50-59': [50, 60], '60+': [60, 70] };
  const barTop = 112;
  const barBottom = 150;
  const shares = p.bands.map((b) => (total ? b.n / total : 0));
  const leagueShares = p.bands.map((b) => (leagueN ? (league.bands.find((x) => x.band === b.band)?.n ?? 0) / leagueN : 0));
  const topShare = Math.max(0.01, ...shares, ...leagueShares);
  const bars = p.bands.map((b, i) => {
    const [a, z] = spans[b.band] ?? [0, 10];
    const h = r1(((barBottom - barTop) * shares[i]) / topShare);
    return {
      x: r1(px(a) + 2),
      w: r1((z - a) * PUNT_YARD - 4),
      y: r1(barBottom - h),
      h,
      label: b.band === '<40' ? '<40' : bandLabel(b.band),
      n: String(b.n),
      leagueY: leagueN ? r1(barBottom - ((barBottom - barTop) * leagueShares[i]) / topShare) : null,
      title: `${b.band === '<40' ? 'Under 40' : b.band === '60+' ? '60+' : bandLabel(b.band)} yds: ${plural(b.n, 'punt')} (${pct(b.n, total)})${leagueN ? ` · league ${Math.round(leagueShares[i] * 100)}%` : ''}`,
    };
  });
  const rate = (n: number) => (p.n ? n / p.n : 0);
  const leagueRate = (n: number) => (league.n ? n / league.n : 0);
  const chip = (label: string, n: number, lg: number, sd: number | null, good: boolean, help: string) => {
    const t = tone(rate(n), leagueRate(lg), sd ?? 0.08, p.n, SETTLE.punt, !good);
    return {
      label,
      value: String(n),
      sub: pct(n, p.n),
      color: toneText(t),
      title: `${help}: ${n} of ${plural(p.n, 'punt')} (${pct(n, p.n)}) · league ${Math.round(leagueRate(lg) * 100)}%`,
    };
  };
  const chips = [
    chip('Inside 20', p.inside20, league.inside20, spreads.inside20, true, 'Downed, caught or out of bounds inside the 20'),
    chip('Fair catches', p.fairCatches, league.fairCatches, spreads.fairCatches, true, 'Fair caught (no return)'),
    chip('Touchbacks', p.touchbacks, league.touchbacks, spreads.touchbacks, false, 'Into the end zone (out to the 20)'),
  ];
  if (p.blocked) chips.push(chip('Blocked', p.blocked, league.blocked, null, false, 'Blocked'));
  return {
    count: plural(p.n - p.blocked, 'punt'),
    los: PUNT_LOS,
    top: FIELD_TOP,
    bottom: FIELD_BOTTOM,
    goal: px(TO_GOAL),
    end: px(TO_GOAL + 10),
    lines,
    numbers,
    arc,
    landX,
    netX: px(p.net),
    leagueGross: px(league.gross),
    leagueNet: px(league.net),
    grossText: p.gross.toFixed(1),
    netText: p.net.toFixed(1),
    grossTitle: `Gross: ${p.gross.toFixed(1)} yds a punt (league ${league.gross.toFixed(1)}) on ${plural(p.n, 'punt')}`,
    netTitle: `Net: ${p.net.toFixed(1)} yds a punt after the returns and touchbacks (league ${league.net.toFixed(1)})`,
    grossColor: toneText(gt),
    netColor: toneText(nt),
    bars,
    chips,
    aria: `Punting: ${plural(p.n, 'punt')}, ${p.gross.toFixed(1)} yds gross and ${p.net.toFixed(1)} net (league ${league.gross.toFixed(1)} and ${league.net.toFixed(1)}), ${p.inside20} inside the 20, ${p.touchbacks} touchbacks`,
  };
}

// ---- the panel's view for a row

export type FieldMapRole = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'P' | 'DEF';

export interface FieldMapView {
  pass: PassMapView | null;
  runs: RunMapView | null;
  // (a defense's run lanes: a strip of cells under its pass map, not arrows)
  strip: RunMapView | null;
  kicks: KickMapView | null;
  punts: PuntView | null;
  // (a back's runs before his targets)
  runsFirst: boolean;
}

// The spreads of a section's parts across its rows with enough plays (kept with the section: every card
// of the season reads the same ones)
const SPREADS = new WeakMap<FieldMapSection, Map<string, unknown>>();
function spreadsOf<T>(section: FieldMapSection, key: string, make: () => T): T {
  let known = SPREADS.get(section);
  if (!known) SPREADS.set(section, (known = new Map()));
  if (!known.has(key)) known.set(key, make());
  return known.get(key) as T;
}

const zoneSpreads = (rows: (FieldZone[] | undefined)[]) =>
  Array.from({ length: 12 }, (_, i) =>
    spread(
      rows.filter((z): z is FieldZone[] => !!z?.[i]).map((z) => ({ value: z[i].epa, plays: z[i].att })),
      SETTLE.zone,
    ),
  );
const laneSpreads = (rows: (FieldLane[] | undefined)[]) =>
  LANES.map((lane) =>
    spread(
      rows.flatMap((r) => r?.filter((l) => l.lane === lane) ?? []).map((l) => ({ value: l.epa, plays: l.att })),
      SETTLE.lane,
    ),
  );

// The row's entry: a player's by his id (a QB's row is keyed by his ESPN id, QB-8439 as 8439), a defense's
// by its own
export function fieldMapEntry(section: FieldMapSection, ids: (string | number | null | undefined)[]): FieldMapEntry | null {
  for (const id of ids) {
    if (id === null || id === undefined || id === '') continue;
    const key = String(id);
    const found = section.players[key] ?? section.defenses[key] ?? (key.startsWith('QB-') ? section.players[key.slice(3)] : undefined);
    if (found) return found;
  }
  return null;
}

// The Field Map for a row on a card: the charts its position reads (a QB his throws and his runs, a back his
// runs and his targets, a receiver his targets, a kicker his kicks, a punter his punts, a defense what it
// allowed), each against the league's; null when there's nothing to draw
// (grid: the row's own counts in the grid, its carries and targets: a chart short of them says so)
export function fieldMapView(
  section: FieldMapSection,
  role: FieldMapRole,
  ids: (string | number | null | undefined)[],
  grid: { carries?: number; targets?: number } = {},
): FieldMapView | null {
  const entry = fieldMapEntry(section, ids);
  if (!entry) return null;
  const league = section.league;
  const players = Object.values(section.players);
  const defenses = Object.values(section.defenses);
  const view: FieldMapView = { pass: null, runs: null, strip: null, kicks: null, punts: null, runsFirst: role === 'RB' };
  const has = (zones: FieldZone[] | undefined) => !!zones?.some((z) => z.att);
  const carries = (lanes: FieldLane[] | undefined) => lanes?.reduce((a, l) => a + l.att, 0) ?? 0;
  if (role === 'DEF') {
    if (has(entry.pass)) view.pass = passMap('allowed', entry.pass!, league.pass, spreadsOf(section, 'def-pass', () => zoneSpreads(defenses.map((d) => d.pass))), 'the throws against it');
    if (carries(entry.runs)) view.strip = runMap(entry.runs!, league.runs, spreadsOf(section, 'def-runs', () => laneSpreads(defenses.map((d) => d.runs))), 'the carries against it', true);
  } else if (role === 'K') {
    if (entry.fg?.some((b) => b.att) || entry.xp?.att) {
      const spreads = spreadsOf(section, 'fg', () =>
        league.fg.map((_, i) =>
          spread(
            players.filter((p) => p.fg?.[i]).map((p) => ({ value: p.fg![i].att ? p.fg![i].made / p.fg![i].att : 0, plays: p.fg![i].att })),
            SETTLE.band,
          ),
        ),
      );
      const kickers = players.filter((p) => p.xp);
      const xpAtt = kickers.reduce((a, p) => a + p.xp!.att, 0);
      const xpMade = kickers.reduce((a, p) => a + p.xp!.made, 0);
      const leagueXp = league.xp?.att ? league.xp.made / league.xp.att : xpAtt ? xpMade / xpAtt : null;
      // (a kicker with only extra points: the bands empty, his misses none)
      const fgMiss = entry.fgMiss ?? (!entry.fg && entry.xpMiss ? league.fg.map(() => [0, 0, 0, 0, 0]) : undefined);
      view.kicks = kickMap(entry.fg ?? league.fg.map((b) => ({ band: b.band, att: 0, made: 0 })), entry.xp, league.fg, spreads, leagueXp, fgMiss, entry.xpMiss);
    }
  } else if (role === 'P') {
    if (entry.punt?.n) {
      const punters = players.filter((p) => p.punt?.n).map((p) => p.punt!);
      const of = (get: (p: FieldPunt) => number) => spread(punters.map((p) => ({ value: get(p), plays: p.n })), SETTLE.punt);
      const spreads = spreadsOf(section, 'punt', () => ({
        gross: of((p) => p.gross),
        net: of((p) => p.net),
        inside20: of((p) => p.inside20 / p.n),
        touchbacks: of((p) => p.touchbacks / p.n),
        fairCatches: of((p) => p.fairCatches / p.n),
      }));
      view.punts = puntView(entry.punt, league.punt, spreads);
    }
  } else {
    const throws = role === 'QB' ? entry.pass : entry.targets;
    if (has(throws)) {
      const kind: PassKind = role === 'QB' ? 'pass' : 'targets';
      const spreads = spreadsOf(section, kind, () => zoneSpreads(players.map((p) => p[kind])));
      view.pass = passMap(kind, throws!, league.pass, spreads, kind === 'pass' ? 'his throws' : 'his targets', kind === 'targets' ? grid.targets : undefined);
    }
    // (a receiver's runs only when there are enough of them to say something: his jet sweeps and reverses)
    const runs = carries(entry.runs);
    if (runs && (role === 'RB' || role === 'QB' || runs >= 10)) {
      view.runs = runMap(entry.runs!, league.runs, spreadsOf(section, 'runs', () => laneSpreads(players.map((p) => p.runs))), 'his carries', false, grid.carries);
    }
  }
  return view.pass || view.runs || view.strip || view.kicks || view.punts ? view : null;
}
