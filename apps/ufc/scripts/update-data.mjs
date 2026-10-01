// Builds the UFC app's data: every active fighter's UFC career, by division (a fighter is active with a
// UFC fight in the last two years), and the retired ones with 6+ UFC fights (the Retired Fighters
// setting). Every fighter also gets an Elo rating, worked out over every UFC bout since 2001.
//
// - ESPN's UFC scoreboards (one request a year, 2001 on): every bout, its fighters, the winner, the
//   division, and the round and time it ended (a fight that reaches the final bell is a decision)
// - ESPN's fighters (cached in scripts/cache.json, refetched only after a new fight or after a week):
//   each fighter's bio (division, gender, country flag, headshot, gym, reach, age, pro record) and his
//   stats fight by fight (strikes, knockdowns, takedowns, submission attempts, ground advances).
//   Opponents' stats are fetched too, so what a fighter absorbs is counted, not only what he lands.
// - UFC.com's rankings page: each division's champion and top 15, and the pound-for-pound lists
//
// Usage: npm run ufc:update-data
//
// Writes skill-players.json in the shape the app reads: { HW: [...], ..., WSW: [...] }, each fighter
// { id, gsisId, name, teamLogo (his country's flag), teamName (his gym), games (UFC fights), stats,
// awards, rookie (his UFC debut in the last year), lastFive, fights (his UFC fights, newest first) }.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/StaticData');
const CACHE = path.join(import.meta.dirname, 'cache.json');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc';
const COMMON = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes';
const RANKINGS = 'https://www.ufc.com/rankings';
const FIRST_YEAR = 2001;
const THIS_YEAR = new Date().getUTCFullYear();
const ACTIVE_DAYS = 730;
const ROUND = 300;

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
// Bouts: every UFC fight from the scoreboards
// ---------------------------------------------------------------------------
async function bouts() {
  const out = [];
  for (let year = FIRST_YEAR; year <= THIS_YEAR; year++) {
    const board = await get(`${SITE}/scoreboard?dates=${year}&limit=1000`);
    for (const event of board?.events ?? []) {
      for (const c of event.competitions ?? []) {
        if (!c.status?.type?.completed || c.competitors?.length !== 2) continue;
        const periods = c.format?.regulation?.periods ?? 3;
        const period = c.status.period ?? periods;
        const clock = Math.min(ROUND, c.status.clock ?? ROUND);
        out.push({
          id: c.id,
          event: event.name,
          date: (c.date ?? event.date).slice(0, 10),
          division: c.type?.abbreviation ?? '',
          seconds: (period - 1) * ROUND + clock,
          // (the final bell: a decision; anything sooner, a finish)
          decision: period >= periods && clock >= ROUND,
          rounds: periods,
          period,
          clock,
          fighters: c.competitors.map((p) => ({ id: String(p.id), name: p.athlete?.displayName ?? '', winner: !!p.winner })),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fighters: bios and fight-by-fight stats, cached
// ---------------------------------------------------------------------------
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
};

// A fighter's stats by bout: [sig landed, sig attempted, knockdowns, takedowns landed, takedowns
// attempted, submission attempts, ground advances, reversals]
async function fightStats(id) {
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
// Rankings: UFC.com's champions, top 15s and pound-for-pound lists (by name)
// ---------------------------------------------------------------------------
async function rankings() {
  const html = (await get(RANKINGS, 'text')) ?? '';
  const out = { champions: new Map(), ranks: new Map(), p4p: new Map() };
  const seen = new Set();
  for (const group of html.split('<div class="view-grouping">').slice(1)) {
    const head = (group.match(/view-grouping-header">([^<]*)/)?.[1] ?? '').replace(/&#0?39;/g, "'").trim();
    if (seen.has(head)) continue;
    seen.add(head);
    const champion = group.match(/<h5>\s*<a[^>]*>([^<]*)<\/a>/)?.[1];
    const ranked = [...group.matchAll(/views-field-title[^>]*>\s*<a[^>]*>([^<]*)<\/a>/g)].map((m) => nameKey(m[1]));
    if (/Pound-for-Pound/.test(head)) {
      ranked.forEach((key, i) => out.p4p.set(key, i + 1));
      continue;
    }
    const tab = RANKING_DIVISIONS[head];
    if (!tab) continue;
    if (champion) out.champions.set(nameKey(champion), tab);
    ranked.forEach((key, i) => out.ranks.set(key, i + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// A fighter's UFC career, from his bouts and both sides' stats
// ---------------------------------------------------------------------------
function career(id, fights, stats, cache) {
  const t = { secs: 0, ssl: 0, ssa: 0, kd: 0, tdl: 0, tda: 0, sm: 0, ad: 0, oppSecs: 0, oppSsl: 0, oppSsa: 0, oppKd: 0, oppTdl: 0, oppTda: 0 };
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let finishes = 0;
  let finished = 0;
  for (const b of fights) {
    const me = b.fighters.find((f) => f.id === id);
    const opp = b.fighters.find((f) => f.id !== id);
    if (me.winner) wins++;
    else if (opp.winner) losses++;
    else draws++;
    if (me.winner && !b.decision) finishes++;
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
const all = await bouts();
const ranked = await rankings();
console.log(`${all.length} UFC bouts ${FIRST_YEAR}-${THIS_YEAR}; ${ranked.champions.size} champions, ${ranked.ranks.size} ranked`);

const byFighter = new Map();
for (const b of all) for (const f of b.fighters) (byFighter.get(f.id) ?? byFighter.set(f.id, []).get(f.id)).push(b);
for (const list of byFighter.values()) list.sort((a, b) => b.date.localeCompare(a.date));

const cutoff = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString().slice(0, 10);
const activeSet = new Set([...byFighter].filter(([, list]) => list[0].date >= cutoff).map(([id]) => id));
// The retired fighters worth listing: 6+ UFC fights
const RETIRED_MIN_FIGHTS = 6;
const active = [...byFighter].filter(([id, list]) => activeSet.has(id) || list.length >= RETIRED_MIN_FIGHTS).map(([id]) => id);
// Everyone whose stats are needed: the listed fighters, and every opponent they've had in the UFC
const listedSet = new Set(active);
const needed = new Set(active);
for (const id of active) for (const b of byFighter.get(id)) for (const f of b.fighters) needed.add(f.id);

// Elo ratings over every UFC bout, oldest first: everyone starts at 1500, and a fight moves both
// fighters by how surprising the result was (K = 32), so a win over a highly rated opponent is worth far
// more than one over a low one. A draw splits the difference; a no contest (no winner before the final
// bell) counts for nothing. Each bout keeps both fighters' ratings going in.
const ELO_START = 1500;
const ELO_K = 32;
const elo = new Map();
const eloBefore = new Map();
const peakElo = new Map();
for (const b of [...all].sort((x, y) => x.date.localeCompare(y.date))) {
  const [a, c] = b.fighters;
  const ra = elo.get(a.id) ?? ELO_START;
  const rc = elo.get(c.id) ?? ELO_START;
  eloBefore.set(`${b.id}/${a.id}`, ra);
  eloBefore.set(`${b.id}/${c.id}`, rc);
  const noContest = !a.winner && !c.winner && !b.decision;
  if (noContest) continue;
  const expected = 1 / (1 + 10 ** ((rc - ra) / 400));
  const score = a.winner ? 1 : c.winner ? 0 : 0.5;
  const move = ELO_K * (score - expected);
  elo.set(a.id, ra + move);
  elo.set(c.id, rc - move);
  peakElo.set(a.id, Math.max(peakElo.get(a.id) ?? ELO_START, ra + move));
  peakElo.set(c.id, Math.max(peakElo.get(c.id) ?? ELO_START, rc - move));
}
// A quality win: over an opponent rated in the top fifth of the fighters going in (at that point in
// the UFC's history, among everyone with 3+ fights)
const ratedPool = [...elo].filter(([id]) => byFighter.get(id).length >= 3).map(([, r]) => r).sort((x, y) => x - y);
const QUALITY_ELO = ratedPool[Math.floor(ratedPool.length * 0.8)];
console.log(`Elo: ${elo.size} fighters rated; a quality win is over ${Math.round(QUALITY_ELO)}+`);

let cache = {};
try {
  cache = JSON.parse(await readFile(CACHE, 'utf8'));
} catch {
  // (a first run: everything is fetched)
}
const weekAgo = Date.now() - 7 * 864e5;
let fetched = 0;
for (const id of needed) {
  const entry = (cache[id] ??= {});
  const last = byFighter.get(id)[0].date;
  if (!entry.stats || entry.last !== last) {
    entry.stats = await fightStats(id).catch(() => entry.stats ?? {});
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

// Opponents' strength: each fighter's UFC win percentage (3+ fights; others count as .500)
const strength = new Map(
  [...byFighter].map(([id, list]) => {
    const w = list.filter((b) => b.fighters.find((f) => f.id === id).winner).length;
    return [id, list.length >= 3 ? w / list.length : 0.5];
  }),
);

const debutCutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const out = Object.fromEntries(['HW', 'LHW', 'MW', 'WW', 'LW', 'FW', 'BW', 'FLW', 'WBW', 'WFLW', 'WSW'].map((tab) => [tab, []]));
for (const id of active) {
  const fights = byFighter.get(id);
  const b = cache[id]?.bio;
  const name = b?.name ?? fights[0].fighters.find((f) => f.id === id).name;
  // His division: ESPN's for him, else his last fight's (not a catchweight)
  const lastDivision = fights.find((f) => DIVISIONS[f.division])?.division;
  const tab = DIVISIONS[b?.division] ?? DIVISIONS[lastDivision];
  if (!tab) continue;
  const key = nameKey(name);
  const c = career(id, fights, cache[id]?.stats ?? {}, cache);
  // Results newest first: 1 a win, 0.5 a draw or no contest, 0 a loss
  const results = fights.map((f) => (f.fighters.find((x) => x.id === id).winner ? 1 : f.fighters.find((x) => x.id !== id).winner ? 0 : 0.5));
  let streak = 0;
  for (const r of results) {
    if (r === 0.5) break;
    if (streak === 0) streak = r ? 1 : -1;
    else if ((streak > 0 && r) || (streak < 0 && !r)) streak += Math.sign(streak);
    else break;
  }
  const opponents = fights.map((f) => strength.get(f.fighters.find((x) => x.id !== id).id) ?? 0.5);
  const won = fights.filter((f) => f.fighters.find((x) => x.id === id).winner);
  const qualityWins = won.filter((f) => (eloBefore.get(`${f.id}/${f.fighters.find((x) => x.id !== id).id}`) ?? ELO_START) >= QUALITY_ELO).length;
  const mainEventWins = won.filter((f) => f.rounds >= 5).length;
  const champion = ranked.champions.get(key);
  const p4p = ranked.p4p.get(key);
  out[tab].push({
    id: Number(id),
    gsisId: id,
    name,
    teamLogo: b?.flag ?? 'assets/textures/octagon.svg',
    teamName: b?.gym ?? null,
    country: b?.country ?? null,
    games: fights.length,
    rookie: fights[fights.length - 1].date >= debutCutoff,
    // (no UFC fight in two years: listed with the Retired Fighters setting on)
    retired: !activeSet.has(id),
    lastFive: results.slice(0, 5),
    stats: {
      ...c,
      streak,
      schedule: round(opponents.reduce((s, v) => s + v, 0) / opponents.length),
      elo: Math.round(elo.get(id) ?? ELO_START),
      peakElo: Math.round(peakElo.get(id) ?? ELO_START),
      qualityWins,
      mainEventWins,
      officialRank: champion === tab ? null : (ranked.ranks.get(key) ?? null),
      age: b?.age ?? null,
      reach: b?.reach ?? null,
    },
    pro: b?.pro ?? null,
    awards: [...(champion === tab ? ['champ'] : []), ...(p4p ? [`p4p${p4p}`] : [])],
    // His UFC fights, newest first (the card's Fights tab): date, opponent, result, how it ended, event
    fights: fights.slice(0, 15).map((f) => {
      const opp = f.fighters.find((x) => x.id !== id);
      const me = f.fighters.find((x) => x.id === id);
      const result = me.winner ? 'W' : opp.winner ? 'L' : 'D';
      const time = `${Math.floor(f.clock / 60)}:${String(f.clock % 60).padStart(2, '0')}`;
      // (no winner: a draw at the final bell, a no contest when it ended early)
      const how = f.decision ? (result === 'D' ? 'Draw' : 'Decision') : result === 'D' ? `No contest · R${f.period} ${time}` : `R${f.period} ${time}`;
      return [f.date, opp.name, result, how, f.event];
    }),
  });
}
for (const tab of Object.keys(out)) out[tab].sort((a, b) => a.name.localeCompare(b.name));
await mkdir(STATIC, { recursive: true });
await writeFile(path.join(STATIC, 'skill-players.json'), JSON.stringify(out));
console.log(
  `${Object.entries(out).map(([tab, rows]) => `${rows.length} ${tab}`).join(', ')} (${active.length} active; fetched ${fetched}; champions ${Object.values(out).flat().filter((u) => u.awards.includes('champ')).length})`,
);
