// The Depth Chart tab's data (the card's Team, O-Line, Defense and Head Coach rows): each team's depth
// chart now (nflverse's, refreshed daily: every slot of its offense, its base defense and special teams,
// up to four deep), everyone who's taken a snap for it this season (from the snap counts: their share of
// the offense's, defense's and special teams' snaps, and their games), the injury report (ESPN's), and the
// starters who've changed since the season began. One file per team, by its logo's name:
// src/StaticData/depth/<Ravens>.json. Free: no AI. Run nightly after update-data.
//
//   node apps/nfl/scripts/build-depth.mjs

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { espnInjuries } from './analysis/live.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CACHE = path.join(ROOT, '.cache/nflverse');
const DATA = path.join(ROOT, 'apps/nfl/src/StaticData');
const OUT = path.join(DATA, 'depth');
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const SEASON = 2026;
// (fresh enough: the nightly run downloads them again)
const FRESH_HOURS = 6;

async function download(file, url) {
  const to = path.join(CACHE, file);
  if (existsSync(to) && Date.now() - statSync(to).mtimeMs < FRESH_HOURS * 36e5) return to;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
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
const readCsv = (file) => parseCsv(file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString() : readFileSync(file, 'utf8'));
const num = (v) => (v === undefined || v === '' || v === 'NA' ? null : Number(v));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// The depth chart's groups, by side (its 3WR 1TE set is the offense; Base 3-4 D or 4-3 D the defense)
const SIDE = (group) => (group === 'Special Teams' ? 'special' : /^Base/.test(group) ? 'defense' : 'offense');
// (the special teams that matter on a card: the kicker, punter, snapper and returners)
const SPECIAL = new Set(['PK', 'P', 'LS', 'KR', 'PR']);
// The positions the snap counts give, grouped for the usage list
const UNIT = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', T: 'OL', G: 'OL', C: 'OL', OT: 'OL', OG: 'OL', OL: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB',
  K: 'ST', P: 'ST', LS: 'ST',
};
// (the depth chart's slot codes to the usage list's groups, for players with no snaps yet)
const SLOT_UNIT = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  LDE: 'DL', RDE: 'DL', NT: 'DL', LDT: 'DL', RDT: 'DL', WLB: 'LB', SLB: 'LB', MLB: 'LB', LILB: 'LB', RILB: 'LB',
  LCB: 'DB', RCB: 'DB', SS: 'DB', FS: 'DB', NB: 'DB', PK: 'ST', P: 'ST', LS: 'ST', KR: 'ST', PR: 'ST',
};

async function main() {
  const [depthRows, snaps, players, schedule] = await Promise.all([
    download(`depth_charts_${SEASON}.csv.gz`, `${NFLVERSE}/depth_charts/depth_charts_${SEASON}.csv.gz`).then(readCsv),
    download(`snap_counts_${SEASON}.csv.gz`, `${NFLVERSE}/snap_counts/snap_counts_${SEASON}.csv.gz`).then(readCsv),
    download('players.csv.gz', `${NFLVERSE}/players/players.csv.gz`).then(readCsv),
    download('games.csv', SCHEDULE_URL).then(readCsv),
  ]);
  const injuries = await espnInjuries().catch(() => new Map());
  const byGsis = new Map(players.map((p) => [p.gsis_id, p]));
  const byPfr = new Map(players.filter((p) => p.pfr_id && p.pfr_id !== 'NA').map((p) => [p.pfr_id, p]));
  // (each team's logo name, from the site's own rows: "BAL" -> "Ravens")
  const site = JSON.parse(readFileSync(path.join(DATA, 'skill-players.json'), 'utf8'));
  const logoOf = new Map(site.DEF.map((u) => [u.gsisId.slice(4), u.teamLogo.split('/').pop().replace('.png', '')]));
  // (the season began with its first regular-season game: the depth chart then is week 1's)
  const firstGame = schedule.filter((g) => g.season === String(SEASON) && g.game_type === 'REG').map((g) => g.gameday).sort()[0];

  mkdirSync(OUT, { recursive: true });
  const teams = [...new Set(depthRows.map((r) => r.team))].sort();
  let written = 0;
  for (const team of teams) {
    const logo = logoOf.get(team);
    if (!logo) continue;
    const rows = depthRows.filter((r) => r.team === team);
    const stamps = [...new Set(rows.map((r) => r.dt))].sort();
    const latest = stamps.at(-1);
    const weekOne = stamps.filter((dt) => dt.slice(0, 10) <= firstGame).at(-1) ?? stamps[0];

    // ---- the chart now: each slot, its players by depth
    const slotsAt = (dt) => {
      const slots = new Map();
      for (const r of rows.filter((x) => x.dt === dt)) {
        const side = SIDE(r.pos_grp);
        if (side === 'special' && !SPECIAL.has(r.pos_abb)) continue;
        const key = `${r.pos_abb}${r.pos_slot}`;
        if (!slots.has(key)) slots.set(key, { side, key, abb: r.pos_abb, slot: Number(r.pos_slot), name: r.pos_name, group: r.pos_grp, depth: [] });
        slots.get(key).depth[Number(r.pos_rank) - 1] = r.gsis_id || `espn:${r.espn_id}` || r.player_name;
      }
      for (const s of slots.values()) s.depth = s.depth.filter(Boolean);
      return slots;
    };
    const now = slotsAt(latest);
    const then = slotsAt(weekOne);
    const front = [...now.values()].find((s) => s.side === 'defense')?.group.replace(/^Base\s+|\s*D$/g, '') ?? null;

    // ---- everyone: on the chart, or with a snap this season
    const people = new Map();
    const person = (id, fallback) => {
      if (!people.has(id)) {
        const p = byGsis.get(id);
        people.set(id, {
          name: p?.display_name ?? fallback?.name ?? id,
          espnId: p?.espn_id && p.espn_id !== 'NA' ? p.espn_id : (fallback?.espnId ?? null),
          headshot: p?.headshot && p.headshot !== 'NA' ? p.headshot : null,
          pos: fallback?.pos ?? p?.position ?? null,
          unit: null,
          off: 0,
          def: 0,
          st: 0,
          games: 0,
          chart: null,
          status: null,
          injury: null,
          note: null,
        });
      }
      return people.get(id);
    };
    const nameOf = new Map(rows.filter((r) => r.dt === latest).map((r) => [r.gsis_id || `espn:${r.espn_id}` || r.player_name, { name: r.player_name, espnId: r.espn_id || null }]));
    for (const s of now.values()) {
      s.depth.forEach((id, i) => {
        const p = person(id, nameOf.get(id));
        // (the slot a player is listed at, his highest place on the chart)
        if (!p.chart || i === 0) p.chart = { key: s.key, depth: i + 1 };
        p.unit ??= SLOT_UNIT[s.abb] ?? null;
      });
    }
    // (snaps: each game's share, averaged over the games he played)
    const games = new Set();
    const usage = new Map();
    for (const r of snaps.filter((x) => x.team === team && x.game_type === 'REG')) {
      games.add(r.game_id);
      const gsis = byPfr.get(r.pfr_player_id)?.gsis_id;
      const id = gsis || `pfr:${r.pfr_player_id}`;
      const u = usage.get(id) ?? { name: r.player, pos: r.position, off: 0, def: 0, st: 0, games: 0 };
      u.off += num(r.offense_pct) ?? 0;
      u.def += num(r.defense_pct) ?? 0;
      u.st += num(r.st_pct) ?? 0;
      u.games++;
      usage.set(id, u);
    }
    for (const [id, u] of usage) {
      const p = person(id, { name: u.name, pos: u.pos });
      p.off = round(u.off / u.games);
      p.def = round(u.def / u.games);
      p.st = round(u.st / u.games);
      p.games = u.games;
      p.pos = u.pos ?? p.pos;
      p.unit = UNIT[u.pos] ?? p.unit;
    }
    // (the injury report, by name)
    for (const i of injuries.get(team) ?? []) {
      const hit = [...people.values()].find((p) => p.name === i.name);
      if (hit) Object.assign(hit, { status: i.status, injury: i.injury, note: i.news });
    }

    // ---- the starters who've changed since week 1
    const changes = [];
    for (const [key, s] of now) {
      const was = then.get(key)?.depth[0];
      if (was && s.depth[0] && was !== s.depth[0]) {
        person(was, nameOf.get(was) ?? { name: byGsis.get(was)?.display_name });
        changes.push({ side: s.side, key, name: s.name, from: was, to: s.depth[0] });
      }
    }

    const out = {
      team,
      logo,
      season: SEASON,
      at: latest,
      weekOne,
      teamGames: games.size,
      front,
      slots: [...now.values()].sort((a, b) => a.slot - b.slot).map(({ side, key, abb, name, depth }) => ({ side, key, abb, name, depth })),
      players: Object.fromEntries(people),
      changes,
    };
    writeFileSync(path.join(OUT, `${logo}.json`), JSON.stringify(out));
    written++;
  }
  console.log(`depth charts: ${written} teams (${depthRows.length ? 'as of ' + depthRows.map((r) => r.dt).sort().at(-1).slice(0, 10) : 'no data'})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
