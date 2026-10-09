// Builds the MMA app's data: every active fighter, by division, ranked on the MMA rating (scripts/rating.mjs)
// over every pro fight ESPN has, across the UFC, PFL, Bellator, Rizin and the promotions before them and
// beside them (scripts/fights.mjs). A fighter is active with a fight in a major promotion (UFC, PFL,
// Bellator, Rizin) in the last two years; the retired ones with 6+ fights in the majors (or PRIDE,
// Strikeforce and WEC) are listed with the Retired Fighters setting.
//
// - The fights (scripts/fights.mjs, kept in scripts/fights/): every bout, its fighters, the winner, the
//   division, the round and time it ended, and how
// - ESPN's fighters (cached in scripts/cache.json, refetched only after a new fight or after a week):
//   each fighter's bio (division, gender, country flag, headshot, gym, reach, age, pro record) and his
//   stats fight by fight (strikes, knockdowns, takedowns, submission attempts, ground advances: the UFC's
//   and the PFL's fights; where ESPN's athlete stats leave a bout out, its core API's for that bout).
//   Opponents' stats are fetched too, so what a fighter absorbs is counted.
// - UFC.com's rankings page: each division's champion and top 15, and the pound-for-pound lists
// - UFC.com's fighter pages, for UFC fighters without a fight in six months: their status there
//   ("Retired" or "Not Fighting" moves them to the retired fighters; checked monthly, cached)
// - Wikipedia's List of UFC champions: every UFC title reign (interim ones too) and its defenses
//
// Usage: npm run mma:update-data
//
// Writes skill-players.json in the shape the app reads: { P4P: [...], HW: [...], ..., WSW: [...] }, each
// fighter { id, gsisId, name, teamLogo (his country's flag), teamName (his gym), games (fights), stats,
// awards, rookie (his debut in the last year), lastFive, fights (newest first) }.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { allFights } from './fights.mjs';
import { shareRows } from '../../../libs/ranker/scripts/shared-rows.mjs';
import { PARAMS, cautious, deviationOn, history, rate, tabOf, weightOf } from './rating.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const CACHE = path.join(import.meta.dirname, 'cache.json');
const COMMON = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes';
const RANKINGS = 'https://www.ufc.com/rankings';
const PFL_RANKINGS = 'https://pflmma.com/rankings';
const CHAMPIONS = 'https://en.wikipedia.org/w/index.php?title=List_of_UFC_champions&action=raw';
// The other big promotions' title histories (Wikipedia), each with the sections its titles are in: the
// world championship tables (not the regional belts, the records or the minor tournaments; the PFL's
// season tournaments were its titles until 2025)
const WIKI_RAW = (page) => `https://en.wikipedia.org/w/index.php?title=${page}&action=raw`;
const OTHER_TITLES = [
  { promotion: 'PRIDE', page: 'List_of_Pride_Fighting_Championships_champions', from: /^==World champions==/, to: /^==(?!=)/ },
  { promotion: 'Strikeforce', page: 'List_of_Strikeforce_champions', from: /^==World champions==/, to: /^==(?!=)/ },
  { promotion: 'WEC', page: 'List_of_World_Extreme_Cagefighting_champions', from: /^==World Title histories==/, to: /^==(?!=)/ },
  { promotion: 'Bellator', page: 'List_of_Bellator_MMA_champions', from: /^==(Men's|Women's) championship history==/, to: /^==(?!=)(?!(Men's|Women's) championship history)/ },
  { promotion: 'PFL', page: 'List_of_Professional_Fighters_League_champions', from: /^==PFL championship history==/, to: /^(==(?!=)|===(European|MENA|Africa) Championship|===Symbolic)/ },
];
// (a title counts in full in the premier competition of the day, half in Bellator and the PFL, as
// career points do; an interim title half again)
const TITLE_WEIGHT = { UFC: 1, PRIDE: 1, Strikeforce: 1, WEC: 1, Bellator: 0.5, PFL: 0.5 };
const ACTIVE_DAYS = 730;
const ROUND = 300;
// The promotions whose fighters are listed (active: a fight in one in the last two years), and the ones
// whose veterans are listed among the retired
const MAJORS = new Set(['ufc', 'pfl', 'bellator', 'rizin']);
const HISTORIC = new Set([...MAJORS, 'pride', 'strikeforce', 'wec', 'dream', 'k1']);
const PROMOTIONS = {
  ufc: 'UFC',
  pfl: 'PFL',
  bellator: 'Bellator',
  rizin: 'Rizin',
  pride: 'PRIDE',
  strikeforce: 'Strikeforce',
  wec: 'WEC',
  ksw: 'KSW',
  'cage-warriors': 'Cage Warriors',
  lfa: 'LFA',
  dream: 'DREAM',
  'shooto-japan': 'Shooto',
  pancrase: 'Pancrase',
  k1: "K-1 HERO'S",
  m1: 'M-1',
  affliction: 'Affliction',
  ifl: 'IFL',
  proelite: 'EliteXC',
};

// ESPN's division names -> the app's tabs
const DIVISIONS = {
  Heavyweight: 'HW',
  'Light Heavyweight': 'LHW',
  Middleweight: 'MW',
  Welterweight: 'WW',
  Lightweight: 'LW',
  Featherweight: 'FW',
  Bantamweight: 'BW',
  Flyweight: 'FLW',
  "Women's Bantamweight": 'WBW',
  'W Bantamweight': 'WBW',
  "Women's Flyweight": 'WFLW',
  'W Flyweight': 'WFLW',
  "Women's Strawweight": 'WSW',
  'W Strawweight': 'WSW',
  // (the women's featherweights are few: they're ranked with the bantamweights)
  "Women's Featherweight": 'WBW',
  'W Featherweight': 'WBW',
};
// UFC.com's division headers -> the app's tabs
const RANKING_DIVISIONS = {
  Flyweight: 'FLW',
  Bantamweight: 'BW',
  Featherweight: 'FW',
  Lightweight: 'LW',
  Welterweight: 'WW',
  Middleweight: 'MW',
  'Light Heavyweight': 'LHW',
  Heavyweight: 'HW',
  "Women's Strawweight": 'WSW',
  "Women's Flyweight": 'WFLW',
  "Women's Bantamweight": 'WBW',
};

// A polite pace (a few requests a second at most), with retries
let lastRequest = 0;
async function get(url, as = 'json') {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 300 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (sports-ranker data script)' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const round = (v, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const nameKey = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&#0?39;/g, '')
    .replace(/[^a-z]/g, '');

// ---------------------------------------------------------------------------
// Bouts: every fight in the archive, with its length and whether it went the distance
// ---------------------------------------------------------------------------
async function bouts() {
  return (await allFights()).map((f) => {
    const period = f.period ?? f.rounds;
    const clock = Math.min(ROUND, f.clock ?? ROUND);
    const { lbs, women } = weightOf(f);
    return {
      ...f,
      tab: tabOf(lbs, women),
      seconds: (period - 1) * ROUND + clock,
      // (the final bell: a decision; anything sooner, a finish)
      decision: /^(UD|SD|MD|DEC|DRAW)$/.test(f.method) || (period >= f.rounds && clock >= ROUND),
      period,
      clock,
    };
  });
}

// ---------------------------------------------------------------------------
// Fighters: bios and fight-by-fight stats, cached
// ---------------------------------------------------------------------------
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
};

// A fighter's stats by bout: [sig landed, sig attempted, knockdowns, takedowns landed, takedowns
// attempted, submission attempts, ground advances, reversals]. From ESPN's athlete stats, every bout at
// once; that comes back empty ({}) for some fighters (Francis Ngannou, Lyoto Machida, Nate Diaz: a
// fifth of those with UFC fights), so any of his bouts (UFC and PFL ones, the leagues ESPN keeps stats
// for) it leaves out are asked of the core API one by one (coreFightStats)
async function fightStats(id, bouts = []) {
  const byBout = await athleteFightStats(id);
  const missing = bouts.filter((b) => !byBout[b.id]);
  if (missing.length) Object.assign(byBout, await coreFightStats(id, missing));
  return byBout;
}

async function athleteFightStats(id) {
  const data = await get(`${COMMON}/${id}/stats`);
  const byBout = {};
  for (const category of data?.categories ?? []) {
    const labels = category.labels.map((l) => l.trim());
    const at = (row, label) => num(row.stats[labels.indexOf(label)]);
    for (const row of category.statistics ?? []) {
      const bout = (row.uid ?? '').split('~c:')[1];
      if (!bout) continue;
      const s = (byBout[bout] ??= [0, 0, 0, 0, 0, 0, 0, 0]);
      if (category.displayName === 'striking') {
        s[0] = at(row, 'SSL');
        s[1] = at(row, 'SSA');
        s[2] = at(row, 'KD');
      } else if (category.displayName === 'Clinch') {
        s[3] = at(row, 'TDL');
        s[4] = at(row, 'TDA');
        s[7] = at(row, 'RV');
      } else if (category.displayName === 'Ground') {
        s[5] = at(row, 'SM');
        s[6] = at(row, 'AD');
      }
    }
  }
  return byBout;
}

// The same stats from ESPN's core API, a bout at a time: his event log (each bout's competitor link),
// then each missing bout's statistics. A bout it has nothing for (no categories, or not a strike,
// takedown or submission attempt in them: no data kept) stays missing.
const CORE_ATHLETES = 'https://sports.core.api.espn.com/v2/sports/mma/athletes';
const CORE_STATS = { SSL: 0, SSA: 1, KD: 2, TDL: 3, TDA: 4, SM: 5, AD: 6, RV: 7 };
async function coreFightStats(id, bouts) {
  const log = await get(`${CORE_ATHLETES}/${id}/eventlog?limit=500`);
  const competitor = new Map();
  for (const item of log?.events?.items ?? []) {
    const bout = item.competition?.$ref?.match(/\/competitions\/(\d+)/)?.[1];
    if (bout && item.competitor?.$ref) competitor.set(bout, item.competitor.$ref.replace(/^http:/, 'https:').replace('?', '/statistics?'));
  }
  const byBout = {};
  for (const b of bouts) {
    if (!competitor.has(b.id)) continue;
    const data = await get(competitor.get(b.id)).catch(() => null);
    const stats = (data?.splits?.categories ?? []).flatMap((c) => c.stats ?? []);
    const s = [0, 0, 0, 0, 0, 0, 0, 0];
    let tried = 0;
    for (const stat of stats) {
      const abbr = String(stat.abbreviation ?? '').trim();
      if (abbr in CORE_STATS) s[CORE_STATS[abbr]] = num(stat.value);
      if (['TSA', 'TDA', 'SM'].includes(abbr)) tried += num(stat.value);
    }
    if (tried > 0) byBout[b.id] = s;
  }
  return byBout;
}

async function bio(id) {
  const a = (await get(`${COMMON}/${id}`))?.athlete;
  if (!a) return null;
  const pro = Object.fromEntries((a.statsSummary?.statistics ?? []).map((s) => [s.name, s.displayValue]));
  return {
    name: a.displayName,
    division: a.weightClass?.text ?? null,
    gender: a.gender ?? null,
    flag: a.flag?.href ?? null,
    country: a.citizenship ?? null,
    headshot: !!a.headshot?.href,
    gym: a.association?.name ?? null,
    reach: num(String(a.displayReach ?? '').replace('"', '')) || null,
    age: a.age ?? null,
    stance: a.stance?.text ?? null,
    pro: pro['wins-losses-draws'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Rankings: UFC.com's champions, top 15s and pound-for-pound lists (by name). The page has two sets: the
// media panel's "All Rankings" (the divisions and the pound-for-pound lists: ranks) and the Meta Rankings
// (each division's top 15: metaRanks, the Meta Rankings setting's)
// ---------------------------------------------------------------------------
async function rankings() {
  const html = (await get(RANKINGS, 'text')) ?? '';
  const out = { champions: new Map(), ranks: new Map(), metaRanks: new Map(), p4p: new Map(), wp4p: new Map() };
  const metaAt = html.indexOf('rankings-meta-rankings');
  const groups = (part) => part.split('<div class="view-grouping">').slice(1);
  const meta = metaAt > 0 ? groups(html.slice(metaAt)) : [];
  const media = groups(metaAt > 0 ? html.slice(0, metaAt) : html);
  const seen = new Set();
  for (const [group, isMeta] of [...media.map((g) => [g, false]), ...meta.map((g) => [g, true])]) {
    const head = (group.match(/view-grouping-header">([^<]*)/)?.[1] ?? '').replace(/&#0?39;/g, "'").trim();
    if (seen.has((isMeta ? 'meta/' : '') + head)) continue;
    seen.add((isMeta ? 'meta/' : '') + head);
    const champion = group.match(/<h5>\s*<a[^>]*>([^<]*)<\/a>/)?.[1];
    const ranked = [...group.matchAll(/views-field-title[^>]*>\s*<a[^>]*>([^<]*)<\/a>/g)].map((m) => nameKey(m[1]));
    if (/Pound-for-Pound/.test(head)) {
      ranked.forEach((key, i) => out[/Women/i.test(head) ? 'wp4p' : 'p4p'].set(key, i + 1));
      continue;
    }
    const tab = RANKING_DIVISIONS[head];
    if (!tab) continue;
    if (champion && !isMeta) out.champions.set(nameKey(champion), tab);
    ranked.forEach((key, i) => out[isMeta ? 'metaRanks' : 'ranks'].set(`${tab}/${key}`, i + 1));
  }
  return out;
}

// A ranked name's key by surname alone, when exactly one has it and the first initial matches (the first
// names spelled apart): names is key -> the name as written
function uniqueSurname(names, name) {
  const parts = (n) => n.split(' ').map(nameKey);
  const [first, last] = [parts(name)[0], parts(name).at(-1)];
  const hits = [...names].filter(([, n]) => parts(n).at(-1) === last && parts(n)[0][0] === first[0]);
  return hits.length === 1 ? hits[0][0] : null;
}

// The PFL's: its champions and top 10s, and its pound-for-pound list (by name)
const PFL_DIVISIONS = {
  bantamweight: 'BW',
  featherweight: 'FW',
  lightweight: 'LW',
  welterweight: 'WW',
  middleweight: 'MW',
  light_heavyweight: 'LHW',
  heavyweight: 'HW',
  womens_flyweight: 'WFLW',
};
async function pflRankings() {
  const html = (await get(PFL_RANKINGS, 'text')) ?? '';
  const out = { champions: new Map(), ranks: new Map(), byName: new Map(), names: new Map(), p4p: new Map() };
  const text = (s) => s.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  for (const box of html.split('class="rankings-box rankings-box-').slice(1)) {
    const division = box.match(/^([a-z0-9_]+)/)?.[1];
    const ranked = [...box.matchAll(/<span>(\d+)<\/span>[\s\S]*?<h6[^>]*>([\s\S]*?)<\/h6>/g)].map((m) => [nameKey(text(m[2])), Number(m[1])]);
    for (const m of box.matchAll(/<h[46][^>]*>([\s\S]*?)<\/h[46]>/g)) out.names.set(nameKey(text(m[1])), text(m[1]));
    if (division === 'mens_p4p') {
      for (const [key, n] of ranked) out.p4p.set(key, n);
      continue;
    }
    const tab = PFL_DIVISIONS[division];
    if (!tab) continue;
    const champion = box.match(/CHAMPION<\/div>\s*<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1];
    if (champion && !/vacant/i.test(champion)) out.champions.set(nameKey(text(champion)), tab);
    for (const [key, n] of ranked) {
      out.ranks.set(`${tab}/${key}`, n);
      out.byName.set(key, n);
    }
    if (champion && !/vacant/i.test(champion)) out.byName.set(nameKey(text(champion)), 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// A fighter's status on UFC.com ("Active", "Retired", "Not Fighting"...): his page's hero tags, the
// page found by his name ("Stipe Miocic" -> /athlete/stipe-miocic). null when there's no such page.
// ---------------------------------------------------------------------------
const ATHLETE = 'https://www.ufc.com/athlete/';
async function ufcStatus(name) {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const html = await get(ATHLETE + slug, 'text').catch(() => null);
  if (!html) return null;
  const tags = [...html.matchAll(/hero-profile__tag">\s*([^<]*)/g)].map((m) => m[1].trim());
  return tags.find((t) => /^(Active|Retired|Not Fighting)$/i.test(t)) ?? (tags.length ? 'Active' : null);
}

// ---------------------------------------------------------------------------
// Title history: Wikipedia's championship tables (each division's reigns, interim ones included, with
// a line per successful defense). A reign is a title fight win, and so is each defense. By name: his
// reigns, interim ones among them, defenses, the weighted score of each (TITLE_WEIGHT), and the
// promotions he held a title in.
// ---------------------------------------------------------------------------
const titleOf = (out, key) =>
  out.get(key) ?? out.set(key, { reigns: 0, interim: 0, defenses: 0, winScore: 0, defenseScore: 0, promotions: [] }).get(key);
function addReign(out, key, weighAs, interim, defenses, promotion = weighAs) {
  const t = titleOf(out, key);
  const w = weighAs === 'UFC-equivalent' ? 1 : (TITLE_WEIGHT[weighAs] ?? 0.5);
  t.reigns++;
  if (interim) t.interim++;
  t.defenses += defenses;
  t.winScore += w * (interim ? 0.5 : 1) + w * defenses;
  t.defenseScore += w * defenses;
  if (!t.promotions.includes(promotion)) t.promotions.push(promotion);
}
const DEFENSE = /\d+\.(?:''')?\s*def\./g;
// (a row whose number is a dash: an interim reign)
const INTERIM_ROW = /^\s*!\s*(—|&mdash;|-)\s*$/m;

async function otherTitles(out) {
  for (const { promotion, page, from, to } of OTHER_TITLES) {
    const text = (await get(WIKI_RAW(page), 'text').catch(() => null)) ?? '';
    const lines = text.split('\n');
    const kept = [];
    let on = false;
    for (const line of lines) {
      if (from.test(line)) on = true;
      else if (on && to.test(line)) on = false;
      if (on) kept.push(line);
    }
    for (const row of kept.join('\n').split(/\n\|-/)) {
      // (the champion: the row's first flag, his linked name or the plain one after it)
      const m = row.match(/\{\{[Ff]lagicon\|[^}]*\}\}\s*(?:\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|([^\n<{|]+))/);
      if (!m) continue;
      const name = (m[2] ?? m[1] ?? m[3] ?? '').replace(/\s*\(.*\)$/, '').trim();
      if (!name) continue;
      // (a women's lightweight title counts in full: no premier promotion held the division)
      addReign(out, nameKey(name), /Women's Lightweight/i.test(row) ? 'UFC-equivalent' : promotion, INTERIM_ROW.test(row) || /interim/i.test(row.split('\n').slice(0, 3).join(' ')), (row.match(DEFENSE) ?? []).length, promotion);
    }
  }
}

async function titles() {
  const text = (await get(CHAMPIONS, 'text')) ?? '';
  const out = new Map();
  // (the championship histories, men's and women's, the defunct women's featherweight title too; not
  // the symbolic BMF belt or the tournaments)
  const start = text.indexOf("==Men's championship history==");
  const end = text.indexOf('==Symbolic titles==');
  const defunct = text.slice(text.indexOf('==Defunct titles=='), text.indexOf('==Tournament winners=='));
  const tables = text.slice(start, end) + defunct.slice(defunct.indexOf("===Women's Featherweight"));
  for (const chunk of tables.split(/\n\|-/)) {
    // A reign: its number (or "—"), the champion's flag and name, the event, a line per defense
    const row = chunk.split(/\n===/)[0];
    const champ = row.match(/\{\{flagicon\|[^}]*\}\}\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!champ || !/\[\[UFC|\[\[The Ultimate Fighter|\[\[UFC on/.test(row)) continue;
    const key = nameKey(champ[2] ?? champ[1].replace(/\s*\(.*\)$/, ''));
    addReign(out, key, 'UFC', INTERIM_ROW.test(row), (row.match(DEFENSE) ?? []).length);
  }
  await otherTitles(out);
  return out;
}

// His pro fights, all of them (his bio's record), or those covered when the bio has none or fewer
function proFights(pro, covered) {
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(pro ?? '');
  return m ? Math.max(covered, +m[1] + +m[2] + +(m[3] ?? 0)) : covered;
}

// His whole pro record (his bio's: the regional fights too) for the Record column, over the one from the
// promotions covered; that one when the bio has none, or one short of the fights here
function proRecord(pro, c) {
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(pro ?? '');
  if (!m) return {};
  const [wins, losses, ties] = [+m[1], +m[2], +(m[3] ?? 0)];
  if (wins < c.wins || losses < c.losses) return {};
  return { wins, losses, ties, winPct: round((wins + ties / 2) / (wins + losses + ties)) };
}

// ---------------------------------------------------------------------------
// A fighter's career in the promotions covered, from his bouts and both sides' stats
// ---------------------------------------------------------------------------
function career(id, fights, stats, cache) {
  const t = { secs: 0, ssl: 0, ssa: 0, kd: 0, tdl: 0, tda: 0, sm: 0, ad: 0, oppSecs: 0, oppSsl: 0, oppSsa: 0, oppKd: 0, oppTdl: 0, oppTda: 0 };
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let finishes = 0;
  let finished = 0;
  let koWins = 0;
  for (const b of fights) {
    const me = b.fighters.find((f) => f.id === id);
    const opp = b.fighters.find((f) => f.id !== id);
    if (me.winner) wins++;
    else if (opp.winner) losses++;
    else draws++;
    if (me.winner && !b.decision) finishes++;
    if (me.winner && !b.decision && b.method === 'KO') koWins++;
    if (opp.winner && !b.decision) finished++;
    const mine = stats[b.id];
    if (mine) {
      t.secs += b.seconds;
      t.ssl += mine[0];
      t.ssa += mine[1];
      t.kd += mine[2];
      t.tdl += mine[3];
      t.tda += mine[4];
      t.sm += mine[5];
      t.ad += mine[6];
    }
    const theirs = cache[opp.id]?.stats?.[b.id];
    if (theirs) {
      t.oppSecs += b.seconds;
      t.oppSsl += theirs[0];
      t.oppSsa += theirs[1];
      t.oppKd += theirs[2];
      t.oppTdl += theirs[3];
      t.oppTda += theirs[4];
    }
  }
  const mins = t.secs / 60;
  const oppMins = t.oppSecs / 60;
  const per = (v, m, scale = 1) => (m >= 15 ? round((v / m) * scale, 2) : null);
  return {
    wins,
    losses,
    ties: draws,
    winPct: fights.length ? round((wins + draws / 2) / fights.length) : null,
    finishRate: wins ? round(finishes / wins) : null,
    // (his wins by KO/TKO, of all his wins)
    koShare: wins ? round(koWins / wins) : null,
    finishes,
    finished,
    fightTime: fights.length ? round(fights.reduce((s, b) => s + b.seconds, 0) / fights.length / 60, 1) : null,
    slpm: per(t.ssl, mins),
    sapm: per(t.oppSsl, oppMins),
    strAcc: t.ssa >= 50 ? round(t.ssl / t.ssa) : null,
    strDef: t.oppSsa >= 50 ? round(1 - t.oppSsl / t.oppSsa) : null,
    strDiff: mins >= 15 && oppMins >= 15 ? round(t.ssl / mins - t.oppSsl / oppMins, 2) : null,
    kd15: per(t.kd, mins, 15),
    kdAgainst: per(t.oppKd, oppMins, 15),
    td15: per(t.tdl, mins, 15),
    tdAcc: t.tda >= 5 ? round(t.tdl / t.tda) : null,
    tdDef: t.oppTda >= 5 ? round(1 - t.oppTdl / t.oppTda) : null,
    sub15: per(t.sm, mins, 15),
    adv15: per(t.ad, mins, 15),
  };
}

// ---------------------------------------------------------------------------
let cache = {};
try {
  cache = JSON.parse(await readFile(CACHE, 'utf8'));
} catch {
  // (a first run: everything is fetched)
}

// UFC.com and Wikipedia can turn a request from a data center away (GitHub's runners, where the
// nightly update runs). Then the last good copy, kept in cache.json under _<name>, stands in, so the
// night's fights and stats still update; a fetch that comes back empty counts as turned away too.
async function lastGood(name, fetchIt, isEmpty, toJson, fromJson) {
  try {
    const value = await fetchIt();
    if (isEmpty(value)) throw new Error('nothing found');
    cache[`_${name}`] = toJson(value);
    return value;
  } catch (err) {
    if (!cache[`_${name}`]) throw err;
    console.warn(`${name}: ${err.message}; using the last good copy`);
    return fromJson(cache[`_${name}`]);
  }
}
const mapsToJson = (maps) => Object.fromEntries(Object.entries(maps).map(([k, m]) => [k, [...m]]));
const mapsFromJson = (json) => Object.fromEntries(Object.entries(json).map(([k, entries]) => [k, new Map(entries)]));

const all = await bouts();
const ranked = await lastGood('rankings', rankings, (r) => !r.champions.size, mapsToJson, mapsFromJson);
const pflRanked = await lastGood('pflRankings', pflRankings, (r) => !r.ranks.size, mapsToJson, mapsFromJson);
console.log(`PFL: ${pflRanked.champions.size} champions, ${pflRanked.ranks.size} ranked, ${pflRanked.p4p.size} pound-for-pound`);
const titleHistory = await lastGood('titles', titles, (t) => !t.size, (t) => [...t], (json) => new Map(json));
console.log(`Title history: ${titleHistory.size} champions, ${[...titleHistory.values()].reduce((s, t) => s + t.defenses, 0)} defenses`);
console.log(`${all.length} fights; UFC.com: ${ranked.champions.size} champions, ${ranked.ranks.size} ranked`);

// Each fighter's fights, newest first
const byFighter = new Map();
for (const b of all) for (const f of b.fighters) (byFighter.get(f.id) ?? byFighter.set(f.id, []).get(f.id)).push(b);
for (const list of byFighter.values()) list.sort((a, b) => b.date.localeCompare(a.date));

// Active: a fight in a major promotion in the last two years. Retired fighters worth listing: 6+ fights in
// the majors, PRIDE, Strikeforce or WEC.
const cutoff = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString().slice(0, 10);
const lastMajor = (list) => list.find((b) => MAJORS.has(b.league));
const activeSet = new Set([...byFighter].filter(([, list]) => (lastMajor(list)?.date ?? '') >= cutoff).map(([id]) => id));
const RETIRED_MIN_FIGHTS = 6;
const active = [...byFighter]
  .filter(([id, list]) => activeSet.has(id) || list.filter((b) => HISTORIC.has(b.league)).length >= RETIRED_MIN_FIGHTS)
  .map(([id]) => id);
// Everyone whose stats are needed: the listed fighters, and every opponent they've had in the UFC or PFL
// (ESPN's stats cover those)
const STATS_LEAGUES = new Set(['ufc', 'pfl']);
const listedSet = new Set(active);
const needed = new Set(active);
for (const id of active) for (const b of byFighter.get(id)) if (STATS_LEAGUES.has(b.league)) for (const f of b.fighters) needed.add(f.id);

// The MMA rating (scripts/rating.mjs): every fighter's rating now, and his career replayed month by month
const NOW = Date.now();
const { state } = rate(all, PARAMS);
const { history: careers, qualityBar } = history(all, PARAMS);
// (his cautious rating today in a weight class: his rating, moved a step per class from the one he's rated
// in, less its deviation grown since his last fight)
const CLASS_TABS = ['FLW', 'BW', 'FW', 'LW', 'WW', 'MW', 'LHW', 'HW'];
const WOMEN_TABS = ['WSW', 'WFLW', 'WBW'];
const ratingIn = (id, tab) => {
  const s = state.get(id);
  if (!s) return null;
  const order = WOMEN_TABS.includes(tab) ? WOMEN_TABS : CLASS_TABS;
  const own = tabOf(s.lbs, s.women);
  const steps = own && order.includes(own) && order.includes(tab) ? order.indexOf(tab) - order.indexOf(own) : 0;
  return cautious(s.r - steps * PARAMS.divisionStep, deviationOn(s, NOW, PARAMS));
};
console.log(`Rating: ${state.size} fighters; a quality win is over ${Math.round(qualityBar)}+`);

const weekAgo = Date.now() - 7 * 864e5;
let fetched = 0;
for (const id of needed) {
  const entry = (cache[id] ??= {});
  const last = byFighter.get(id)[0].date;
  // (his UFC and PFL bouts: the ones ESPN keeps stats for; asked again after a new fight, or once more
  // when bouts of his are missing that the core API hasn't been asked for yet: core, the fight it was
  // asked through)
  const statBouts = byFighter.get(id).filter((b) => STATS_LEAGUES.has(b.league));
  const gaps = entry.stats && entry.core !== last && statBouts.some((b) => !entry.stats[b.id]);
  if (!entry.stats || entry.last !== last || gaps) {
    try {
      entry.stats = await fightStats(id, statBouts);
      entry.core = last;
    } catch {
      entry.stats ??= {};
    }
    entry.last = last;
    fetched++;
  }
  // (bios: the active fighters' weekly, a retired fighter's once)
  if (listedSet.has(id) && (!entry.bio || (activeSet.has(id) && (entry.bioAt ?? 0) < weekAgo))) {
    entry.bio = (await bio(id).catch(() => null)) ?? entry.bio ?? null;
    entry.bioAt = Date.now();
    fetched++;
  }
  if (fetched && fetched % 200 === 0) await writeFile(CACHE, JSON.stringify(cache));
}
await writeFile(CACHE, JSON.stringify(cache));

// Retired by the UFC's own word: a UFC fighter without a fight in six months whose UFC.com page says
// "Retired" or "Not Fighting" (Stipe Miocic, Chris Weidman...) isn't active, whatever the two-year rule
// says. Checked monthly per fighter.
const sixMonths = new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10);
const monthAgo = Date.now() - 30 * 864e5;
let statuses = 0;
for (const id of [...activeSet]) {
  const last = byFighter.get(id)[0];
  if (last.date >= sixMonths || last.league !== 'ufc') continue;
  const entry = (cache[id] ??= {});
  if (!entry.statusAt || entry.statusAt < monthAgo) {
    entry.status = await ufcStatus(entry.bio?.name ?? last.fighters.find((f) => f.id === id).name);
    entry.statusAt = Date.now();
    statuses++;
  }
  if (/^(Retired|Not Fighting)$/i.test(entry.status ?? '')) activeSet.delete(id);
}
// Retirements UFC.com hasn't caught up with yet (still "Active" there): by name
const RETIRED = ['Jon Jones', 'Dustin Poirier'];
for (const id of [...activeSet]) {
  const name = cache[id]?.bio?.name ?? byFighter.get(id)[0].fighters.find((f) => f.id === id).name;
  if (RETIRED.includes(name)) activeSet.delete(id);
}
await writeFile(CACHE, JSON.stringify(cache));
console.log(`UFC.com statuses: ${statuses} checked; ${activeSet.size} active`);

// His division: ESPN's for him, else his last fight's (not a catchweight)
const homeTab = (id) => DIVISIONS[cache[id]?.bio?.division] ?? byFighter.get(id).find((f) => f.tab)?.tab ?? null;

// Pound-for-pound: each fighter's rating against his own division's best (its active top 10's average), so
// a fighter well clear of a deep division ranks with one well clear of a shallow one; put back on the
// rating's scale (the divisions' average best added back)
const best = new Map();
for (const id of activeSet) {
  const tab = homeTab(id);
  const r = ratingIn(id, tab);
  if (!tab || r === null || (state.get(id)?.fights ?? 0) < 3) continue;
  (best.get(tab) ?? best.set(tab, []).get(tab)).push(r);
}
const top10 = new Map([...best].map(([tab, list]) => [tab, list.sort((x, y) => y - x).slice(0, 10).reduce((s, v, _, a) => s + v / a.length, 0)]));
const topAll = [...top10.values()].reduce((s, v, _, a) => s + v / a.length, 0);
const p4pRating = (id) => {
  const tab = homeTab(id);
  const r = ratingIn(id, tab);
  return r === null || !top10.has(tab) ? r : r - top10.get(tab) + topAll;
};

// How a fight ended, for the card
const METHOD = { KO: 'KO/TKO', SUB: 'Submission', UD: 'Unanimous decision', SD: 'Split decision', MD: 'Majority decision', DQ: 'Disqualification' };

const debutCutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const yearAgo = debutCutoff;
const WOMENS = ['WBW', 'WFLW', 'WSW'];
const out = Object.fromEntries(['P4P', 'HW', 'LHW', 'MW', 'WW', 'LW', 'FW', 'BW', 'FLW', 'WP4P', 'WBW', 'WFLW', 'WSW'].map((tab) => [tab, []]));
for (const id of active) {
  const fights = byFighter.get(id);
  const b = cache[id]?.bio;
  const name = b?.name ?? fights[0].fighters.find((f) => f.id === id).name;
  // Listed in one division, and the pound-for-pound tab (men's or women's), with his whole career on both:
  // the current lists in his own division now, the all-time ones in the division he fought in most (GSP at
  // welterweight, not the middleweight of his last fight; Holloway at featherweight, where he's at
  // lightweight now), ties to the one he earned the most career points in
  const home = homeTab(id);
  if (!home) continue;
  const h = careers.get(id);
  const women = WOMENS.includes(home);
  const fought = {};
  for (const f of fights) if (f.tab && WOMENS.includes(f.tab) === women) fought[f.tab] = (fought[f.tab] ?? 0) + 1;
  const most = Object.keys(fought).sort((a, b) => fought[b] - fought[a] || (h?.byTab?.[b] ?? 0) - (h?.byTab?.[a] ?? 0) || (b === home) - (a === home))[0] ?? home;
  const isActive = activeSet.has(id);
  const key = nameKey(name);
  // Results newest first: 1 a win, 0.5 a draw or no contest, 0 a loss
  const results = fights.map((f) => (f.fighters.find((x) => x.id === id).winner ? 1 : f.fighters.find((x) => x.id !== id).winner ? 0 : 0.5));
  let streak = 0;
  for (const r of results) {
    if (r === 0.5) break;
    if (streak === 0) streak = r ? 1 : -1;
    else if ((streak > 0 && r) || (streak < 0 && !r)) streak += Math.sign(streak);
    else break;
  }
  const champion = ranked.champions.get(key);
  const p4pTab = WOMENS.includes(home) ? 'WP4P' : 'P4P';
  const p4p = ranked[WOMENS.includes(home) ? 'wp4p' : 'p4p'].get(key);
  // (his rank in his division: 0 for a champion)
  const divisionRank = champion ? 0 : (ranked.ranks.get(`${home}/${key}`) ?? null);
  // (Wikipedia may write a name surname-first: "Weili Zhang" for Zhang Weili)
  const title = titleHistory.get(key) ?? titleHistory.get(nameKey(name.split(' ').reverse().join(' '))) ?? { reigns: 0, interim: 0, defenses: 0, winScore: 0, defenseScore: 0, promotions: [] };
  const c = career(id, fights, cache[id]?.stats ?? {}, cache);
  const won = fights.filter((f) => f.fighters.find((x) => x.id === id).winner);
  // His promotion's rank (Org Rank): the UFC's, or the PFL's for a PFL fighter (his last fight's
  // promotion). Only with a fight there in the last year: otherwise he's fighting elsewhere (no rankings
  // to read), or away long enough to be dropped from them, and no rank says nothing (inactive).
  const org = fights[0].league;
  // (the PFL fights less often: two years there, as for being active at all)
  const orgFresh = (org === 'ufc' && fights[0].date >= yearAgo) || (org === 'pfl' && fights[0].date >= cutoff);
  // (the PFL's names by ours, or by surname when the first names are spelled differently: Dovletdzhan
  // Yagshimuradov for Dovlet; its rank in whichever division it lists him)
  const pflKey = pflRanked.byName.has(key) ? key : uniqueSurname(pflRanked.names, name);
  const pflChampion = pflRanked.champions.get(pflKey);
  const pflDivision = pflKey ? (pflRanked.byName.get(pflKey) ?? null) : null;
  const pflP4p = pflRanked.p4p.get(pflKey) ?? pflRanked.p4p.get(key) ?? null;
  // (the rank shown, and what it counts as in the ranking on the 0-16 scale: the UFC's ranks as they are,
  // the champion #0 and unranked #16; pound-for-pound, the P4P top 15 first (#1 = 0.5 ... #15 = 7.5), then
  // his division rank behind them (its champion 7.5, #1 = 8 ... #15 = 15). A PFL rank counts five places below
  // the UFC's, its field being shallower: its champion as the UFC's #5, its #1 as #6 ... its #10 as #15)
  const orgRank = (tab) => {
    if (org === 'pfl') {
      const shown = tab === p4pTab ? pflP4p : pflDivision;
      if (!orgFresh) return { officialRank: shown };
      const scored = tab === p4pTab ? (pflP4p ? (5 + pflP4p) / 2 : pflDivision != null ? (15 + 5 + pflDivision) / 2 : 16) : shown != null ? 5 + shown : 16;
      return { officialRank: shown, rankScore: scored };
    }
    const shown = tab === p4pTab ? (p4p ?? null) : champion === tab ? 0 : (ranked.ranks.get(`${tab}/${key}`) ?? null);
    // (the Meta Rankings' division rank too, for that setting; pound-for-pound has none)
    const meta = tab === p4pTab ? undefined : champion === tab ? 0 : (ranked.metaRanks?.get(`${tab}/${key}`) ?? null);
    return {
      officialRank: shown,
      ...(meta !== undefined && ranked.metaRanks?.size ? { metaRank: meta } : {}),
      ...(tab === p4pTab ? { rankScore: p4p ? p4p / 2 : divisionRank != null ? (15 + divisionRank) / 2 : null } : {}),
    };
  };
  const row = (tab) => {
    const rating = tab === p4pTab ? p4pRating(id) : ratingIn(id, tab);
    const { officialRank, rankScore, metaRank } = orgRank(tab);
    return {
      division: tab === p4pTab ? (champion ?? home) : tab,
      ...(metaRank !== undefined ? { metaRank } : {}),
      // (his titles weighed, for the ranking: TITLE_WEIGHT; and the promotions he held one in)
      titleScore: { wins: Math.round((title.winScore ?? title.reigns + title.defenses) * 100) / 100, defenses: Math.round((title.defenseScore ?? title.defenses) * 100) / 100 },
      titles: title.promotions ?? (title.reigns ? ['UFC'] : []),
      // (the belt he holds now: the card's archetype)
      ...(champion ? { belt: 'UFC' } : pflChampion ? { belt: 'PFL' } : {}),
      ...(rankScore !== undefined ? { rankScore } : {}),
      inactive: !orgFresh,
      titleHolder: champion === tab,
      id: Number(id),
      gsisId: id,
      name,
      teamLogo: b?.flag ?? 'assets/textures/octagon.svg',
      teamName: b?.gym ?? null,
      country: b?.country ?? null,
      // (his promotion now: his last fight's)
      promotion: PROMOTIONS[fights[0].league] ?? null,
      // (a UFC fight in his career: the UFC Fighters Only setting's all-time lists)
      ufcCareer: fights.some((f) => f.league === 'ufc'),
      // (his whole pro career, as the Record column reads it: the regional fights too)
      games: proFights(b?.pro, fights.length),
      // (his own stats or his opponent's: what he absorbs comes from theirs)
      statFights: fights.filter((f) => cache[id]?.stats?.[f.id] || f.fighters.some((x) => x.id !== id && cache[x.id]?.stats?.[f.id])).length,
      rookie: fights[fights.length - 1].date >= debutCutoff,
      // (no fight in a major promotion in two years: listed with the Retired Fighters setting on)
      retired: !activeSet.has(id),
      lastFive: results.slice(0, 5),
      // (whom each came against, in the same order)
      lastFiveVs: fights.slice(0, 5).map((f) => `vs ${f.fighters.find((x) => x.id !== id)?.name ?? '?'}`),
      stats: {
        ...c,
        ...proRecord(b?.pro, c),
        streak,
        rating: rating === null ? null : Math.round(rating),
        peakRating: h?.peak == null ? null : Math.round(h.peak),
        // (career points: the all-time lists' measure)
        careerPoints: Math.round((h?.points ?? 0) * 10) / 10,
        bestWin: h?.bestWin == null ? null : Math.round(h.bestWin),
        oppRating: h?.oppN ? Math.round(h.oppSum / h.oppN) : null,
        qualityWins: h?.qualityWins ?? 0,
        mainEventWins: won.filter((f) => f.rounds >= 5).length,
        titleWins: title.reigns + title.defenses,
        titleDefenses: title.defenses,
        // (his best place in those monthly rankings, or the belt (#0) for anyone who held a title)
        peakRank: title.reigns || champion || pflChampion ? 0 : (h?.bestPlace ?? null),
        // (his promotion's: the division's top 15 (the PFL's top 10), the champion above it as #0;
        // pound-for-pound on that tab)
        officialRank,
        age: b?.age ?? null,
        reach: b?.reach ?? null,
      },
      pro: b?.pro ?? null,
      awards: [...(champion && (champion === tab || tab === p4pTab) ? ['champ'] : []), ...(p4p ? [`p4p${p4p}`] : [])],
      // His fights, newest first (the card's Fights tab): date, opponent, result, how it ended, event
      fights: fights.map((f) => {
        const opp = f.fighters.find((x) => x.id !== id);
        const me = f.fighters.find((x) => x.id === id);
        const result = me.winner ? 'W' : opp.winner ? 'L' : 'D';
        const time = `${Math.floor(f.clock / 60)}:${String(f.clock % 60).padStart(2, '0')}`;
        // (no winner: a draw at the final bell, a no contest when it ended early)
        const how = f.decision
          ? result === 'D'
            ? 'Draw'
            : (METHOD[f.method] ?? 'Decision')
          : result === 'D'
            ? `No contest · R${f.period} ${time}`
            : `${METHOD[f.method] ?? 'Finish'} · R${f.period} ${time}`;
        return [f.date, opp.name, result, how, f.event];
      }),
    };
  };
  out[p4pTab].push(row(p4pTab));
  // (an active fighter's two divisions: his own now in the current lists, the one he fought in most in the
  // all-time lists)
  if (!isActive || most === home) out[isActive ? home : most].push(row(isActive ? home : most));
  else {
    out[home].push({ ...row(home), only: 'current' });
    out[most].push({ ...row(most), only: 'allTime' });
  }
}
for (const tab of Object.keys(out)) out[tab].sort((a, b) => a.name.localeCompare(b.name));
await mkdir(STATIC, { recursive: true });
// (each fighter's fields alike in his tabs stored once: half the download)
await writeFile(path.join(STATIC, 'skill-players.json'), JSON.stringify(shareRows(out)));
console.log(
  `${Object.entries(out).map(([tab, rows]) => `${rows.length} ${tab}`).join(', ')} (${active.length} fighters, ${activeSet.size} active; fetched ${fetched}; champions ${Object.values(out).flat().filter((u) => u.awards.includes('champ')).length})`,
);
