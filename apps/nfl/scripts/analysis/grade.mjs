// Grades the bet ledger's picks after their games (ledger.mjs): each pick's own bet (grade: what settles
// it) against the final score or the box score, from nflverse. Free: no AI. Run before each bet desk so it
// sees its updated record; a game whose stats aren't out yet waits for the next run.
//
//   node apps/nfl/scripts/analysis/grade.mjs

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { readLedger, record, writeLedger } from './ledger.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const CACHE = path.join(ROOT, '.cache/nflverse');
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
// (fresh enough: the dossiers download these too)
const FRESH_HOURS = 3;

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

// A name for matching: lower case, no punctuation or suffix ("A.J. Brown Jr." -> "aj brown")
const nameKey = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
    .trim();

// A value against a line, from the bettor's side
function settle(value, direction, line) {
  if (value === null || line === null || !direction) return null;
  if (value === line) return 'push';
  return (direction === 'over') === value > line ? 'win' : 'loss';
}

async function main() {
  const ledger = readLedger();
  if (!ledger.season) {
    console.log('nothing in the ledger yet');
    return;
  }
  const season = ledger.season;
  const [schedule, players, teams] = await Promise.all([
    download('games.csv', SCHEDULE_URL).then(readCsv),
    download(`stats_player_week_${season}.csv.gz`, `${NFLVERSE}/stats_player/stats_player_week_${season}.csv.gz`).then(readCsv),
    download(`stats_team_week_${season}.csv.gz`, `${NFLVERSE}/stats_team/stats_team_week_${season}.csv.gz`).then(readCsv),
  ]);
  const gameOf = new Map(schedule.filter((g) => g.season === String(season)).map((g) => [`${g.week}|${g.away_team} @ ${g.home_team}`, g]));

  let graded = 0;
  let waiting = 0;
  for (const [week, games] of Object.entries(ledger.weeks)) {
    for (const [matchup, game] of Object.entries(games)) {
      const open = game.picks.filter((p) => p.result === null);
      if (!open.length) continue;
      const g = gameOf.get(`${week}|${matchup}`);
      const home = num(g?.home_score);
      const away = num(g?.away_score);
      if (home === null || away === null) {
        waiting += open.length;
        continue;
      }
      const points = { [g.home_team]: home, [g.away_team]: away };
      const opp = (team) => (team === g.home_team ? g.away_team : g.home_team);
      const box = players.filter((r) => r.game_id === g.game_id);
      const teamBox = (team) => teams.find((r) => r.game_id === g.game_id && r.team === team);
      for (const p of open) {
        const { kind, team, player, stat, direction, line } = p.grade ?? {};
        let actual = null;
        let result = null;
        if (kind === 'spread' && team in points) {
          actual = points[team] - points[opp(team)];
          result = actual + line === 0 ? 'push' : actual + line > 0 ? 'win' : 'loss';
        } else if (kind === 'moneyline' && team in points) {
          actual = points[team] - points[opp(team)];
          result = actual === 0 ? 'push' : actual > 0 ? 'win' : 'loss';
        } else if (kind === 'total') {
          actual = home + away;
          result = settle(actual, direction, line);
        } else if (kind === 'team_total' && team in points) {
          actual = points[team];
          result = settle(actual, direction, line);
        } else if (kind === 'team_stat' && stat) {
          const row = teamBox(team);
          if (!row) {
            waiting++;
            continue;
          }
          actual = num(row[stat]) ?? 0;
          result = settle(actual, direction, line);
        } else if (kind === 'player' && stat) {
          // (the box score not out yet: wait; out, and he's not in it: he didn't play, so no bet)
          if (!box.length) {
            waiting++;
            continue;
          }
          const key = nameKey(player);
          const last = key.split(' ').at(-1);
          const row =
            box.find((r) => nameKey(r.player_display_name) === key) ??
            box.find((r) => r.team === team && nameKey(r.player_display_name).split(' ').at(-1) === last);
          if (!row) result = 'void';
          else {
            actual = num(row[stat]) ?? 0;
            result = settle(actual, direction, line);
          }
        }
        if (!result) {
          // (a pick the grader can't read stays open, and says so)
          console.log(`  can't grade week ${week} ${matchup}: "${p.bet}" ${JSON.stringify(p.grade)}`);
          continue;
        }
        Object.assign(p, { result, actual });
        graded++;
      }
    }
  }
  ledger.record = record(ledger);
  writeLedger(ledger);
  const r = ledger.record;
  const line = (t) => `${t.wins}-${t.losses}${t.pushes ? `-${t.pushes}` : ''}`;
  console.log(
    `graded ${graded} picks (${waiting} waiting on their games); record ${line(r.overall)}: high ${line(r.byLevel.high)}, medium ${line(r.byLevel.medium)}, low ${line(r.byLevel.low)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
