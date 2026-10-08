// The careers files (the card's Seasons tab and Rookies Only), written by build-comps.mjs: a file per tab,
// careers/<tab>.json ({ id: [[season, team, games, rank, of, headline stats], ...] }), so a card loads only
// its tab's, and careers/first-seasons.json ({ id: the first season anyone with that id is in }).
import fs from 'node:fs';
import path from 'node:path';

export function writeCareers(staticDir, careers) {
  const dir = path.join(staticDir, 'careers');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const first = {};
  for (const [tab, byId] of Object.entries(careers)) {
    fs.writeFileSync(path.join(dir, `${tab}.json`), JSON.stringify(byId));
    for (const [id, seasons] of Object.entries(byId)) {
      for (const [season] of seasons) first[id] = Math.min(season, first[id] ?? Infinity);
    }
  }
  fs.writeFileSync(path.join(dir, 'first-seasons.json'), JSON.stringify(first));
  // (the one-file layout these replaced)
  fs.rmSync(path.join(staticDir, 'careers.json'), { force: true });
}
