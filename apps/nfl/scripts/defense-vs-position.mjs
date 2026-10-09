// Defense vs position: what each defense allowed to the offense's WR1, WR2, WR3, TE1 and RB1, against
// those players' own averages; whether offenses throw or run more than usual on it (a pass or run
// funnel) and run more or fewer plays (pace); and where the targets go against it (WRs, TEs, RBs).
// All from the play-by-play (and snap counts, from 2012, for who played), so every season back to 2000
// has it. update-data.mjs adds it to each DEF row (vsPos) of every part it writes; run on its own, this
// file adds it to the files that are already written (the current season's, in StaticData/ itself, too):
//
//   node apps/nfl/scripts/defense-vs-position.mjs            (every season, 2000 on, the current one too)
//   node apps/nfl/scripts/defense-vs-position.mjs 2024 2025  (just those)
//
// Roles, per game: an offense's receivers (WR, TE) by their target share and its backs by their carry
// share over its earlier games that season, among the players who played in this one (offensive
// snaps, or a target or carry before 2012), so a breakout week doesn't change who counts as its WR1.
// A team's first game, with nothing before it, goes by that game's own usage (its offensive snaps, then its
// targets or carries, which alone would make a shut-down WR1 its WR2). A player's share is over
// the team's games he played in (a WR1 back from injury is still its WR1).
//
// Allowed: per game, the role's receptions, yards, touchdowns, targets and PPR points (receiving and
// rushing, two-point conversions, fumbles lost), and the same against what that player averaged in his
// other games that season (a role player with no other game: the league's average for the role). The
// regular season's roles and averages come from its own games; the playoffs' and both's from the
// whole season, the playoffs included. Ranks: 1 the best defense (the least allowed over expected).
//
// Funnel: how much more (or less) opponents throw on this defense than they usually do, in percentage
// points (positive: a pass funnel), in neutral situations (win probability 20-80%, outside the last two
// minutes of a half; every play where win probability is missing from most). From 2006 on (method 'proe'):
// their pass rate over expected against it (nflverse's xpass, which knows the down, distance, field
// position, time and score), less each offense's own pass rate over expected in its other games. Before
// 2006, with no xpass (method 'rate'): their plain pass rate against each offense's own in its other games.
// Rank 1 the strongest pass funnel.
// Pace: the opponents' offensive plays per game against their own average in their other games.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { currentSeason } from '../../../libs/ranker/scripts/wiki-staff.mjs';

export const VS_ROLES = ['WR1', 'WR2', 'WR3', 'TE1', 'RB1'];
const GROUPS = ['WR', 'TE', 'RB'];
const GROUP_OF = { WR: 'WR', TE: 'TE', RB: 'RB', FB: 'RB', HB: 'RB' };
const MOVED = { OAK: 'LV', SD: 'LAC', STL: 'LA', LAR: 'LA' };
const teamOf = (t) => MOVED[t] ?? t;
const num = (v) => (v === undefined || v === '' || v === 'NA' ? null : Number(v));
const id = (v) => (v && v !== 'NA' ? v : null);
const r1 = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);

// Ranks 1..n by a value (lower first unless desc); equal values share a rank
function rankBy(entries, desc = false) {
  const valued = entries.filter(([, v]) => v !== null && Number.isFinite(v));
  const ranks = new Map();
  for (const [key, v] of valued) ranks.set(key, 1 + valued.filter(([, w]) => (desc ? w > v : w < v)).length);
  return ranks;
}

// The season's play-by-play (every game, the playoffs too), its snap counts, each player's position
// (gsis id -> "WR"), Pro Football Reference ids to gsis ids, and the part being built:
// team -> its vsPos block
export function defenseVsPosition({ pbp, snaps = [], positionOf, gsisByPfr, part = 'regular', teams = null }) {
  const inPart = (type) => part === 'all' || (part === 'regular') === (type === 'REG');
  // (the games that set roles and averages: the regular season's own, or the whole season)
  const inBase = (type) => part !== 'regular' || type === 'REG';
  const groupOf = (gsis) => GROUP_OF[positionOf.get(gsis)] ?? null;

  const games = new Map(); // game -> { week, type, sides: Map(offense -> defense) }
  const players = new Map(); // game|player -> line
  const sides = new Map(); // game|offense -> team line
  const line = (game, player, team) => {
    const key = `${game}|${player}`;
    let l = players.get(key);
    if (!l) players.set(key, (l = { game, player, team, tgt: 0, rec: 0, yds: 0, td: 0, car: 0, ryds: 0, rtd: 0, two: 0, fl: 0 }));
    return l;
  };
  let incompletions = 0;
  for (const p of pbp) {
    if (!inBase(p.season_type)) continue;
    const off = teamOf(p.posteam);
    const def = teamOf(p.defteam);
    if (!id(off) || !id(def)) continue;
    let g = games.get(p.game_id);
    if (!g) games.set(p.game_id, (g = { id: p.game_id, week: Number(p.week), type: p.season_type, sides: new Map() }));
    g.sides.set(off, def);
    const sideKey = `${p.game_id}|${off}`;
    let s = sides.get(sideKey);
    if (!s) sides.set(sideKey, (s = { tgt: 0, car: 0, plays: 0, passes: 0, nPlays: 0, nPasses: 0, x: [0, 0, 0], xn: [0, 0, 0], passYds: 0, rushYds: 0 }));
    const receiver = id(p.receiver_player_id);
    const rusher = id(p.rusher_player_id);
    if (p.two_point_attempt === '1') {
      if (p.two_point_conv_result === 'success' && (receiver || rusher)) line(p.game_id, receiver ?? rusher, off).two++;
      continue;
    }
    if (p.play_type !== 'pass' && p.play_type !== 'run') continue;
    if (p.pass === '1' || p.rush === '1') {
      s.plays++;
      if (p.pass === '1') s.passes++;
      const wp = num(p.wp);
      const half = num(p.half_seconds_remaining);
      const isNeutral = wp !== null && wp >= 0.2 && wp <= 0.8 && (half === null || half > 120);
      if (isNeutral) {
        s.nPlays++;
        if (p.pass === '1') s.nPasses++;
      }
      // (where nflverse has its chance of a pass, xpass: [plays, passes, xpass summed], all and neutral)
      const xpass = num(p.xpass);
      if (xpass !== null && Number.isFinite(xpass)) {
        for (const x of isNeutral ? [s.x, s.xn] : [s.x]) {
          x[0]++;
          if (p.pass === '1') x[1]++;
          x[2] += xpass;
        }
      }
    }
    if (p.pass_attempt === '1' && p.sack !== '1' && p.qb_spike !== '1' && receiver) {
      const l = line(p.game_id, receiver, off);
      l.tgt++;
      s.tgt++;
      if (p.complete_pass === '1') {
        const yds = num(p.receiving_yards) ?? num(p.yards_gained) ?? 0;
        l.rec++;
        l.yds += yds;
        s.passYds += yds;
        if (p.pass_touchdown === '1' && (id(p.td_player_id) ?? receiver) === receiver) l.td++;
      } else if (p.complete_pass === '0') incompletions++;
    }
    if (p.rush_attempt === '1' && rusher) {
      const l = line(p.game_id, rusher, off);
      const yds = num(p.rushing_yards) ?? num(p.yards_gained) ?? 0;
      l.car++;
      l.ryds += yds;
      s.car++;
      s.rushYds += yds;
      if (p.rush_touchdown === '1' && (id(p.td_player_id) ?? rusher) === rusher) l.rtd++;
    }
    const fumbler = id(p.fumbled_1_player_id);
    if (p.fumble_lost === '1' && fumbler) line(p.game_id, fumbler, off).fl++;
  }
  // (older play-by-play names the receiver on catches only: no targets to speak of)
  const hasTargets = incompletions > 1000;
  const ppr = (l) => l.rec + (l.yds + l.ryds) / 10 + 6 * (l.td + l.rtd) + 2 * l.two - 2 * l.fl;

  // Who played: offensive snaps (2012 on), or a target or carry
  const played = new Map(); // game|team -> Map(player -> snaps)
  const playedIn = (game, team) => {
    const key = `${game}|${team}`;
    let m = played.get(key);
    if (!m) played.set(key, (m = new Map()));
    return m;
  };
  for (const r of snaps) {
    const snapsOn = num(r.offense_snaps) ?? 0;
    const gsis = gsisByPfr.get(r.pfr_player_id);
    if (snapsOn > 0 && gsis && games.has(r.game_id)) playedIn(r.game_id, teamOf(r.team)).set(gsis, snapsOn);
  }
  for (const l of players.values()) {
    if (l.tgt || l.car) {
      const m = playedIn(l.game, l.team);
      if (!m.has(l.player)) m.set(l.player, 0);
    }
  }
  const lineOf = (game, player) => players.get(`${game}|${player}`);
  const bySide = Map.groupBy(players.values(), (l) => `${l.game}|${l.team}`);

  // Each player's season (the base games): PPR points and yards over his games
  const season = new Map();
  for (const [key, m] of played) {
    const game = key.slice(0, key.lastIndexOf('|'));
    for (const player of m.keys()) {
      const l = lineOf(game, player);
      const s = season.get(player) ?? { games: 0, ppr: 0, rec: 0, scr: 0 };
      s.games++;
      if (l) {
        s.ppr += ppr(l);
        s.rec += l.yds;
        s.scr += l.yds + l.ryds;
      }
      season.set(player, s);
    }
  }

  // Roles, game by game for each offense
  const roles = new Map(); // game|offense -> { WR1: player, ... }
  const byTeam = new Map();
  for (const g of games.values()) for (const off of g.sides.keys()) byTeam.set(off, [...(byTeam.get(off) ?? []), g]);
  for (const [off, list] of byTeam) {
    list.sort((a, b) => a.week - b.week);
    const cum = new Map(); // player -> { tgt, teamTgt, car, teamCar }
    list.forEach((g, i) => {
      const side = sides.get(`${g.id}|${off}`);
      const m = played.get(`${g.id}|${off}`) ?? new Map();
      const first = i === 0;
      const here = [...m.entries()].map(([player, snapsOn]) => {
        const l = lineOf(g.id, player);
        const c = cum.get(player);
        return {
          player,
          group: groupOf(player),
          snaps: snapsOn,
          tgt: l?.tgt ?? 0,
          car: l?.car ?? 0,
          tgtShare: c?.teamTgt ? c.tgt / c.teamTgt : 0,
          carShare: c?.teamCar ? c.car / c.teamCar : 0,
        };
      });
      const order = (share, use) => (a, b) =>
        first ? b.snaps - a.snaps || b[use] - a[use] : b[share] - a[share] || b.snaps - a.snaps || b[use] - a[use];
      const wrs = here.filter((x) => x.group === 'WR').sort(order('tgtShare', 'tgt'));
      const tes = here.filter((x) => x.group === 'TE').sort(order('tgtShare', 'tgt'));
      const rbs = here.filter((x) => x.group === 'RB').sort(order('carShare', 'car'));
      roles.set(`${g.id}|${off}`, { WR1: wrs[0]?.player, WR2: wrs[1]?.player, WR3: wrs[2]?.player, TE1: tes[0]?.player, RB1: rbs[0]?.player });
      for (const x of here) {
        const c = cum.get(x.player) ?? { tgt: 0, teamTgt: 0, car: 0, teamCar: 0 };
        c.tgt += x.tgt;
        c.teamTgt += side?.tgt ?? 0;
        c.car += x.car;
        c.teamCar += side?.car ?? 0;
        cum.set(x.player, c);
      }
    });
  }

  // Yards for a role: receiving, or a back's from scrimmage
  const roleYds = (role, l) => (l ? l.yds + (role === 'RB1' ? l.ryds : 0) : 0);
  // A role player's average in his other games (null: no other game)
  const others = (role, player, l) => {
    const s = season.get(player);
    if (!s || s.games < 2) return null;
    const yds = role === 'RB1' ? s.scr : s.rec;
    return { ppr: (s.ppr - (l ? ppr(l) : 0)) / (s.games - 1), yds: (yds - roleYds(role, l)) / (s.games - 1) };
  };
  // (the league's average for each role over the part's games: the stand-in)
  const partGames = [...games.values()].filter((g) => inPart(g.type));
  const roleAvg = {};
  for (const role of VS_ROLES) {
    let n = 0, pts = 0, yds = 0;
    for (const g of partGames) {
      for (const off of g.sides.keys()) {
        const player = roles.get(`${g.id}|${off}`)?.[role];
        if (!player) continue;
        const l = lineOf(g.id, player);
        n++;
        pts += l ? ppr(l) : 0;
        yds += roleYds(role, l);
      }
    }
    roleAvg[role] = { ppr: n ? pts / n : 0, yds: n ? yds / n : 0 };
  }
  // An offense's own norm in its other base games: neutral pass rate and plays per game
  const norms = new Map();
  for (const [off, list] of byTeam) {
    const all = list.map((g) => sides.get(`${g.id}|${off}`)).filter(Boolean);
    norms.set(off, {
      games: all.length,
      plays: all.reduce((a, s) => a + s.plays, 0),
      nPlays: all.reduce((a, s) => a + s.nPlays, 0),
      nPasses: all.reduce((a, s) => a + s.nPasses, 0),
      passes: all.reduce((a, s) => a + s.passes, 0),
      x: [0, 1, 2].map((i) => all.reduce((a, s) => a + s.x[i], 0)),
      xn: [0, 1, 2].map((i) => all.reduce((a, s) => a + s.xn[i], 0)),
    });
  }
  const allSides = [...sides.values()];
  const allPlays = allSides.reduce((a, s) => a + s.plays, 0);
  const shareOf = (get) => (allPlays ? allSides.reduce((a, s) => a + get(s), 0) / allPlays : 0);
  // (win probability missing from most plays: the funnel reads every play instead)
  const neutral = shareOf((s) => s.nPlays) >= 0.3;
  // (nflverse's xpass on most runs and passes (2006 on): the funnel over expected; without it, the plain rate)
  const method = shareOf((s) => s.x[0]) >= 0.5 ? 'proe' : 'rate';

  // Each defense, over the part's games
  const totals = new Map();
  const totalFor = (def) => {
    let t = totals.get(def);
    if (!t) {
      totals.set(def, (t = {
        games: 0,
        roles: Object.fromEntries(VS_ROLES.map((r) => [r, { g: 0, tgt: 0, rec: 0, yds: 0, td: 0, ppr: 0, exp: 0, expYds: 0 }])),
        passYds: 0, rushYds: 0,
        fPlays: 0, fPasses: 0, fExp: 0,
        plays: 0, expPlays: 0, paceGames: 0,
        groups: Object.fromEntries(GROUPS.map((gr) => [gr, { tgt: 0, yds: 0 }])),
      }));
    }
    return t;
  };
  for (const g of partGames) {
    for (const [off, def] of g.sides) {
      const s = sides.get(`${g.id}|${off}`);
      const t = totalFor(def);
      t.games++;
      t.passYds += s.passYds;
      t.rushYds += s.rushYds;
      const assigned = roles.get(`${g.id}|${off}`) ?? {};
      for (const role of VS_ROLES) {
        const player = assigned[role];
        if (!player) continue;
        const l = lineOf(g.id, player);
        const r = t.roles[role];
        const avg = others(role, player, l) ?? roleAvg[role];
        r.g++;
        if (l) {
          r.tgt += l.tgt;
          r.rec += l.rec;
          r.yds += roleYds(role, l);
          r.td += l.td + l.rtd;
          r.ppr += ppr(l);
        }
        r.exp += avg.ppr;
        r.expYds += avg.yds;
      }
      // Funnel and pace against the offense's other games
      const n = norms.get(off);
      if (method === 'proe') {
        // (over expected: what they'd throw here is xpass plus the offense's own lean over it elsewhere)
        const [plays, passes, xSum] = neutral ? s.xn : s.x;
        const [allPlays, allPasses, allX] = neutral ? n.xn : n.x;
        const restPlays = allPlays - plays;
        if (restPlays > 0 && plays > 0) {
          const lean = (allPasses - passes - (allX - xSum)) / restPlays;
          t.fPlays += plays;
          t.fPasses += passes;
          t.fExp += xSum + lean * plays;
        }
      } else {
        const plays = neutral ? s.nPlays : s.plays;
        const passes = neutral ? s.nPasses : s.passes;
        const restPlays = (neutral ? n.nPlays : n.plays) - plays;
        const restPasses = (neutral ? n.nPasses : n.passes) - passes;
        if (restPlays > 0 && plays > 0) {
          t.fPlays += plays;
          t.fPasses += passes;
          t.fExp += (restPasses / restPlays) * plays;
        }
      }
      if (n.games > 1) {
        t.plays += s.plays;
        t.expPlays += (n.plays - s.plays) / (n.games - 1);
        t.paceGames++;
      }
      for (const l of bySide.get(`${g.id}|${off}`) ?? []) {
        if (!l.tgt) continue;
        const group = groupOf(l.player);
        if (!group) continue;
        t.groups[group].tgt += l.tgt;
        t.groups[group].yds += l.yds;
      }
    }
  }

  const list = (teams ?? [...totals.keys()]).filter((team) => totals.has(team));
  const out = new Map();
  const league = Object.fromEntries(GROUPS.map((gr) => [gr, list.reduce((a, team) => a + totals.get(team).groups[gr].tgt, 0)]));
  const leagueTgt = GROUPS.reduce((a, gr) => a + league[gr], 0);
  for (const team of list) {
    const t = totals.get(team);
    const block = {};
    for (const role of VS_ROLES) {
      const r = t.roles[role];
      const per = (v) => (r.g ? r1(v / r.g) : null);
      const ppg = r.g ? r.ppr / r.g : null;
      const exp = r.g ? r.exp / r.g : null;
      block[role] = {
        g: r.g,
        tgt: hasTargets ? per(r.tgt) : null,
        rec: per(r.rec),
        yds: per(r.yds),
        td: r.g ? Math.round((r.td / r.g) * 100) / 100 : null,
        ppr: r1(ppg),
        exp: r1(exp),
        vs: ppg === null ? null : r1(ppg - exp),
        // (yards against his average: receiving, a back's from scrimmage)
        ydsVs: r.g ? r1((r.yds - r.expYds) / r.g) : null,
        rank: null,
      };
    }
    block.pass = { ypg: r1(t.passYds / t.games), rank: null };
    block.run = { ypg: r1(t.rushYds / t.games), rank: null };
    // (rate: their pass rate on the plays counted; exp: what they'd usually throw there (with 'proe', the
    // situation's xpass plus their own lean over it); score: the difference, in points)
    const rate = t.fPlays ? t.fPasses / t.fPlays : null;
    const expRate = t.fPlays ? t.fExp / t.fPlays : null;
    block.funnel = {
      rate: r3(rate),
      exp: r3(expRate),
      score: rate === null ? null : r1((rate - expRate) * 100),
      rank: null,
      neutral,
      method,
    };
    block.pace = {
      plays: t.paceGames ? r1(t.plays / t.paceGames) : null,
      exp: t.paceGames ? r1(t.expPlays / t.paceGames) : null,
      diff: t.paceGames ? r1((t.plays - t.expPlays) / t.paceGames) : null,
      rank: null,
    };
    const groupTgt = GROUPS.reduce((a, gr) => a + t.groups[gr].tgt, 0);
    block.targets = hasTargets
      ? Object.fromEntries(
          GROUPS.map((gr) => [
            gr,
            {
              share: groupTgt ? r3(t.groups[gr].tgt / groupTgt) : null,
              lg: leagueTgt ? r3(league[gr] / leagueTgt) : null,
              tgt: r1(t.groups[gr].tgt / t.games),
              yds: r1(t.groups[gr].yds / t.games),
              ypt: t.groups[gr].tgt ? Math.round((t.groups[gr].yds / t.groups[gr].tgt) * 100) / 100 : null,
              rank: null,
            },
          ]),
        )
      : null;
    out.set(team, block);
  }
  // Ranks: the least allowed over expected first; the least yards; the strongest pass funnel first;
  // the fewest extra plays; the fewest yards per target
  const rank = (get, set, desc = false) => {
    const ranks = rankBy([...out].map(([team, b]) => [team, get(b)]), desc);
    for (const [team, b] of out) set(b, ranks.get(team) ?? null);
  };
  for (const role of VS_ROLES) rank((b) => b[role].vs, (b, v) => (b[role].rank = v));
  rank((b) => b.pass.ypg, (b, v) => (b.pass.rank = v));
  rank((b) => b.run.ypg, (b, v) => (b.run.rank = v));
  rank((b) => b.funnel.score, (b, v) => (b.funnel.rank = v), true);
  rank((b) => b.pace.diff, (b, v) => (b.pace.rank = v));
  if (hasTargets) for (const gr of GROUPS) rank((b) => b.targets[gr].ypt, (b, v) => (b.targets[gr].rank = v));
  // (who held each role in each game, game|offense -> { WR1: gsis id, ... }: for checking)
  out.roles = roles;
  return out;
}

// ---------------------------------------------------------------------------
// Run on its own: add vsPos to the seasons' DEF rows (every part already written)
// ---------------------------------------------------------------------------
const CACHE = new URL('../../../.cache/nflverse/', import.meta.url);
const STATIC_DIR = new URL('../src/StaticData/', import.meta.url);
const SEASONS_DIR = new URL('seasons/', STATIC_DIR);
// (the current season, as update-data.mjs's CURRENT_SEASON: its files are StaticData/'s own)
const CURRENT_SEASON = currentSeason(path.join(import.meta.dirname, '..'));

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
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((key, i) => [key, r[i]])));
}
const readCsvGz = async (name) => parseCsv(gunzipSync(await readFile(new URL(name, CACHE))).toString());

async function backfill(seasons) {
  const players = await readCsvGz('players.csv.gz');
  const positionOf = new Map(players.map((p) => [p.gsis_id, p.position]));
  const gsisByPfr = new Map(players.filter((p) => id(p.pfr_id)).map((p) => [p.pfr_id, p.gsis_id]));
  for (const year of seasons) {
    const started = Date.now();
    const pbp = await readCsvGz(`play_by_play_${year}.csv.gz`);
    const snaps = year >= 2012 ? await readCsvGz(`snap_counts_${year}.csv.gz`).catch(() => []) : [];
    const dir = year === CURRENT_SEASON ? STATIC_DIR : new URL(`${year}/`, SEASONS_DIR);
    const done = [];
    for (const part of ['regular', 'post', 'all']) {
      const file = new URL(part === 'regular' ? 'skill-players.json' : `skill-players.${part}.json`, dir);
      const text = await readFile(file, 'utf8').catch(() => null);
      if (text === null) continue;
      const data = JSON.parse(text);
      const vs = defenseVsPosition({ pbp, snaps, positionOf, gsisByPfr, part });
      for (const row of data.DEF ?? []) row.vsPos = vs.get(row.gsisId.replace(/^DEF-/, '')) ?? null;
      await writeFile(file, JSON.stringify(data));
      done.push(part);
    }
    console.log(`${year}: vsPos added (${done.join(', ')}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2).map(Number).filter(Boolean);
  const seasons = args.length ? args : Array.from({ length: CURRENT_SEASON + 1 - 2000 }, (_, i) => 2000 + i);
  backfill(seasons).catch((err) => {
    console.error(err.stack);
    process.exit(1);
  });
}
