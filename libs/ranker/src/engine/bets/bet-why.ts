// Why a bet ranks where it does on the Bets page (its rank tile clicked): its score split into what makes it,
// and what separates it from the bets beside it. The score is its chance to win (picks.mjs scoreParts): the
// book's fair chance of its side, plus the model's lean (the trust the model has earned in that market, times
// its chance less the book's); a quarter more where the AI analyst's sheet makes the same call. In points (the
// chance times 100), so the parts add up to the score the list went by.

// (the parts picks.mjs writes beside the score: fair + lean is the score; picks written before carry none)
export interface PickWhy {
  fair: number;
  lean: number;
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
  confidence: 'low' | 'medium' | 'high' | null;
  chance?: number;
  // (the order: the score, times 1.25 where the analyst agrees)
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
  key: 'fair' | 'lean' | 'chance' | 'analyst';
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
  level: 'low' | 'medium' | 'high';
  // (its band, said: its chance's, or low for want of an edge)
  levelText: string;
  levelTitle: string;
  // (its price's expected return and its stake, where the file has them)
  edgeText: string | null;
  edgeTitle: string | null;
  parts: BetWhyPart[];
  vs: BetWhyVs[];
  // (only the chance to show: a picks file from before the book's and the model's chances were kept)
  partial: boolean;
}

const ANALYST = 1.25;

// A score as is ("70.34"; in points, the chance times 100)
export function betScoreText(score: number): string {
  return (Number(score.toFixed(2)) + 0).toFixed(2).replace('-', '−');
}

// A part of the score, signed ("+4.63", "−0.08"; to three places when it's under a hundredth)
export function signedPoints(amount: number): string {
  const digits = Math.abs(amount) < 0.01 && amount !== 0 ? 3 : 2;
  const text = Math.abs(amount).toFixed(digits);
  return Number(text) === 0 ? text : `${amount < 0 ? '−' : '+'}${text}`;
}

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const odds = (a: number) => (a > 0 ? `+${a}` : `${a}`.replace('-', '−'));
const LEVEL = { high: 'High', medium: 'Medium', low: 'Low' };
// (a book's: DraftKings', FanDuel's)
const owner = (book: string) => (book.endsWith('s') ? `${book}'` : `${book}'s`);

// A bet's name in the breakdown: the pick as the row writes it (a prop's player first)
export function betName(r: BetWhyRow): string {
  return r.player && !r.pick.startsWith(r.player) ? `${r.player} ${r.pick}` : r.pick;
}

// Its score's parts, in points: the book's fair chance and the model's lean (or the chance alone, from an
// older file), and the analyst's quarter
function partsOf(r: BetWhyRow): { parts: Omit<BetWhyPart, 'width'>[]; partial: boolean } {
  const analyst = r.source === 'Algorithm + Analyst';
  const total = r.sureness * 100;
  const base = analyst ? total / ANALYST : total;
  const book = r.book ?? 'DraftKings';
  const fair = r.why?.fair ?? r.fair;
  const parts: Omit<BetWhyPart, 'width'>[] = [];
  let partial = false;
  if (Number.isFinite(fair)) {
    const f = fair! * 100;
    // (the lean the rest of the score: fair + lean is the score, to the last digit)
    const lean = base - f;
    const from = r.why?.from ?? null;
    const price = Number.isFinite(r.price) ? ` ${odds(r.price!)}` : '';
    const source =
      from === 'even'
        ? `an even line (${owner(book)} board had no price: −110 assumed)`
        : from === 'pinnacle'
          ? `Pinnacle's line, its two prices with the vig taken out (${book}${price} is the price bet)`
          : `${owner(book)} two prices${price ? ` (${price.trim()} this side)` : ''} with the vig taken out`;
    parts.push({
      key: 'fair',
      label: "Book's chance",
      value: pct(fair!),
      amount: f,
      title: `The book's fair chance of this side: ${source}\n${pct(fair!, 2)} · ${signedPoints(f)} to the score (where it starts)`,
    });
    const model = r.model;
    const trust = r.why?.trust ?? (Number.isFinite(model) && Math.abs(model! - fair!) > 1e-6 ? lean / 100 / (model! - fair!) : null);
    const fitted = r.why ? (r.why.fitted ? ' (fitted on its graded bets and closing lines)' : ' (the untested start: not enough graded bets yet)') : '';
    const math =
      Number.isFinite(model) && trust !== null
        ? `Trust ${trust.toFixed(2)}${fitted} × the model's ${pct(model!)} less the book's ${pct(fair!)} (${signedPoints((model! - fair!) * 100)})`
        : null;
    parts.push({
      key: 'lean',
      label: "Model's lean",
      value: Number.isFinite(model) ? `model ${pct(model!)}` : '',
      amount: lean,
      title: [
        "The model's lean: how far its own chance pulls the book's, by the trust it has earned in this market (0 the book's chance alone, 1 the model's alone)",
        math,
        `${signedPoints(lean)} to the score`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  } else {
    partial = true;
    parts.push({
      key: 'chance',
      label: 'Chance to win',
      value: Number.isFinite(r.chance) ? `${r.chance}%` : '',
      amount: base,
      title: `Its chance to win, the model's and the book's together\n${signedPoints(base)} to the score (this pick's file doesn't split it)`,
    });
  }
  if (analyst) {
    parts.push({
      key: 'analyst',
      label: 'Analyst agrees',
      value: '×1.25',
      amount: total - base,
      title: `The AI analyst's sheet makes the same call: two reads agreeing, the score counted a quarter higher\n${betScoreText(base)} × 1.25 · ${signedPoints(total - base)} to the score`,
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

  // Its band: its chance's with an edge on the price; low without one, whatever its chance
  const level = row.confidence ?? 'low';
  const noEdge = row.edge === false || (row.edge === undefined && Number.isFinite(row.ev) && row.ev! <= 0);
  const chance = Number.isFinite(row.chance) ? `${row.chance}% to win` : null;
  const levelText = noEdge ? `${LEVEL[level]}: no edge on the price${chance ? ` (${chance})` : ''}` : `${LEVEL[level]}${chance ? `: ${chance}` : ''}`;
  const levelTitle = noEdge
    ? "Its confidence: low, whatever its chance, without an edge on the price (a bet the bot made for the data, not one it likes: a favorite at a short price isn't a strong bet)"
    : 'Its confidence, by its chance to win: 60% or more high, 53% or more medium, under that low';

  // Its price: what a unit's expected to return at its chance, and its stake
  let edgeText: string | null = null;
  let edgeTitle: string | null = null;
  if (Number.isFinite(row.ev)) {
    const ev = row.ev! * 100;
    edgeText = `${ev >= 0 ? '+' : '−'}${Math.abs(ev).toFixed(1)}% a unit${Number.isFinite(row.price) ? ` at ${odds(row.price!)}` : ''}${Number.isFinite(row.units) ? ` · ${row.units} unit${row.units === 1 ? '' : 's'}` : ''}`;
    edgeTitle = "Its expected return: its chance to win times the price's payout, less the stake (over 0 an edge). The stake, 0.5 to 3 units, grows with it; the order is the chance's, not this";
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
      title: `Score ${betScoreText(score)} vs ${betScoreText(theirScore)}: ${signedPoints(diff)}\nWhat makes the gap (+ in favor of this bet)`,
    });
  }

  return {
    id: row.id,
    name: betName(row),
    rank: index + 1,
    of: list.length,
    score,
    level,
    levelText,
    levelTitle,
    edgeText,
    edgeTitle,
    parts,
    vs,
    partial,
  };
}
