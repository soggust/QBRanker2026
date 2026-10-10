// A team's color, the same wherever the app draws one (Compare's sides, the game view's two teams and a card's
// hero, the Bets page's and the Algorithm's picks): its own, so who's who reads without a legend (a red team
// red, a green one green), softened a little for the dark board, keeping its hue: a bit less saturated and
// lightened toward the soft palette, one too dark (a navy, a forest green, a deep red) lifted until it shows,
// a black or a white its other color, or a grey. Where green and red already say won and lost (the bets'
// picks and meters), a team's green or red is passed over for its other color (noResults).
// Two colors too close to tell apart (two sides on the same team, the Panthers' red and the Hurricanes'):
// the later one takes its team's next color, or a lighter or darker shade of its own (pickColor). Pure (the
// same colors in, the same colors out).

// Each sport's teams' colors (data/model/teams.json: ESPN's team list as the bettor keeps it, every team's
// alternate too, which a game's summary often leaves out; a browser can't ask ESPN's list itself), by
// "sport:ABBR" and by "sport#espnId"; once a visit a sport, empty when it can't be read
export type TeamColors = Map<string, { color?: string; alternateColor?: string }>;
const teamLists = new Map<string, Promise<TeamColors>>();
export async function loadTeamColors(sports: Iterable<string>): Promise<TeamColors> {
  const colors: TeamColors = new Map();
  for (const sport of new Set(sports)) {
    if (!teamLists.has(sport)) teamLists.set(sport, readTeamList(sport));
    for (const [key, pair] of await teamLists.get(sport)!) colors.set(key, pair);
  }
  return colors;
}
async function readTeamList(sport: string): Promise<TeamColors> {
  const file = (await fetch(`/${sport}/data/model/teams.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)) as { teams?: Record<string, { id: string; color: string | null; alt: string | null }> } | null;
  const colors: TeamColors = new Map();
  for (const [abbr, t] of Object.entries(file?.teams ?? {})) {
    const pair = { color: t.color ?? undefined, alternateColor: t.alt ?? undefined };
    colors.set(`${sport}:${abbr}`, pair);
    colors.set(`${sport}#${t.id}`, pair);
  }
  return colors;
}

// A color made light enough to read as text on a dark surface: its lightness raised a step at a time until its
// contrast with the surface is at least the ratio (WCAG's 4.5:1 for text), its hue and saturation kept; one that
// already reads, as it is. (A Lab lightness lift alone doesn't promise a ratio: a team's blue could still sit at
// 2.5:1 on the Bets rows.)
export function readableOn(hex: string, surface = '#1f2824', ratio = 4.5): string {
  const [h, s, l] = hslOf(hex);
  let light = l;
  let out = hex;
  while (contrast(out, surface) < ratio && light < 0.97) {
    light = Math.min(0.97, light + 0.02);
    out = hexOf([h, s, light]);
  }
  return out;
}

// (WCAG's contrast ratio of two colors, 1 to 21)
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// (a color's relative luminance, WCAG's)
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// [hue 0-360, saturation 0-1, lightness 0-1]
type Hsl = [number, number, number];

// How far apart two sides' colors have to be (CIEDE2000)
export const TOO_CLOSE = 18;

// (the least a color's Lab lightness can be to show on the board, a grey's lightness, and the most a
// color is lifted to)
const READS = 52;
const GREY_LIGHT = { min: 0.68, max: 0.8 };
const MAX_LIGHT = 0.85;
// (softened toward the view's soft palette: this much of its saturation kept (and no more than the most),
// lifted to this Lab lightness at least, and no lighter than the most lightness)
const SOFT = { saturation: 0.82, most: 0.7, reads: 57, max: 0.72 };
// (under this saturation a color reads as a grey)
const GREY = 0.18;

// A team's colors as the board shows them, best first: its own colors in its order (lifted to read), then
// its greys (a black, a silver: they say the least); hex with its # or without (ESPN's), anything else
// passed over; noResults: no green or red (burgundy and maroon too)
export function teamShades(colors: (string | null | undefined)[], { noResults = false } = {}): string[] {
  const own: string[] = [];
  const greys: string[] = [];
  for (const given of colors) {
    const hex = `#${given?.replace(/^#/, '').toLowerCase()}`;
    if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
    const [h, s, l] = hslOf(hex);
    if (noResults && readsAsResult([h, s, l])) continue;
    if (s < GREY) greys.push(hexOf([0, 0, Math.min(GREY_LIGHT.max, Math.max(l, GREY_LIGHT.min))]));
    else own.push(readable([h, Math.min(SOFT.most, s * SOFT.saturation), Math.min(SOFT.max, l)], SOFT.reads));
  }
  return [...new Set([...own, ...greys])];
}

// A team's one color (teamShades' first), null when it has none that will do
export function teamColor(colors: (string | null | undefined)[], options: { noResults?: boolean } = {}): string | null {
  return teamShades(colors, options)[0] ?? null;
}

// (a green or a red, the colors won and lost are drawn in)
function readsAsResult([h, s]: Hsl): boolean {
  return s > 0.3 && (h <= 11 || h >= 330 || (h >= 80 && h <= 165));
}

// (a color lifted, its hue and saturation kept, until it shows on the dark board)
function readable([h, s, l]: Hsl, reads = READS): string {
  let light = l;
  while (lightness(hexOf([h, s, light])) < reads && light < MAX_LIGHT) light += 0.01;
  return hexOf([h, s, light]);
}

// How light a color reads (Lab's L*, 0-100)
export function lightness(hex: string): number {
  return labOf(hex)[0];
}

// The first of a side's choices far enough from every color taken (the sides already in): its team's
// colors in order, then shades of them, then the fallback palette's; never one already taken
export function pickColor(choices: string[], taken: string[], palette: string[]): string {
  const clear = (c: string) => !taken.includes(c) && taken.every((t) => distance(c, t) >= TOO_CLOSE);
  const all = [...choices, ...choices.flatMap(shadesOf), ...palette];
  return all.find(clear) ?? all.find((c) => !taken.includes(c)) ?? shadesOf(all[0] ?? '#999999').find((c) => !taken.includes(c)) ?? '#999999';
}

// A color's other shades, nearest first: lighter, darker (while it still shows on the board), then its hue
// turned a little either way
export function shadesOf(hex: string): string[] {
  const [h, s, l] = hslOf(hex);
  // (a grey a bigger step: its shades are closer together)
  const step = s < GREY ? 0.3 : 0.18;
  const out: Hsl[] = [[h, s, Math.min(0.9, l + step)]];
  const darker: Hsl = [h, s, l - step];
  if (darker[2] > 0 && lightness(hexOf(darker)) >= READS - 12) out.push(darker);
  const turned = s >= GREY ? [24, -24].map((turn) => readable([(h + turn + 360) % 360, s, l])) : [];
  return [...new Set([...out.map(hexOf), ...turned])].filter((c) => c !== hex);
}

// How far apart two colors look (CIEDE2000: Lab's distance as the eye weighs it, a hue's shades nearer
// than they'd be by Lab alone)
export function distance(a: string, b: string): number {
  const [l1, a1, b1] = labOf(a);
  const [l2, a2, b2] = labOf(b);
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cm = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hueOf = (bb: number, ap: number) => (bb === 0 && ap === 0 ? 0 : (Math.atan2(bb, ap) / rad + 360) % 360);
  const hp1 = hueOf(b1, ap1);
  const hp2 = hueOf(b2, ap2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = hp2 - hp1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lm = (l1 + l2) / 2;
  const cpm = (cp1 + cp2) / 2;
  let hm = hp1 + hp2;
  if (cp1 * cp2 !== 0) hm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2;
  const t = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2);
  const sc = 1 + 0.045 * cpm;
  const sh = 1 + 0.015 * cpm * t;
  const rt = -2 * Math.sqrt(cpm ** 7 / (cpm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

export function hslOf(hex: string): Hsl {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hexOf([h, s, l]: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function labOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
