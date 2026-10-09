// A sport's yearly rollover: the finished season becomes a past season and the new one current.
//
//   node scripts/rollover.mjs <nfl|mlb|nba|nhl>            roll over now
//   node scripts/rollover.mjs <nfl|mlb|nba|nhl> --if-due   only once the new season has begun
//   node scripts/rollover.mjs <nfl|mlb|nba|nhl> --dry-run  what a rollover would change, changing nothing
//
// Due: yesterday's ESPN scoreboard is a newer season than the app's current one, in its regular
// season or later, with a game finished (so the new season never starts out empty). The nightly
// update workflows run it with --if-due before the night's update, so a new season starts on its own.
//
// The steps, in this order (the data scripts decide "past or current" by the current season, so the
// bump comes first, and MLB, NBA and NHL's early-season grades read the archived season):
//   1. bump the current season in apps/<sport>/scripts/update-data.mjs and apps/<sport>/src/sport/sport.ts
//      (currentSeason, and currentSeasonEnds a year on)
//   2. archive the finished season: SEASON=<finished> node apps/<sport>/scripts/update-data.mjs
//   3. similar seasons and careers with it: node apps/<sport>/scripts/build-comps.mjs (needs the
//      packages: npm ci first if they aren't installed)
// The new season's own data is the night's normal update (the workflow's next step, or
// node apps/<sport>/scripts/update-data.mjs).
//
// Still by hand afterwards: the NFL's preseason team grades and QB scores (team-grades.json,
// subjective.json) for the new season, its awards and honors (awards.ts, update-honors.mjs), MLB's
// World Series result (WORLD_SERIES in awards.ts), and any new team logos (logo-eras.ts).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ESPN = {
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
};

const [sport, flag] = process.argv.slice(2);
if (!ESPN[sport])
  throw new Error(
    "Usage: node scripts/rollover.mjs <nfl|mlb|nba|nhl> [--if-due | --dry-run]",
  );
const scriptFile = path.join(ROOT, "apps", sport, "scripts", "update-data.mjs");
const sportFile = path.join(ROOT, "apps", sport, "src", "sport", "sport.ts");
const current = Number(
  readFileSync(scriptFile, "utf8").match(
    /^const CURRENT_SEASON = (\d+);/m,
  )?.[1],
);
if (!current) throw new Error(`No CURRENT_SEASON in ${scriptFile}`);

// The season ESPN says has begun (yesterday's games), or null
async function begunSeason() {
  const yesterday = new Date(Date.now() - 864e5)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  // (ESPN down or slow: not due tonight, rather than the night's update stopped; the next run asks again)
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${ESPN[sport]}/scoreboard?dates=${yesterday}`,
    { signal: AbortSignal.timeout(30e3) },
  ).catch(() => null);
  const board = res?.ok ? await res.json().catch(() => null) : null;
  if (!board) {
    console.warn(`ESPN scoreboard unavailable (${res?.status ?? "no answer"}): no rollover check this run`);
    return null;
  }
  const season = board.leagues?.[0]?.season;
  const finished = (board.events ?? []).some((e) => e.status?.type?.completed);
  return season && season.type?.type >= 2 && finished ? season.year : null;
}

// (no process.exit after a fetch: Node on Windows trips over it; the script just ends instead)
async function main() {
  let next = current + 1;
  if (flag === "--if-due") {
    const begun = await begunSeason();
    if (!begun || begun <= current) {
      console.log(
        `${sport.toUpperCase()}: ${current} is still current (no rollover due)`,
      );
      return;
    }
    next = begun;
  }
  const dry = flag === "--dry-run";
  console.log(
    `${sport.toUpperCase()}: ${dry ? "would roll" : "rolling"} over ${current} -> ${next}`,
  );

  // 1. The bump
  const years = next - current;
  const edit = (file, pairs) => {
    let text = readFileSync(file, "utf8");
    for (const [pattern, replace] of pairs) {
      if (!pattern.test(text))
        throw new Error(`${path.basename(file)}: no match for ${pattern}`);
      text = text.replace(pattern, replace);
    }
    if (dry) {
      const lines = text
        .split("\n")
        .filter((l) =>
          /CURRENT_SEASON = |currentSeason: |currentSeasonEnds: /.test(l),
        );
      console.log(
        `  ${path.relative(ROOT, file)}: ${lines.map((l) => l.trim()).join("  ")}`,
      );
    } else writeFileSync(file, text);
  };
  edit(scriptFile, [
    [/^const CURRENT_SEASON = \d+;/m, `const CURRENT_SEASON = ${next};`],
  ]);
  edit(sportFile, [
    [/currentSeason: \d+,/, `currentSeason: ${next},`],
    [
      /currentSeasonEnds: '(\d{4})(-\d\d-\d\d)',/,
      (_, year, rest) => `currentSeasonEnds: '${Number(year) + years}${rest}',`,
    ],
  ]);

  const run = (args, env = {}) => {
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    if (result.status !== 0)
      throw new Error(`${args.join(" ")} failed (${result.status})`);
  };

  if (dry) {
    console.log(
      `  then: SEASON=${current} node apps/${sport}/scripts/update-data.mjs, its season builders for ${current} (depth, coaches, game logs: the ones it has), node apps/${sport}/scripts/build-comps.mjs`,
    );
    return;
  }

  // 2. The finished season, archived
  run([scriptFile], { SEASON: String(current) });

  // (the finished season's other files, by the sport's builders that keep one per season: the NFL's depth
  // charts and staffs, the NBA's and MLB's staffs, the NHL's game logs)
  for (const builder of ["build-depth.mjs", "build-coaches.mjs", "backfill-game-logs.mjs"]) {
    const file = path.join(ROOT, "apps", sport, "scripts", builder);
    if (existsSync(file)) run([file, String(current)]);
  }

  // 3. Similar seasons and careers (esbuild: the packages)
  if (!existsSync(path.join(ROOT, "node_modules", "esbuild"))) {
    const install = spawnSync("npm", ["ci"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    if (install.status !== 0) throw new Error("npm ci failed");
  }
  run([path.join(ROOT, "apps", sport, "scripts", "build-comps.mjs")]);

  console.log(
    `${sport.toUpperCase()}: ${current} archived, ${next} current. Next: the night's update (node apps/${sport}/scripts/update-data.mjs).` +
      (sport === "nfl"
        ? " By hand: the new preseason grades (team-grades.json, subjective.json), awards and honors."
        : "") +
      (sport === "mlb"
        ? " By hand: last season's World Series in awards.ts."
        : "") +
      " Check logo-eras.ts for new team logos.",
  );
}

await main();
