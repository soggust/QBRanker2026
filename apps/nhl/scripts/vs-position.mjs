// Defense vs position, the NHL's: what each team allowed to opposing forwards and defensemen a game
// (goals, points, shots), and against those players' own averages in their other games, so holding a
// top line to its usual output reads as average and holding it under as good defense; and the share of
// the points against it that came from defensemen beside the league's. Built from the season's game logs
// (game-logs/<season>/: every listed skater's games, each with its opponent), so every season with logs
// has it (2009 on). update-data.mjs adds it to each head coach row (vsPos: a team's coaches carry the
// same), the Teams tab's rows take it from them and the team card shows it (src/sport/vs-position.ts).
// Run on its own, this file adds it to seasons already written:
//
//   node apps/nhl/scripts/vs-position.mjs            (every season with logs)
//   node apps/nhl/scripts/vs-position.mjs 2024 2025  (just those)
//
// Display only: nothing in the ranking reads it. Skaters the site doesn't list (a few games' call-ups)
// have no log, so their points aren't counted.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLogFiles } from './game-log-files.mjs';

export const NHL_ROLES = ['F', 'D'];
const GROUP_OF = { C: 'F', LW: 'F', RW: 'F', F: 'F', D: 'D' };
// (a skater's log line: date, "@ TOR", result, goals, assists, points, +/-, shots, PIM, TOI)
const G = 3;
const A = 4;
const P = 5;
const SOG = 7;
const r2 = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r3 = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const numberOf = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// A row's team: its logo's file name ("assets/NHL_Icons/DET.svg", or an older era's "ATL_19992000-...")
export const rowTeam = (row) => row.teamLogo?.split('/').pop().replace(/\.\w+$/, '').split('_')[0] ?? null;

// The season's logs ({ id: lines, newest first }), each player's playoff games (the newest of his log),
// each skater's position (id -> C, LW, RW or D) and the part: team -> its vsPos
export function nhlVsPosition({ logs, playoffs = {}, positionOf, part = 'regular' }) {
  const inPart = (playoff) => part === 'all' || (part === 'post') === playoff;
  // (a player's average: the regular season's own games, or the whole season's)
  const inBase = (playoff) => part !== 'regular' || !playoff;
  const lines = [];
  for (const [id, rows] of Object.entries(logs)) {
    const group = GROUP_OF[positionOf.get(String(id))];
    if (!group) continue;
    const post = playoffs[id] ?? 0;
    rows.forEach((row, i) => {
      const opp = String(row[1] ?? '').split(' ').pop();
      if (!opp) return;
      lines.push({ id, group, opp, date: row[0], playoff: i < post, goals: numberOf(row[G]), assists: numberOf(row[A]), pts: numberOf(row[P]), shots: numberOf(row[SOG]) });
    });
  }
  const own = new Map();
  for (const l of lines) {
    if (!inBase(l.playoff)) continue;
    const s = own.get(l.id) ?? { games: 0, pts: 0 };
    s.games++;
    s.pts += l.pts;
    own.set(l.id, s);
  }
  // (the league's average a game for the group: the stand-in for a player with no other game)
  const leagueAvg = {};
  for (const role of NHL_ROLES) {
    const list = lines.filter((l) => l.group === role && inPart(l.playoff));
    leagueAvg[role] = list.length ? list.reduce((a, l) => a + l.pts, 0) / list.length : 0;
  }
  const teams = new Map();
  for (const l of lines) {
    if (!inPart(l.playoff)) continue;
    let t = teams.get(l.opp);
    if (!t) teams.set(l.opp, (t = { games: new Set(), F: { goals: 0, pts: 0, shots: 0, exp: 0 }, D: { goals: 0, pts: 0, shots: 0, exp: 0 } }));
    t.games.add(`${l.date}|${l.playoff}`);
    const s = own.get(l.id);
    const exp = s && s.games > 1 ? (s.pts - (inBase(l.playoff) ? l.pts : 0)) / (s.games - (inBase(l.playoff) ? 1 : 0)) : leagueAvg[l.group];
    const g = t[l.group];
    g.goals += l.goals;
    g.pts += l.pts;
    g.shots += l.shots;
    g.exp += exp;
  }
  const leaguePts = { F: 0, D: 0 };
  for (const t of teams.values()) for (const role of NHL_ROLES) leaguePts[role] += t[role].pts;
  const leagueShare = leaguePts.F + leaguePts.D ? leaguePts.D / (leaguePts.F + leaguePts.D) : null;
  const out = new Map();
  for (const [team, t] of teams) {
    const games = t.games.size;
    const block = { games };
    for (const role of NHL_ROLES) {
      const g = t[role];
      block[role] = {
        goals: r2(g.goals / games),
        pts: r2(g.pts / games),
        shots: r2(g.shots / games),
        exp: r2(g.exp / games),
        vs: r2((g.pts - g.exp) / games),
        rank: null,
      };
    }
    const total = t.F.pts + t.D.pts;
    block.share = { D: total ? r3(t.D.pts / total) : null, lg: r3(leagueShare) };
    out.set(team, block);
  }
  // Ranks: the least allowed over expected first (equal values share a rank)
  for (const role of NHL_ROLES) {
    const values = [...out.values()].map((b) => b[role].vs).filter((v) => v !== null);
    for (const b of out.values()) if (b[role].vs !== null) b[role].rank = 1 + values.filter((v) => v < b[role].vs).length;
  }
  return out;
}

// Each listed skater's position, from a season's rows
export function positionsOf(rows) {
  const positions = new Map();
  for (const tab of ['C', 'LW', 'RW', 'D']) for (const row of rows[tab] ?? []) if (row.id) positions.set(String(row.id), tab);
  return positions;
}

// A season's parts (its rows written) given their vsPos on every head coach row, from its logs
export function addVsPosition(dataDir, logsRoot, season, parts = ['regular', 'post', 'all']) {
  const { logs, playoffs } = readLogFiles(logsRoot, season);
  if (!Object.keys(logs).length) return [];
  const done = [];
  // (positions from the regular season's rows, with the part's own: everyone who played the playoffs is in either)
  const regularFile = path.join(dataDir, 'skill-players.json');
  const regularPositions = existsSync(regularFile) ? positionsOf(JSON.parse(readFileSync(regularFile, 'utf8'))) : new Map();
  for (const part of parts) {
    const file = path.join(dataDir, part === 'regular' ? 'skill-players.json' : `skill-players.${part}.json`);
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const vs = nhlVsPosition({ logs, playoffs, positionOf: new Map([...positionsOf(data), ...regularPositions]), part });
    for (const row of data.HC ?? []) row.vsPos = vs.get(rowTeam(row)) ?? null;
    writeFileSync(file, JSON.stringify(data));
    done.push(part);
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const STATIC = path.resolve(import.meta.dirname, '../src/StaticData');
  const logsRoot = path.join(STATIC, 'game-logs');
  const current = Math.max(...readdirSync(logsRoot).map(Number).filter(Boolean));
  const args = process.argv.slice(2).map(Number).filter(Boolean);
  const seasons = args.length ? args : readdirSync(logsRoot).map(Number).filter(Boolean);
  for (const season of seasons) {
    const dir = season === current ? STATIC : path.join(STATIC, 'seasons', String(season));
    const done = addVsPosition(dir, logsRoot, season);
    console.log(`${season}: vsPos ${done.length ? `added (${done.join(', ')})` : 'not added (no logs or rows)'}`);
  }
}
