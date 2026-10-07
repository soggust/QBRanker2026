// The Roster tab's data (the card's Team, O-Line, Defense and Head Coach rows): each team's depth chart
// (every slot of its offense, its base defense and special teams, a few deep), everyone who took a snap
// for it (their share of the offense's, defense's and special teams' snaps, and their games), its main
// offensive personnel (how many backs, tight ends and receivers it had on the field, on average, from the
// snap counts), the injury report (ESPN's: the season being played only), and the starters who changed
// over the season. One file per team, by its logo's name: StaticData/depth/<Ravens>.json for the season
// being played, StaticData/seasons/<year>/depth/ for past ones. Free: no AI.
//
//   node apps/nfl/scripts/build-depth.mjs              (the season being played: nightly, after update-data)
//   node apps/nfl/scripts/build-depth.mjs 2001-2025    (past seasons: once; a finished season doesn't change)
//
// nflverse's depth charts come two ways: daily snapshots in its own slot scheme (2025 on: the chart as of
// the regular season's end, or now), and weekly charts with each team's own position labels before that
// (the final regular-season week's, those labels read into the same slots). Snap counts start in 2012.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { espnInjuries } from './analysis/live.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CACHE = path.join(ROOT, '.cache/nflverse');
const DATA = path.join(ROOT, 'apps/nfl/src/StaticData');
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const CURRENT_SEASON = 2026;
// (fresh enough: the nightly run downloads the season being played again; a past season's never change)
const FRESH_HOURS = 6;

async function download(file, url, { optional = false, current = true } = {}) {
  const to = path.join(CACHE, file);
  if (existsSync(to) && (!current || Date.now() - statSync(to).mtimeMs < FRESH_HOURS * 36e5)) return to;
  const res = await fetch(url);
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`${file}: ${res.status}`);
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  return to;
}

// A CSV (quoted fields allowed) as objects
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const readCsv = (file) => (file ? parseCsv(file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString() : readFileSync(file, 'utf8')) : []);
const num = (v) => (v === undefined || v === '' || v === 'NA' ? null : Number(v));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// The slots, in the daily charts' own scheme: the offense's 3WR 1TE set, the base 3-4 or 4-3, the
// specialists that matter on a card
const OFFENSE_SLOTS = [
  ['WR1', 'WR', 'Wide Receiver'], ['WR2', 'WR', 'Wide Receiver'], ['LT3', 'LT', 'Left Tackle'], ['LG4', 'LG', 'Left Guard'],
  ['C5', 'C', 'Center'], ['RG6', 'RG', 'Right Guard'], ['RT7', 'RT', 'Right Tackle'], ['WR8', 'WR', 'Wide Receiver'],
  ['QB9', 'QB', 'Quarterback'], ['TE10', 'TE', 'Tight End'], ['RB11', 'RB', 'Running Back'], ['FB12', 'FB', 'Fullback'],
];
const DEFENSE_34 = [
  ['LDE1', 'LDE', 'Left Defensive End'], ['NT2', 'NT', 'Nose Tackle'], ['RDE3', 'RDE', 'Right Defensive End'],
  ['WLB4', 'WLB', 'Weakside Linebacker'], ['LILB5', 'LILB', 'Left Inside Linebacker'], ['RILB6', 'RILB', 'Right Inside Linebacker'],
  ['SLB7', 'SLB', 'Strongside Linebacker'],
];
const DEFENSE_43 = [
  ['LDE1', 'LDE', 'Left Defensive End'], ['LDT2', 'LDT', 'Left Defensive Tackle'], ['RDT3', 'RDT', 'Right Defensive Tackle'],
  ['RDE4', 'RDE', 'Right Defensive End'], ['WLB5', 'WLB', 'Weakside Linebacker'], ['MLB6', 'MLB', 'Middle Linebacker'],
  ['SLB7', 'SLB', 'Strongside Linebacker'],
];
const SECONDARY = [['LCB8', 'LCB', 'Left Cornerback'], ['SS9', 'SS', 'Strong Safety'], ['FS10', 'FS', 'Free Safety'], ['RCB11', 'RCB', 'Right Cornerback'], ['NB12', 'NB', 'Nickel Back']];
const SPECIAL = [['PK', 'PK', 'Kicker'], ['P', 'P', 'Punter'], ['LS', 'LS', 'Long Snapper'], ['KR', 'KR', 'Kick Returner'], ['PR', 'PR', 'Punt Returner']];

// The spots whose starters can trade labels without anything changing (the receivers, the corners, the
// safeties, the ends, the tackles, the inside and outside linebackers), and each spot's short label
const FAMILY = {
  WR1: 'WR', WR2: 'WR', WR8: 'WR', LCB8: 'CB', RCB11: 'CB', SS9: 'S', FS10: 'S', LDE1: 'DE', RDE3: 'DE', RDE4: 'DE',
  LDT2: 'DT', RDT3: 'DT', LILB5: 'ILB', RILB6: 'ILB', WLB4: 'OLB', SLB7: 'OLB', WLB5: 'OLB',
};
const LABEL_OF = Object.fromEntries(
  [...OFFENSE_SLOTS, ...DEFENSE_34, ...DEFENSE_43, ...SECONDARY].map(([key, abb]) => [key, { WR1: 'X', WR2: 'Z', WR8: 'slot', NB12: 'nickel' }[key] ?? abb]),
);

// ---- the daily charts (2025 on): the snapshot as of a date, each slot's players by depth
function dailyChart(rows, dt) {
  const at = rows.filter((r) => r.dt === dt);
  const slots = new Map();
  for (const r of at) {
    const side = r.pos_grp === 'Special Teams' ? 'special' : /^Base/.test(r.pos_grp) ? 'defense' : 'offense';
    const key = side === 'special' ? r.pos_abb : `${r.pos_abb}${r.pos_slot}`;
    if (side === 'special' && !SPECIAL.some(([k]) => k === key)) continue;
    if (!slots.has(key)) slots.set(key, { side, key, abb: r.pos_abb, name: r.pos_name, depth: [] });
    slots.get(key).depth[Number(r.pos_rank) - 1] = r.gsis_id || `espn:${r.espn_id}`;
  }
  for (const s of slots.values()) s.depth = s.depth.filter(Boolean);
  const front = at.find((r) => /^Base/.test(r.pos_grp))?.pos_grp.replace(/^Base\s+|\s*D$/g, '') ?? '4-3';
  const names = new Map(at.map((r) => [r.gsis_id || `espn:${r.espn_id}`, { name: r.player_name, espnId: r.espn_id || null }]));
  return { slots, front, names };
}

// ---- the weekly charts (before 2025): each team's own labels read into the same slots
// (a label's family: which slot it can fill, and its side when it says)
const OFF_FAMILY = {
  LT: 'LT', LOT: 'LT', RT: 'RT', ROT: 'RT', T: 'T', LG: 'LG', RG: 'RG', G: 'G', C: 'C', QB: 'QB', RB: 'RB', HB: 'RB',
  FB: 'FB', F: 'FB', TE: 'TE', 'TE/FB': 'TE', WR: 'WR',
};
const DEF_FAMILY = {
  LDE: 'LDE', RDE: 'RDE', LE: 'LDE', RE: 'RDE', DE: 'DE', END: 'DE', EDGE: 'EDGE', RUSH: 'EDGE',
  LDT: 'LDT', RDT: 'RDT', DT: 'DT', UT: 'DT', DL: 'DT', NT: 'NT',
  LOLB: 'WLB', WLB: 'WLB', WILL: 'WLB', ROLB: 'SLB', SLB: 'SLB', SAM: 'SLB', OLB: 'OLB', JLB: 'OLB',
  LILB: 'LILB', RILB: 'RILB', ILB: 'ILB', MLB: 'MLB', MIKE: 'MLB', BLB: 'ILB', LB: 'LB',
  LCB: 'LCB', RCB: 'RCB', CB: 'CB', DB: 'CB', SS: 'SS', FS: 'FS', S: 'S',
  NB: 'NB', NCB: 'NB', NICK: 'NB', NKL: 'NB', NICKE: 'NB', N: 'NB', NDB: 'NB',
};
const ST_FAMILY = { K: 'PK', PK: 'PK', P: 'P', LS: 'LS', KR: 'KR', KOR: 'KR', PR: 'PR' };

function weeklyChart(rows) {
  const clean = (v) => String(v ?? '').replace(/["\s]/g, '').toUpperCase();
  // (each label's players: the starters, then the ones behind them, in the chart's order)
  const by = (formation, families) => {
    const groups = new Map();
    for (const r of rows.filter((x) => x.formation === formation)) {
      const fam = families[clean(r.depth_position)];
      if (!fam || !r.gsis_id) continue;
      if (!groups.has(fam)) groups.set(fam, []);
      groups.get(fam).push({ id: r.gsis_id, depth: Number(r.depth_team) || 9 });
    }
    for (const list of groups.values()) list.sort((a, b) => a.depth - b.depth);
    return groups;
  };
  const off = by('Offense', OFF_FAMILY);
  const def = by('Defense', DEF_FAMILY);
  const st = by('Special Teams', ST_FAMILY);
  const names = new Map(rows.map((r) => [r.gsis_id, { name: r.full_name || `${r.first_name} ${r.last_name}`, espnId: null }]));

  // (a label several start at, its starters dealt out to as many slots, the ones behind them in turn)
  const deal = (list, count) => {
    const starters = list.filter((p) => p.depth === 1).slice(0, count);
    const n = Math.max(starters.length, 1);
    const chains = Array.from({ length: count }, (_, i) => (starters[i] ? [starters[i].id] : []));
    list.filter((p) => p.depth > 1).forEach((p, i) => chains[i % n].push(p.id));
    return chains;
  };
  const take = (fam) => (fam ? (off.get(fam) ?? def.get(fam) ?? []) : []);
  const slots = new Map();
  const put = (key, abb, name, side, ids) => {
    const depth = [...new Set(ids.filter(Boolean))];
    if (depth.length) slots.set(key, { side, key, abb, name, depth });
  };

  // offense: the line by side (a plain T or G dealt left, then right), the receivers dealt X, Z, slot
  const tackles = deal(take('T'), 2);
  const guards = deal(take('G'), 2);
  const line = { LT: take('LT').map((p) => p.id), RT: take('RT').map((p) => p.id), LG: take('LG').map((p) => p.id), RG: take('RG').map((p) => p.id) };
  if (!line.LT.length) line.LT = tackles[0];
  if (!line.RT.length) line.RT = tackles[1];
  if (!line.LG.length) line.LG = guards[0];
  if (!line.RG.length) line.RG = guards[1];
  const wrs = deal(take('WR'), 3);
  const ids = (fam) => take(fam).map((p) => p.id);
  for (const [key, abb, name] of OFFENSE_SLOTS) {
    const chain = { WR1: wrs[0], WR2: wrs[1], WR8: wrs[2], LT3: line.LT, LG4: line.LG, C5: ids('C'), RG6: line.RG, RT7: line.RT, QB9: ids('QB'), TE10: ids('TE'), RB11: ids('RB'), FB12: ids('FB') }[key];
    put(key, abb, name, 'offense', chain ?? []);
  }

  // defense: each label's chains (one per starter at it, the ones behind dealt among them), then the
  // front from its starting line (a nose tackle, or three down linemen: a 3-4), and the chains placed by
  // role: the line's middle and ends, the linebackers inside first and then on the edges, a slot short
  // on one side filled from the other's extras
  const chainsOf = (fams) =>
    fams.flatMap((f) => {
      const list = take(f);
      const n = list.filter((p) => p.depth === 1).length;
      return n ? deal(list, n).map((chain) => ({ fam: f, chain })) : [];
    });
  const dl = chainsOf(['LDE', 'DE', 'RDE', 'LDT', 'DT', 'RDT', 'NT']);
  // (four starting linemen: a 4-3, whatever one of them is called; three, or fewer with a nose tackle: a 3-4)
  const front = dl.length >= 4 ? '4-3' : dl.length === 3 || dl.some((c) => c.fam === 'NT') ? '3-4' : '4-3';
  const lb = chainsOf(['LILB', 'ILB', 'MLB', 'LB', 'RILB', 'WLB', 'OLB', 'SLB', ...(front === '3-4' ? ['EDGE'] : [])]);
  const edgeDl = front === '4-3' ? chainsOf(['EDGE']) : [];
  // (pull a chain out of a pool: the first label listed that has one, or any left when none fits)
  const pick = (pool, fams, fallback = true) => {
    let i = -1;
    for (const f of fams) if (i < 0) i = pool.findIndex((c) => c.fam === f);
    if (i < 0 && fallback) i = pool.length ? 0 : -1;
    return i < 0 ? [] : pool.splice(i, 1)[0].chain;
  };
  let defense;
  if (front === '3-4') {
    const line = [...dl];
    const nose = pick(line, ['NT', 'DT', 'LDT', 'RDT']);
    const left = pick(line, ['LDE', 'DE', 'DT', 'LDT']);
    const right = pick(line, ['RDE', 'DE', 'DT', 'RDT']);
    const backers = [...lb];
    const lilb = pick(backers, ['LILB', 'ILB', 'MLB', 'LB']);
    // (the second inside spot: another inside linebacker, else the weakside one moves in)
    const rilb = pick(backers, ['RILB', 'ILB', 'MLB', 'LB'], false);
    const inside2 = rilb.length ? rilb : pick(backers, ['WLB', 'LB', 'OLB']);
    const wlb = pick(backers, ['WLB', 'OLB', 'EDGE']);
    const slb = pick(backers, ['SLB', 'OLB', 'EDGE']);
    defense = { LDE1: left, NT2: nose, RDE3: right, WLB4: wlb, LILB5: lilb, RILB6: inside2, SLB7: slb };
  } else {
    const line = [...dl, ...edgeDl];
    const left = pick(line, ['LDE', 'DE', 'EDGE']);
    const right = pick(line, ['RDE', 'DE', 'EDGE']);
    const ldt = pick(line, ['LDT', 'DT', 'NT']);
    const rdt = pick(line, ['RDT', 'DT', 'NT']);
    const backers = [...lb];
    const mlb = pick(backers, ['MLB', 'ILB', 'LILB', 'RILB', 'LB']);
    const wlb = pick(backers, ['WLB', 'OLB', 'LB']);
    const slb = pick(backers, ['SLB', 'OLB', 'LB']);
    defense = { LDE1: left, LDT2: ldt, RDT3: rdt, RDE4: right, WLB5: wlb, MLB6: mlb, SLB7: slb };
  }
  const corners = deal([...take('LCB'), ...take('CB'), ...take('RCB')].sort((a, b) => a.depth - b.depth), 2);
  const safeties = deal([...take('SS'), ...take('S'), ...take('FS')].sort((a, b) => a.depth - b.depth), 2);
  for (const [key, abb, name] of [...(front === '3-4' ? DEFENSE_34 : DEFENSE_43), ...SECONDARY]) {
    const chain = { ...defense, LCB8: corners[0], RCB11: corners[1], SS9: safeties[0], FS10: safeties[1], NB12: ids('NB') }[key];
    put(key, abb, name, 'defense', chain ?? []);
  }
  for (const [key, abb, name] of SPECIAL) put(key, abb, name, 'special', (st.get(key) ?? []).map((p) => p.id));
  return { slots, front, names };
}

// ---- the main personnel: on average, how many backs, tight ends and receivers were on the field (each
// game's snap shares summed by position), as the nearest real grouping ("12": one back, two tight ends)
const GROUPINGS = [[1, 1, 3], [1, 2, 2], [2, 1, 2], [1, 3, 1], [2, 2, 1], [1, 0, 4], [0, 1, 4]];
function personnel(snapRows) {
  const games = new Map();
  for (const r of snapRows) {
    const g = games.get(r.game_id) ?? { rb: 0, te: 0, wr: 0 };
    const share = num(r.offense_pct) ?? 0;
    if (['RB', 'FB', 'HB'].includes(r.position)) g.rb += share;
    else if (r.position === 'TE') g.te += share;
    else if (r.position === 'WR') g.wr += share;
    games.set(r.game_id, g);
  }
  if (!games.size) return null;
  const mean = (k) => [...games.values()].reduce((s, g) => s + g[k], 0) / games.size;
  const avg = { rb: mean('rb'), te: mean('te'), wr: mean('wr') };
  const [rb, te, wr] = GROUPINGS.reduce((best, g) => {
    const err = (x) => (x[0] - avg.rb) ** 2 + (x[1] - avg.te) ** 2 + (x[2] - avg.wr) ** 2;
    return err(g) < err(best) ? g : best;
  });
  return { rb, te, wr, avg: { rb: round(avg.rb, 2), te: round(avg.te, 2), wr: round(avg.wr, 2) } };
}

// (the snap counts' positions, grouped for the usage list; the chart's slots, for players with no snaps)
const UNIT = {
  QB: 'QB', RB: 'RB', FB: 'RB', HB: 'RB', WR: 'WR', TE: 'TE', T: 'OL', G: 'OL', C: 'OL', OT: 'OL', OG: 'OL', OL: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB',
  K: 'ST', P: 'ST', LS: 'ST',
};
const SLOT_UNIT = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  LDE: 'DL', RDE: 'DL', NT: 'DL', LDT: 'DL', RDT: 'DL', WLB: 'LB', SLB: 'LB', MLB: 'LB', LILB: 'LB', RILB: 'LB',
  LCB: 'DB', RCB: 'DB', SS: 'DB', FS: 'DB', NB: 'DB', PK: 'ST', P: 'ST', LS: 'ST', KR: 'ST', PR: 'ST',
};

// A headshot, kept short: the part of the NFL's image link after its transforms ("league/abc123")
const headshotId = (url) => (url && url !== 'NA' ? (url.match(/\/upload\/[^/]+\/(.+)$/)?.[1] ?? url) : null);

async function buildSeason(season, players) {
  const current = season === CURRENT_SEASON;
  const dir = current ? path.join(DATA, 'depth') : path.join(DATA, 'seasons', String(season), 'depth');
  const daily = season >= 2025;
  const chartFile = await download(
    `depth_charts_${season}${daily ? '.csv.gz' : '.csv'}`,
    `${NFLVERSE}/depth_charts/depth_charts_${season}${daily ? '.csv.gz' : '.csv'}`,
    { current },
  );
  const [chartRows, snapRows, schedule] = await Promise.all([
    Promise.resolve(readCsv(chartFile)),
    // (snap counts start in 2012; one that won't read just leaves its season without them)
    season >= 2012
      ? download(`snap_counts_${season}.csv.gz`, `${NFLVERSE}/snap_counts/snap_counts_${season}.csv.gz`, { optional: true, current })
          .then(readCsv)
          .catch(() => [])
      : [],
    download('games.csv', SCHEDULE_URL).then(readCsv),
  ]);
  const injuries = current ? await espnInjuries().catch(() => new Map()) : new Map();
  // (the weekly injury reports, 2009 on: who was out or doubtful each week, and with what)
  const injuryRows =
    season >= 2009
      ? await download(`injuries_${season}.csv.gz`, `${NFLVERSE}/injuries/injuries_${season}.csv.gz`, { optional: true, current })
          .then(readCsv)
          .catch(() => [])
      : [];
  // (the weekly rosters, 2002 on: each player's status each week, active, on injured reserve, cut, traded,
  // on the practice squad, and his team)
  const rosterRows =
    season >= 2002
      ? await download(`roster_weekly_${season}.csv.gz`, `${NFLVERSE}/weekly_rosters/roster_weekly_${season}.csv.gz`, { optional: true, current })
          .then(readCsv)
          .catch(() => [])
      : [];
  const rosterStatus = new Map(rosterRows.filter((r) => r.game_type === 'REG').map((r) => [`${r.week}|${r.gsis_id}`, { status: r.status, team: r.team }]));
  const injuryReports = new Map(
    injuryRows
      .filter((r) => r.game_type === 'REG' && /^(Out|Doubtful)$/.test(r.report_status))
      .map((r) => [`${r.week}|${r.gsis_id}`, `${r.report_status}${r.report_primary_injury ? ` (${r.report_primary_injury.toLowerCase()})` : ''}`]),
  );
  const byGsis = new Map(players.map((p) => [p.gsis_id, p]));
  const byPfr = new Map(players.filter((p) => p.pfr_id && p.pfr_id !== 'NA').map((p) => [p.pfr_id, p]));
  // (each team's logo name, from that season's own rows: "BAL" -> "Ravens")
  const siteFile = current ? path.join(DATA, 'skill-players.json') : path.join(DATA, 'seasons', String(season), 'skill-players.json');
  if (!existsSync(siteFile)) return 0;
  const site = JSON.parse(readFileSync(siteFile, 'utf8'));
  const logoOf = new Map(site.DEF.map((u) => [u.gsisId.slice(4), u.teamLogo.split('/').pop().replace('.png', '')]));
  const reg = schedule.filter((g) => g.season === String(season) && g.game_type === 'REG');
  const firstGame = reg.map((g) => g.gameday).sort()[0];
  const lastGame = reg.map((g) => g.gameday).sort().at(-1);
  const lastWeek = Math.max(...reg.map((g) => Number(g.week)));
  // (the old charts' and snap counts' team codes, where they differ from the site's: the site files a
  // moved team under its current code)
  const ALIAS = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' };

  mkdirSync(dir, { recursive: true });
  const teamCol = daily ? 'team' : 'club_code';
  const teams = [...new Set(chartRows.map((r) => r[teamCol]))].sort();
  let written = 0;
  for (const code of teams) {
    const team = ALIAS[code] ?? code;
    const logo = logoOf.get(team);
    if (!logo) continue;
    const rows = chartRows.filter((r) => r[teamCol] === code);

    // the chart now (or at the season's end), and at its start
    let now;
    let asOf;
    if (daily) {
      const stamps = [...new Set(rows.map((r) => r.dt))].sort();
      const end = current ? stamps.at(-1) : (stamps.filter((dt) => dt.slice(0, 10) <= lastGame).at(-1) ?? stamps.at(-1));
      now = dailyChart(rows, end);
      asOf = end;
    } else {
      const regular = rows.filter((r) => r.game_type === 'REG');
      const weeks = [...new Set(regular.map((r) => Number(r.week)))].sort((a, b) => a - b);
      const last = weeks.filter((w) => w <= lastWeek).at(-1) ?? weeks.at(-1);
      now = weeklyChart(regular.filter((r) => Number(r.week) === last));
      asOf = lastGame;
    }

    // everyone: on the chart, or with a snap this season
    const people = new Map();
    const person = (id, fallback) => {
      if (!people.has(id)) {
        const p = byGsis.get(id);
        people.set(id, {
          name: p?.display_name ?? fallback?.name ?? id,
          espnId: p?.espn_id && p.espn_id !== 'NA' ? p.espn_id : (fallback?.espnId ?? null),
          headshot: headshotId(p?.headshot),
          pos: fallback?.pos ?? p?.position ?? null,
          unit: null,
          off: 0,
          def: 0,
          st: 0,
          games: 0,
          chart: null,
          status: null,
          injury: null,
        });
      }
      return people.get(id);
    };
    for (const s of now.slots.values()) {
      s.depth.forEach((id, i) => {
        const p = person(id, now.names.get(id));
        if (!p.chart || i === 0) p.chart = { key: s.key, depth: i + 1 };
        p.unit ??= SLOT_UNIT[s.abb] ?? null;
      });
    }
    const teamSnaps = snapRows.filter((r) => (ALIAS[r.team] ?? r.team) === team && r.game_type === 'REG');
    const games = new Set(teamSnaps.map((r) => r.game_id));
    const usage = new Map();
    for (const r of teamSnaps) {
      const id = byPfr.get(r.pfr_player_id)?.gsis_id || `pfr:${r.pfr_player_id}`;
      const u = usage.get(id) ?? { name: r.player, pos: r.position, off: 0, def: 0, st: 0, games: 0 };
      u.off += num(r.offense_pct) ?? 0;
      u.def += num(r.defense_pct) ?? 0;
      u.st += num(r.st_pct) ?? 0;
      u.games++;
      usage.set(id, u);
    }
    for (const [id, u] of usage) {
      const p = person(id, { name: u.name, pos: u.pos });
      Object.assign(p, { off: round(u.off / u.games), def: round(u.def / u.games), st: round(u.st / u.games), games: u.games, pos: u.pos ?? p.pos });
      p.unit = UNIT[u.pos] ?? p.unit;
    }
    for (const i of injuries.get(team) ?? []) {
      const hit = [...people.values()].find((p) => p.name === i.name);
      if (hit) Object.assign(hit, { status: i.status, injury: i.injury });
    }

    // The season's evolution: the chart before each game, each week's starters against the week before.
    // A change is a starter gone from his spot (not two players only trading labels), and who took it;
    // with why: hurt (the injury report), on injured reserve, released or traded (the weekly rosters),
    // still on the chart behind him (the coach's decision), or the new one moved over from another spot.
    // (The season being played: its games so far and the next one, whose chart is the one now.)
    const weekCharts = [];
    if (daily) {
      const stamps = [...new Set(rows.map((r) => r.dt))].sort();
      const games = reg.filter((x) => x.home_team === code || x.away_team === code).sort((a, b) => Number(a.week) - Number(b.week));
      const next = games.findIndex((g) => num(g.home_score) === null);
      for (const g of next < 0 ? games : games.slice(0, next + 1)) {
        const dt = stamps.filter((d) => d.slice(0, 10) <= g.gameday).at(-1);
        if (dt) weekCharts.push({ week: Number(g.week), chart: dailyChart(rows, dt) });
      }
    } else {
      const regular = rows.filter((r) => r.game_type === 'REG');
      for (const w of [...new Set(regular.map((r) => Number(r.week)))].filter((w) => w <= lastWeek).sort((a, b) => a - b)) {
        weekCharts.push({ week: w, chart: weeklyChart(regular.filter((r) => Number(r.week) === w)) });
      }
    }
    const report = (week, id) => injuryReports.get(`${week}|${id}`);
    const timeline = [];
    for (let i = 1; i < weekCharts.length; i++) {
      const before = weekCharts[i - 1].chart;
      const after = weekCharts[i].chart;
      // (where a player starts in a chart: his spot, by key)
      const spotOf = (chart) => new Map([...chart.slots.values()].filter((s) => s.side !== 'special' && s.depth[0]).map((s) => [s.depth[0], s.key]));
      const beforeSpot = spotOf(before);
      const afterSpot = spotOf(after);
      const changes = [];
      for (const [key, s] of after.slots) {
        if (s.side === 'special') continue;
        const was = before.slots.get(key)?.depth[0];
        const is = s.depth[0];
        if (!was || !is || was === is) continue;
        // (two starters only trading labels within a group, the receivers' X and Z or the corners' sides: no
        // change; a starter moving to another spot, the right guard to center, is one, marked a move)
        const group = FAMILY[key];
        if (group && FAMILY[beforeSpot.get(is)] === group && FAMILY[afterSpot.get(was)] === group) continue;
        // (two starters exchanging spots outright: how the old charts' labels fell, not a change)
        if (beforeSpot.get(is) && beforeSpot.get(is) === afterSpot.get(was)) continue;
        person(was, before.names.get(was));
        person(is, after.names.get(is));
        const week = weekCharts[i].week;
        const movedFrom = beforeSpot.get(is);
        const moved = movedFrom ? `moved from ${LABEL_OF[movedFrom] ?? movedFrom}` : null;
        const hurt = report(week, was);
        const roster = rosterStatus.get(`${week}|${was}`);
        const stillListed = [...after.slots.values()].some((x) => x.depth.includes(was));
        const nowAt = afterSpot.get(was);
        const [reason, note] = hurt
          ? ['injury', hurt]
          : nowAt
            ? ['moved', `Moved to ${LABEL_OF[nowAt] ?? nowAt}`]
          : roster?.status === 'RES'
            ? ['ir', 'Injured reserve']
            : roster?.status === 'CUT'
              ? ['released', 'Released']
              : roster?.status === 'TRD' || (roster && roster.team !== code)
                ? ['traded', 'Traded']
                : roster?.status === 'RET'
                  ? ['retired', 'Retired']
                  : roster?.status === 'INA'
                    ? ['inactive', 'Inactive']
                  : stillListed || roster?.status === 'ACT' || roster?.status === 'DEV'
                    ? ['coach', moved ? `Coach's decision, ${moved}` : "Coach's decision"]
                    : !roster && rosterStatus.size
                      ? ['released', 'Off the roster']
                      : moved
                        ? ['moved', moved]
                        : [null, null];
        changes.push({ side: s.side, key, name: s.name, from: was, to: is, reason, note });
      }
      if (changes.length) timeline.push({ week: weekCharts[i].week, changes });
    }

    const out = {
      team,
      logo,
      season,
      at: asOf,
      teamGames: games.size,
      front: now.front,
      personnel: personnel(teamSnaps),
      slots: [...now.slots.values()].map(({ side, key, abb, name, depth }) => ({ side, key, abb, name, depth })),
      players: Object.fromEntries(people),
      timeline,
    };
    writeFileSync(path.join(dir, `${logo}.json`), JSON.stringify(out));
    written++;
  }
  return written;
}

async function main() {
  const arg = process.argv[2];
  const seasons = !arg
    ? [CURRENT_SEASON]
    : arg.includes('-')
      ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(arg.split('-').map(Number))
      : arg.split(',').map(Number);
  const players = readCsv(await download('players.csv.gz', `${NFLVERSE}/players/players.csv.gz`));
  for (const season of seasons) {
    try {
      const n = await buildSeason(season, players);
      console.log(`${season}: ${n} teams`);
    } catch (err) {
      console.log(`${season}: FAILED ${err.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
