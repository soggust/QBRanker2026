// Each compare side's color: its team's own, so who's who reads without the legend (a red team red, a
// green one green). A team's colors are softened a little for the dark board, keeping their hue: a bit
// less saturated and lightened toward the view's soft palette, one too dark (a navy, a forest green, a deep
// red) lifted until it shows, a black or a white a grey.
// Two sides on the same team, or two teams too close to tell apart, get distinct shades: the later one
// takes the team's next color, or a lighter or darker shade of its own. Pure (the same colors in, the same
// colors out).

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

// A team's colors as a side shows them, best first: its own colors in its order (lifted to read), then
// its greys (a black, a silver: they say the least)
export function teamShades(colors: string[]): string[] {
  const own: string[] = [];
  const greys: string[] = [];
  for (const hex of colors) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;
    const [h, s, l] = hslOf(hex);
    if (s < GREY) greys.push(hexOf([0, 0, Math.min(GREY_LIGHT.max, Math.max(l, GREY_LIGHT.min))]));
    else own.push(readable([h, Math.min(SOFT.most, s * SOFT.saturation), Math.min(SOFT.max, l)], SOFT.reads));
  }
  return [...new Set([...own, ...greys])];
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
