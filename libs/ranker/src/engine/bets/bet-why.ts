// Why a bet ranks where it does on the Bets page (its rank tile clicked): its score split into what makes it,
// and what separates it from the bets beside it. The score is its Kelly score (picks.mjs scoreParts): how much
// of a bankroll its edge is worth at its price, (b·p − (1 − p)) / b, b what a unit pays and p its trusted
// chance. As p is the book's fair chance plus the model's lean, it splits in two: the price (the book's fair
// chance against the price's break-even, its vig on this side) and the model's lean (the trust times the
// model's chance less the book's), each scaled by what the price pays; a quarter more where the AI analyst's
// sheet makes the same call (on a positive score only). In points (times 100), so the parts add up to the score
// the list went by.

// (the parts picks.mjs writes beside the score: price + lean is the score; picks written before carry an older
// split, fair + lean of the chance, or none)
export interface PickWhy {
  price?: number;
  lean: number;
  b?: number;
  p0?: number;
  fair: number;
  p?: number;
  trust: number | null;
  fitted: boolean;
  from: 'pinnacle' | 'book' | 'even';
}

// A row as the breakdown reads it (the page's BetRow has all of these)
export interface BetWhyRow {
  id: number;
  pick: string;
  player?: string | null;
  market: string;
  confidence: Confidence | null;
  chance?: number;
  // (the order: the Kelly score, a quarter more where the analyst agrees and it's over 0)
  sureness: number;
  source: 'Algorithm' | 'Algorithm + Analyst';
  edge?: boolean;
  model?: number;
  fair?: number;
  p?: number;
  ev?: number;
  units?: number;
  price?: number;
  book?: string;
  why?: PickWhy | null;
}

// One ingredient: what it added to the score, its bar against the largest, its hover
export interface BetWhyPart {
  key: 'price' | 'lean' | 'edge' | 'chance' | 'analyst';
  label: string;
  value: string;
  amount: number;
  width: number;
  title: string;
}

// A bet beside it: the gap in score and the parts making it (from this bet's side)
export interface BetWhyVs {
  name: string;
  rank: number;
  above: boolean;
  diff: number;
  drivers: { label: string; amount: number; title: string }[];
  title: string;
}

export interface BetWhy {
  id: number;
  name: string;
  rank: number;
  of: number;
  score: number;
  level: Confidence;
  // (no edge on the price: a score of 0 or under)
  noEdge: boolean;
  // (its trusted chance to win, a fact beside the parts)
  chanceText: string | null;
  chanceTitle: string;
  // (its band, said: its chance's, or low for want of an edge)
  levelText: string;
  levelTitle: string;
  // (its price's expected return and its stake, where the file has them)
  edgeText: string | null;
  edgeTitle: string | null;
  parts: BetWhyPart[];
  vs: BetWhyVs[];
  // (only the chance to show: a picks file from before the prices and chances were kept)
  partial: boolean;
}

const ANALYST = 1.25;

// (what a unit pays at American odds, the stake not counted: -250 0.4, +150 1.5)
export const payout = (american: number) => (american > 0 ? american / 100 : 100 / -american);

// A pick's Kelly score (picks.mjs scoreParts' math: the page's own for an older file, which carries the chances
// and the price but not the score): (p − p0) × (b + 1) / b, p0 = 1 / (b + 1) the price's break-even; null
// without the chance or the price
export function kellyOf(p: number | undefined | null, american: number | undefined | null): number | null {
  if (!Number.isFinite(p) || !Number.isFinite(american) || !american) return null;
  const b = payout(american!);
  return Math.round((p! - 1 / (b + 1)) * ((b + 1) / b) * 1e4) / 1e4;
}

// A pick's band, its row's color and its chip (picks.mjs BANDS, the same cuts): by its Kelly score, a lock above
// them all at 10% or more with a 60% chance to win (a big edge on a likely result: LOCK), then 5% (LOVE), 2%
// (BET), under that or without an edge low (PASS)
export type Confidence = 'lock' | 'high' | 'medium' | 'low';
export const BANDS = { lock: 0.1, lockChance: 0.6, high: 0.05, medium: 0.02 };
export function confidenceOf(kelly: number, p: number | null | undefined, edge: boolean | undefined): Confidence {
  if (edge === false || !(kelly > 0)) return 'low';
  if (kelly >= BANDS.lock && (p ?? 0) >= BANDS.lockChance) return 'lock';
  return kelly >= BANDS.high ? 'high' : kelly >= BANDS.medium ? 'medium' : 'low';
}

// (the analyst agreeing: a quarter more of a positive score, never a negative one made worse)
export const withAnalyst = (score: number) => (score > 0 ? score * ANALYST : score);

// A score as is, signed ("+3.12", "−1.05"; in points, times 100)
export function betScoreText(score: number): string {
  const text = Math.abs(score).toFixed(2);
  return Number(text) === 0 ? text : `${score < 0 ? '−' : '+'}${text}`;
}

// A part of the score, signed ("+4.63", "−0.08"; to three places when it's under a hundredth)
export function signedPoints(amount: number): string {
  const digits = Math.abs(amount) < 0.01 && amount !== 0 ? 3 : 2;
  const text = Math.abs(amount).toFixed(digits);
  return Number(text) === 0 ? text : `${amount < 0 ? '−' : '+'}${text}`;
}

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const odds = (a: number) => (a > 0 ? `+${a}` : `${a}`.replace('-', '−'));
const LEVEL: Record<Confidence, string> = { lock: 'Lock', high: 'High', medium: 'Medium', low: 'Low' };
// (a book's: DraftKings', FanDuel's)
const owner = (book: string) => (book.endsWith('s') ? `${book}'` : `${book}'s`);

// A bet's name in the breakdown: the pick as the row writes it (a prop's player first)
export function betName(r: BetWhyRow): string {
  return r.player && !r.pick.startsWith(r.player) ? `${r.player} ${r.pick}` : r.pick;
}

// (its score before the analyst's quarter)
function baseOf(r: BetWhyRow): number {
  const total = r.sureness * 100;
  return r.source === 'Algorithm + Analyst' && total > 0 ? total / ANALYST : total;
}

// Its score's parts, in points: the price and the model's lean (the edge alone where the file has no fair
// chance; the chance alone, from a file with no price), and the analyst's quarter
function partsOf(r: BetWhyRow): { parts: Omit<BetWhyPart, 'width'>[]; partial: boolean } {
  const analyst = r.source === 'Algorithm + Analyst';
  const total = r.sureness * 100;
  const base = baseOf(r);
  const book = r.book ?? 'DraftKings';
  const fair = r.why?.fair ?? r.fair;
  const b = r.why?.b ?? (Number.isFinite(r.price) && r.price ? payout(r.price) : NaN);
  const parts: Omit<BetWhyPart, 'width'>[] = [];
  let partial = false;
  if (Number.isFinite(b) && b > 0) {
    const p0 = r.why?.p0 ?? 1 / (b + 1);
    const scale = (b + 1) / b;
    const at = Number.isFinite(r.price) ? ` at ${odds(r.price!)}` : '';
    if (Number.isFinite(fair)) {
      // (the price's part as written, or worked out the same way; the lean the rest: price + lean is the score,
      // to the last digit)
      const price = Number.isFinite(r.why?.price) ? r.why!.price! * 100 : (fair! - p0) * scale * 100;
      const lean = base - price;
      const from = r.why?.from ?? null;
      const source =
        from === 'even'
          ? `an even line (${owner(book)} board had no price: −110 assumed)`
          : from === 'pinnacle'
            ? `Pinnacle's line, its two prices with the vig taken out`
            : `${owner(book)} two prices with the vig taken out`;
      parts.push({
        key: 'price',
        label: 'The price',
        value: Number.isFinite(r.price) ? odds(r.price!) : '',
        amount: price,
        title: [
          `The price: the book's fair chance of this side, ${pct(fair!)} (${source}), against the price's break-even, ${pct(p0)}${at}: its vig on this side (over 0 where the price beats its own fair chance)`,
          `${signedPoints((fair! - p0) * 100)} chance points × ${scale.toFixed(2)} for what it pays = ${signedPoints(price)} to the score`,
        ].join('\n'),
      });
      const model = r.model;
      const leanChance = lean / 100 / scale;
      const trust = r.why?.trust ?? (Number.isFinite(model) && Math.abs(model! - fair!) > 1e-6 ? leanChance / (model! - fair!) : null);
      const fitted = r.why ? (r.why.fitted ? ' (fitted on its graded bets and closing lines)' : ' (the untested start: not enough graded bets yet)') : '';
      const math =
        Number.isFinite(model) && trust !== null
          ? `Trust ${trust.toFixed(2)}${fitted} × the model's ${pct(model!)} less the book's ${pct(fair!)} (${signedPoints((model! - fair!) * 100)}) = ${signedPoints(leanChance * 100)} chance points`
          : null;
      parts.push({
        key: 'lean',
        label: "Model's lean",
        value: Number.isFinite(model) ? `model ${pct(model!)}` : '',
        amount: lean,
        title: [
          "The model's lean: how far its own chance pulls the book's, by the trust it has earned in this market (0 the book's chance alone, 1 the model's alone)",
          math,
          `× ${scale.toFixed(2)} for what it pays = ${signedPoints(lean)} to the score`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } else {
      parts.push({
        key: 'edge',
        label: 'Edge on the price',
        value: Number.isFinite(r.p) ? pct(r.p!) : '',
        amount: base,
        title: `Its chance to win against the price's break-even, ${pct(p0)}${at}, scaled by what it pays (× ${scale.toFixed(2)})\n${signedPoints(base)} to the score (this pick's file doesn't split it)`,
      });
    }
  } else {
    partial = true;
    parts.push({
      key: 'chance',
      label: 'Chance to win',
      value: Number.isFinite(r.chance) ? `${r.chance}%` : '',
      amount: base,
      title: `Its chance to win, the model's and the book's together\n${signedPoints(base)} to the score (this pick's file has no price to weigh it by)`,
    });
  }
  if (analyst) {
    parts.push({
      key: 'analyst',
      label: 'Analyst agrees',
      value: total > 0 ? '×1.25' : 'no edge',
      amount: total - base,
      title:
        total > 0
          ? `The AI analyst's sheet makes the same call: two reads agreeing, the score counted a quarter higher\n${betScoreText(base)} × 1.25 · ${signedPoints(total - base)} to the score`
          : "The AI analyst's sheet makes the same call, but a quarter more counts only on a positive score: never a bet with no edge made worse\n0.00 to the score",
    });
  }
  return { parts, partial };
}

export function betWhy(list: BetWhyRow[], index: number): BetWhy {
  const row = list[index];
  const score = row.sureness * 100;
  const { parts: raw, partial } = partsOf(row);
  const largest = Math.max(0, ...raw.map((p) => Math.abs(p.amount)));
  const parts = raw.map((p) => ({ ...p, width: largest ? (Math.abs(p.amount) / largest) * 100 : 0 }));

  // Its chance to win: the trusted one, the book's fair chance moved toward the model's
  const chance = Number.isFinite(row.p) ? pct(row.p!) : Number.isFinite(row.chance) ? `${row.chance}%` : null;
  const chanceTitle = "Its chance to win: the book's fair chance moved toward the model's by the trust the model has earned in that market. The score weighs it against the price";

  // Its band: its Kelly score's with an edge on the price; low without one, whatever its chance
  const level = row.confidence ?? 'low';
  const noEdge = row.edge === false || (!partial && score <= 0);
  const levelText = noEdge ? `${LEVEL[level]}: no edge on the price` : LEVEL[level];
  const levelTitle = noEdge
    ? "Its confidence: low, whatever its chance, without an edge on the price (a bet the bot made for the data, not one it likes: a favorite at a short price isn't a strong bet)"
    : 'Its confidence, by its Kelly score (value and likelihood together, as the picks are ranked): 10 or more with a 60% chance a lock, 5 or more high, 2 or more medium, under that low';

  // Its price: what a unit's expected to return at its chance, and its stake
  let edgeText: string | null = null;
  let edgeTitle: string | null = null;
  if (Number.isFinite(row.ev)) {
    const ev = row.ev! * 100;
    edgeText = `${ev >= 0 ? '+' : '−'}${Math.abs(ev).toFixed(1)}% a unit${Number.isFinite(row.price) ? ` at ${odds(row.price!)}` : ''}${Number.isFinite(row.units) ? ` · ${row.units} unit${row.units === 1 ? '' : 's'}` : ''}`;
    edgeTitle = "Its expected return: its chance to win times the price's payout, less the stake (over 0 an edge). The bot's stake, 0.5 to 3 units, grows with it";
  }

  const vs: BetWhyVs[] = [];
  const mine = new Map(raw.map((p) => [p.key, p]));
  for (const at of [index - 1, index + 1]) {
    const other = list[at];
    if (!other) continue;
    const theirs = new Map(partsOf(other).parts.map((p) => [p.key, p]));
    const keys = [...new Set([...mine.keys(), ...theirs.keys()])];
    const name = betName(other);
    const drivers = keys
      .map((key) => ({ key, a: mine.get(key), b: theirs.get(key) }))
      .map(({ key, a, b }) => ({ key, label: (a ?? b)!.label, amount: (a?.amount ?? 0) - (b?.amount ?? 0), a, b }))
      .filter((d) => Math.abs(d.amount) >= 0.005)
      .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
      .map(({ label, amount, a, b }) => ({
        label,
        amount,
        title: `${label}: ${a?.value || '-'} vs ${b?.value || '-'}\n${signedPoints(a?.amount ?? 0)} vs ${signedPoints(b?.amount ?? 0)} to the score: ${signedPoints(amount)} for this bet`,
      }));
    const theirScore = other.sureness * 100;
    const diff = score - theirScore;
    vs.push({
      name,
      rank: at + 1,
      above: at > index,
      diff,
      drivers,
      title: `Kelly ${betScoreText(score)} vs ${betScoreText(theirScore)}: ${signedPoints(diff)}\nWhat makes the gap (+ in favor of this bet)`,
    });
  }

  return {
    id: row.id,
    name: betName(row),
    rank: index + 1,
    of: list.length,
    score,
    level,
    noEdge,
    chanceText: chance,
    chanceTitle,
    levelText,
    levelTitle,
    edgeText,
    edgeTitle,
    parts,
    vs,
    partial,
  };
}
