// The spray chart's parks (the game view, libs/ranker/src/engine/game-view/parks.ts): each current park's
// outfield wall, infield and foul lines as MLB's Gameday diagrams draw them, in the same units as the
// batted balls (home plate near 125, 204), from Ben Dilday's GeomMLBStadiums (github.com/bdilday/
// GeomMLBStadiums, MIT). Written to StaticData/parks.json, a team's outlines as SVG paths. Free; run when a
// park changes.
//
//   node apps/mlb/scripts/build-parks.mjs

import { writeFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/bdilday/GeomMLBStadiums/master/inst/extdata/mlb_stadia_paths.csv';
const OUT = path.resolve(import.meta.dirname, '../src/StaticData/parks.json');

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`stadium paths: ${res.status}`);
const rows = (await res.text())
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.replace(/"/g, '').split(','))
  .map(([team, x, y, segment]) => ({ team, x: Number(x), y: Number(y), segment }));

// A segment's points as a path (to a tenth of a unit: a few inches)
const pathOf = (points, close) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');

const teams = {};
for (const team of [...new Set(rows.map((r) => r.team))]) {
  const of = (segment) => rows.filter((r) => r.team === team && r.segment === segment);
  const wall = of('outfield_outer');
  const infield = of('infield_outer');
  const fouls = of('foul_lines');
  if (!wall.length) continue;
  teams[team] = {
    wall: pathOf(wall, false),
    infield: infield.length ? pathOf(infield, true) : null,
    // (the foul lines: home plate out to each pole, the wall's two ends)
    fouls: fouls.length ? pathOf(fouls, false) : null,
  };
}
writeFileSync(OUT, JSON.stringify({ source: 'GeomMLBStadiums (MIT)', teams }));
console.log(`${Object.keys(teams).length} parks`);
