// The Tracker's plain pieces (no Angular, no Firebase): a pinned comparison's snapshot (each side's rank,
// score, skills and the compare view's columns, as numbers), what's changed since (each one's move, colored
// better or worse), the days it's been looked at (a point a day, kept on the pin), the rank chart drawn from
// them, and the link's own bits. Tested by tests/tracker.test.mjs; firestore.rules checks the same limits.

// The limits (firestore.rules checks the same)
export const PIN_TITLE_MAX = 80;
export const PIN_SPEC_MAX = 4000;
export const PIN_HISTORY_MAX = 200;
export const PINS_MAX = 60;

// ---------------------------------------------------------------------------
// A snapshot: the compare view's numbers for each side at one moment
// ---------------------------------------------------------------------------
// A column's value: the number behind it, where it stood in its own season's list (0-1), its text
export interface PinStat {
  v: number | null;
  p: number | null;
  t: string;
}

export interface PinSideSnap {
  // tab/season/id (the compare view's key), and who
  key: string;
  position: string;
  season: number;
  id: string;
  name: string;
  tab: string;
  rank: number;
  of: number;
  pct: number;
  // (the list's score behind the rank: rank-why's)
  score: number | null;
  // Each skill's percentile and each column's value, in the snapshot's skills' and rows' order (null:
  // not one of his)
  skills: (number | null)[];
  stats: (PinStat | null)[];
}

export interface PinSnapshot {
  // (when, ms)
  at: number;
  sides: PinSideSnap[];
  skills: { id: string; name: string; tab: string | null }[];
  rows: { key: string; label: string; name: string; group: string; lower: boolean }[];
}

// A day it was looked at: each side's rank, of how many, percentile and score
export interface PinPoint {
  d: string;
  sides: { k: string; r: number; o: number; p: number; s: number | null }[];
}

export interface Pin {
  id: string;
  title: string;
  // (the compare's link, as share.ts writes it: list=…&cmp=…)
  spec: string;
  sport: string;
  order: number;
  baseline: PinSnapshot;
  history: PinPoint[];
  createdAt: number | null;
}

// What a snapshot is made from: the compare view's sides and its view (player-compare.ts), in their order
export interface SnapSide {
  key: string;
  position: string;
  season: number;
  gsisId: string;
  name: string;
  tabLabel: string;
  rank: number;
  of: number;
  pct: number;
}

export interface SnapView {
  skills: { id: string; name: string; tab: string | null; pcts: (number | null)[] }[];
  groups: { title: string; rows: { key: string; label: string; name: string; cells: { text: string; value: number | null; pct: number | null; lowerBetter: boolean }[] }[] }[];
}

const round = (n: number, places = 3) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function snapshotOf(sides: SnapSide[], view: SnapView | null, scores: (number | null)[], at: number): PinSnapshot {
  const skills = view?.skills ?? [];
  const rows = (view?.groups ?? []).flatMap((g) => g.rows.map((row) => ({ group: g.title, row })));
  return {
    at,
    skills: skills.map((s) => ({ id: s.id, name: s.name, tab: s.tab ?? null })),
    rows: rows.map(({ group, row }) => ({ key: row.key, label: row.label, name: row.name, group, lower: !!row.cells.find((c) => c.value !== null)?.lowerBetter })),
    sides: sides.map((side, i) => ({
      key: side.key,
      position: side.position,
      season: side.season,
      id: side.gsisId,
      name: side.name,
      tab: side.tabLabel,
      rank: side.rank,
      of: side.of,
      pct: round(side.pct),
      score: scores[i] == null || !Number.isFinite(scores[i]) ? null : round(scores[i]!),
      skills: skills.map((s) => (s.pcts[i] == null ? null : round(s.pcts[i]!))),
      stats: rows.map(({ row }) => {
        const c = row.cells[i];
        if (!c || c.text === '-') return null;
        return { v: c.value === null || !Number.isFinite(c.value) ? null : round(c.value, 4), p: c.pct === null ? null : round(c.pct), t: c.text };
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// What's changed since it was pinned
// ---------------------------------------------------------------------------
export interface TrackCell {
  // now's text, and then's ('-': not one of his)
  text: string;
  then: string;
  // the change as the column writes it ("+1.2", "−3"; null: none to tell), its way, and whether that's better
  delta: string | null;
  dir: 'up' | 'down' | null;
  good: boolean | null;
  // (how far it moved in its own list since: percentile points, 0-1; null: can't tell)
  shift: number | null;
}

export interface TrackRow {
  key: string;
  label: string;
  name: string;
  group: string;
  kind: 'skill' | 'stat';
  cells: TrackCell[];
}

export interface TrackSide {
  key: string;
  then: PinSideSnap | null;
  now: PinSideSnap | null;
  // places up (+) or down (−) since; the score's change
  moved: number | null;
  scoreMove: number | null;
}

export interface TrackView {
  sides: TrackSide[];
  skills: TrackRow[];
  stats: TrackRow[];
}

// "+1.2" / "−3" / "0": a change written to the places given, with a real minus
export function signed(n: number, places = 0): string {
  const fixed = Math.abs(n).toFixed(places);
  if (Number(fixed) === 0) return (0).toFixed(places);
  return (n > 0 ? '+' : '−') + fixed;
}

// A column's text as a number, when it's one ("4,123", "67.5%", ".312", "−0.05"): its value and places
export function textNumber(text: string): { n: number; places: number } | null {
  const m = text.trim().match(/^([+\-−]?)(\d[\d,]*)?(?:\.(\d+))?%?$/);
  if (!m || (!m[2] && !m[3])) return null;
  const n = Number(`${m[1] && m[1] !== '+' ? '-' : ''}${(m[2] ?? '0').replace(/,/g, '')}.${m[3] ?? '0'}`);
  return Number.isFinite(n) ? { n, places: m[3]?.length ?? 0 } : null;
}

// A column's change: read off the texts the view writes (so a rate shown as 67.5% moves by 1.2, not 0.012),
// better by its way (less, where less is better); text that isn't a number: by the values behind it
export function statCell(then: PinStat | null, now: PinStat | null, lower: boolean): TrackCell {
  const cell: TrackCell = { text: now?.t ?? '-', then: then?.t ?? '-', delta: null, dir: null, good: null, shift: null };
  if (!then || !now) return cell;
  if (then.p !== null && now.p !== null) cell.shift = round(now.p - then.p);
  const a = textNumber(then.t);
  const b = textNumber(now.t);
  let change: number | null = null;
  if (a && b) {
    const places = Math.max(a.places, b.places);
    change = round(b.n - a.n, places);
    cell.delta = signed(change, places);
  } else if (then.v !== null && now.v !== null) {
    change = now.v - then.v;
  }
  if (change === null || change === 0) return cell;
  cell.dir = change > 0 ? 'up' : 'down';
  cell.good = lower ? change < 0 : change > 0;
  return cell;
}

// A skill's change: its percentile ("88"), the change in points
export function skillCell(then: number | null, now: number | null): TrackCell {
  const text = (p: number | null) => (p === null ? '-' : String(Math.round(p * 100)));
  const cell: TrackCell = { text: text(now), then: text(then), delta: null, dir: null, good: null, shift: null };
  if (then === null || now === null) return cell;
  const change = Math.round(now * 100) - Math.round(then * 100);
  cell.delta = signed(change);
  if (change) {
    cell.dir = change > 0 ? 'up' : 'down';
    cell.good = change > 0;
  }
  return cell;
}

// Now against then: the sides in now's order (one gone since: then's, with nothing now), each skill and
// column either one has, now's order first
export function trackView(then: PinSnapshot, now: PinSnapshot | null): TrackView {
  const current = now ?? { ...then, sides: [] };
  const keys = [...current.sides.map((s) => s.key), ...then.sides.map((s) => s.key).filter((k) => !current.sides.some((s) => s.key === k))];
  const sides = keys.map((key): TrackSide => {
    const a = then.sides.find((s) => s.key === key) ?? null;
    const b = now ? (current.sides.find((s) => s.key === key) ?? null) : null;
    return {
      key,
      then: a,
      now: b,
      moved: a && b ? a.rank - b.rank : null,
      scoreMove: a?.score != null && b?.score != null ? round(b.score - a.score) : null,
    };
  });
  const sideOf = (snap: PinSnapshot, key: string) => snap.sides.find((s) => s.key === key) ?? null;

  const skillIds = [...current.skills.map((s) => s.id), ...then.skills.map((s) => s.id)].filter((id, i, all) => all.indexOf(id) === i);
  const skills = skillIds.map((id): TrackRow => {
    const def = current.skills.find((s) => s.id === id) ?? then.skills.find((s) => s.id === id)!;
    const ti = then.skills.findIndex((s) => s.id === id);
    const ni = current.skills.findIndex((s) => s.id === id);
    return {
      key: id,
      label: def.tab ? `${def.name} (${def.tab})` : def.name,
      name: def.name,
      group: 'Skills',
      kind: 'skill',
      cells: sides.map((s) => skillCell(ti < 0 ? null : (sideOf(then, s.key)?.skills[ti] ?? null), ni < 0 || !now ? null : (sideOf(current, s.key)?.skills[ni] ?? null))),
    };
  });

  const rowKeys = [...current.rows.map((r) => r.key), ...then.rows.map((r) => r.key)].filter((k, i, all) => all.indexOf(k) === i);
  const stats = rowKeys.map((key): TrackRow => {
    const def = current.rows.find((r) => r.key === key) ?? then.rows.find((r) => r.key === key)!;
    const ti = then.rows.findIndex((r) => r.key === key);
    const ni = current.rows.findIndex((r) => r.key === key);
    return {
      key,
      label: def.label,
      name: def.name,
      group: def.group,
      kind: 'stat',
      cells: sides.map((s) =>
        statCell(ti < 0 ? null : (sideOf(then, s.key)?.stats[ti] ?? null), ni < 0 || !now ? null : (sideOf(current, s.key)?.stats[ni] ?? null), def.lower),
      ),
    };
  });
  return { sides, skills, stats };
}

// The columns a card shows before All stats: the ones that have moved most in their lists since (each side's
// place among its peers, so a counting stat's climb through the season doesn't crowd out the rest); nothing
// moved yet (pinned today), the first group that's mostly numbers (the box score, not a record); in the
// view's order either way
export function keyStats(rows: TrackRow[], count = 6): TrackRow[] {
  const numeric = rows.filter((r) => r.cells.filter((c) => textNumber(c.text) || textNumber(c.then)).length * 2 >= r.cells.length);
  const moved = (r: TrackRow) => Math.max(0, ...r.cells.map((c) => Math.abs(c.shift ?? 0)));
  const movers = numeric.filter((r) => moved(r) >= 0.01).sort((a, b) => moved(b) - moved(a)).slice(0, count);
  if (movers.length) return numeric.filter((r) => movers.includes(r));
  const groups = [...new Set(numeric.map((r) => r.group))];
  const group = groups.find((g) => numeric.filter((r) => r.group === g).length >= 3) ?? groups[0];
  return numeric.filter((r) => r.group === group).slice(0, count);
}

// ---------------------------------------------------------------------------
// The days it's been looked at
// ---------------------------------------------------------------------------
// ("2026-10-09", the viewer's own day)
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function pointOf(snap: PinSnapshot, ms = snap.at): PinPoint {
  return { d: dayOf(ms), sides: snap.sides.map((s) => ({ k: s.key, r: s.rank, o: s.of, p: s.pct, s: s.score })) };
}

const samePoint = (a: PinPoint, b: PinPoint) =>
  a.sides.length === b.sides.length && a.sides.every((s, i) => s.k === b.sides[i].k && s.r === b.sides[i].r && s.o === b.sides[i].o && s.s === b.sides[i].s);

// Today's point added (null: nothing to save): today's again replaces it, one no different from the last
// isn't kept (the chart holds a value until the next point), the oldest let go past the cap
export function addPoint(history: PinPoint[], baseline: PinSnapshot, point: PinPoint, max = PIN_HISTORY_MAX): PinPoint[] | null {
  // (today's own point set aside, then today's kept only when it differs from the one before: the last
  // day's, or the pin's own)
  const earlier = history.at(-1)?.d === point.d ? history.slice(0, -1) : history;
  const before = earlier.at(-1) ?? pointOf(baseline);
  const next = samePoint(before, point) ? earlier : [...earlier, point];
  const same = next.length === history.length && next.every((p, i) => p.d === history[i].d && samePoint(p, history[i]));
  if (same) return null;
  return next.length > max ? next.slice(next.length - max) : next;
}

// Another sport's pin, in the All view: where its sides stood the last day its owner looked at it there (the
// latest point kept; that sport's engine isn't in this app to measure it now). Only the ranks and scores are
// kept in a point, so the skills and columns stay the pin's own (the card shows none of them); null: never
// looked at since the day it was pinned.
export function lastSeen(baseline: PinSnapshot, history: PinPoint[]): PinSnapshot | null {
  const last = history.at(-1);
  if (!last) return null;
  const sides = baseline.sides.flatMap((side) => {
    const p = last.sides.find((x) => x.k === side.key);
    return p ? [{ ...side, rank: p.r, of: p.o, pct: p.p, score: p.s }] : [];
  });
  return { ...baseline, at: dayMs(last.d), sides };
}

// ---------------------------------------------------------------------------
// The rank since it was pinned: a step line a side (each rank held until the next day it was looked at),
// newest on the right, #1 at the top
// ---------------------------------------------------------------------------
export interface TrendSide {
  key: string;
  name: string;
  color: string;
}

export interface TrendDot {
  x: number;
  y: number;
  title: string;
  pinned: boolean;
  now: boolean;
}

export interface TrendChart {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  xTicks: { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  yTicks: { y: number; label: string }[];
  lines: { key: string; color: string; path: string; dots: TrendDot[]; end: { x: number; y: number } }[];
  // (the pin's own day, a dashed line)
  pinX: number;
  // (only the pin's day so far: nothing to draw a line through yet)
  single: boolean;
}

export const TREND = { left: 34, right: 30, top: 12, bottom: 24 };

const SHORT_DAY = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// (a day's point at noon, so a day sits between its midnights whatever the time zone)
export function dayMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

// Nice rank ticks between #1 and the deepest: 1, then steps of 1, 2, 5, 10... (four or five of them)
export function rankTicks(lo: number, hi: number): number[] {
  const span = Math.max(1, hi - lo);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => span / s <= 4) ?? 1000;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  if (!ticks.length || ticks[0] !== lo) ticks.unshift(lo);
  return ticks.filter((t, i) => i === 0 || t - ticks[i - 1] >= step * 0.6);
}

export function trendChart(baseline: PinSnapshot, history: PinPoint[], now: PinSnapshot | null, sides: TrendSide[], width: number, height = 150): TrendChart {
  const { left, right, top, bottom } = TREND;
  const points: { t: number; point: PinPoint; pinned: boolean; now: boolean }[] = [{ t: baseline.at, point: pointOf(baseline), pinned: true, now: false }];
  for (const p of history) points.push({ t: dayMs(p.d), point: p, pinned: false, now: false });
  if (now) {
    const today = pointOf(now, now.at);
    // (today's saved point is now's)
    while (points.length > 1 && points.at(-1)!.point.d === today.d) points.pop();
    points.push({ t: Math.max(now.at, points.at(-1)!.t), point: today, pinned: false, now: true });
  }
  const t0 = points[0].t;
  const t1 = Math.max(points.at(-1)!.t, t0 + 1);
  // (still the pin's own day, nothing kept since: nothing to draw a line through yet)
  const single = points.length < 2 || (!history.length && dayOf(points.at(-1)!.t) === dayOf(t0));
  const ranks = points.flatMap((p) => p.point.sides.filter((s) => sides.some((x) => x.key === s.k)).map((s) => s.r));
  const lo = 1;
  const hi = Math.max(lo + 3, Math.max(...ranks, 1) + 1);
  const plotW = Math.max(40, width - left - right);
  const plotH = Math.max(40, height - top - bottom);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const px = (t: number) => r1(single ? left + plotW / 2 : left + ((t - t0) / (t1 - t0)) * plotW);
  const py = (rank: number) => r1(top + ((rank - lo) / (hi - lo)) * plotH);
  const yTicks = rankTicks(lo, hi).map((r) => ({ y: py(r), label: `#${r}` }));
  // (the pin's day, today's, and between them what fits: one every 70px)
  const xTicks: TrendChart['xTicks'] = [];
  if (single) xTicks.push({ x: px(t0), label: SHORT_DAY(t0), anchor: 'middle' });
  else {
    const days = Math.round((t1 - t0) / 86_400_000);
    const fit = Math.max(0, Math.min(days - 1, Math.floor(plotW / 70) - 1));
    xTicks.push({ x: px(t0), label: SHORT_DAY(t0), anchor: 'start' });
    for (let i = 1; i <= fit; i++) {
      const t = t0 + ((t1 - t0) * i) / (fit + 1);
      xTicks.push({ x: px(t), label: SHORT_DAY(t), anchor: 'middle' });
    }
    xTicks.push({ x: px(t1), label: now ? 'Now' : SHORT_DAY(t1), anchor: 'end' });
  }
  const lines = sides.flatMap((side) => {
    const own = points.flatMap((p) => {
      const s = p.point.sides.find((x) => x.k === side.key);
      return s ? [{ ...p, s }] : [];
    });
    if (!own.length) return [];
    const dots: TrendDot[] = own.map((p) => ({
      x: px(p.t),
      y: py(p.s.r),
      pinned: p.pinned,
      now: p.now,
      title: `${side.name}: #${p.s.r} of ${p.s.o}${p.pinned ? ', when pinned' : p.now ? ', now' : ''} (${SHORT_DAY(p.t)})`,
    }));
    // (held level until the next point, then a step)
    let path = `M${dots[0].x},${dots[0].y}`;
    for (let i = 1; i < dots.length; i++) path += ` H${dots[i].x} V${dots[i].y}`;
    if (single) path = `M${left},${dots[0].y} H${left + plotW}`;
    return [{ key: side.key, color: side.color, path, dots, end: dots.at(-1)! }];
  });
  return { width, height, left, right, top, bottom, xTicks, yTicks, lines, pinX: px(t0), single };
}

// ---------------------------------------------------------------------------
// The pin itself
// ---------------------------------------------------------------------------
// The link's part the pin keeps: the list's sliders and settings (?list=) and the comparison (?cmp=), as
// share.ts writes them, nothing else of the address
export function specOf(link: string): string {
  const params = new URL(link, 'https://x.invalid').searchParams;
  const kept = new URLSearchParams();
  for (const key of ['list', 'cmp']) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  return kept.toString();
}

export function parseSpec(spec: string): { list: string | null; cmp: string | null } {
  const params = new URLSearchParams(spec);
  return { list: params.get('list'), cmp: params.get('cmp') };
}

// (share.ts's list payload: JSON as URL-safe base64; junk reads as nothing)
export function decodeShared(code: string | null): Record<string, unknown> | null {
  if (!code) return null;
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return data && typeof data === 'object' && data.v === 1 ? data : null;
  } catch {
    return null;
  }
}

// The full compare, opened on the sport's page from the pin's link
export function compareHref(sport: string, spec: string): string {
  return `/${sport}/?${spec}`;
}

// "Josh Allen vs Patrick Mahomes"; seasons apart, each with his ("Allen ’13 vs Mahomes ’26")
export function defaultTitle(sides: { name: string; tag: string; season: number }[]): string {
  const sameSeason = sides.every((s) => s.season === sides[0]?.season);
  const names = sides.map((s) => (sameSeason ? s.name : s.tag));
  let title = names.join(' vs ');
  if (title.length > PIN_TITLE_MAX) title = sides.map((s) => s.tag).join(' vs ');
  return title.slice(0, PIN_TITLE_MAX) || 'Comparison';
}

export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, PIN_TITLE_MAX);
}

// A list with one item moved (a drag), and each one's order number after it
export function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

// "today", "yesterday", "3 days ago", "Sep 14"
export function sinceText(at: number, now = Date.now()): string {
  const days = Math.round((dayMs(dayOf(now)) - dayMs(dayOf(at))) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return SHORT_DAY(at);
}
