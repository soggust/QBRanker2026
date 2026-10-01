// Scaffolds a new sport: `npm run new-sport -- nhl NHL`
//
// Copies the NBA app (apps/nba) to apps/<id> as a working starting point (it builds and runs, still
// showing basketball until you replace it), and wires it in everywhere a sport is listed:
//   - sports.json          the sport bar and `npm run dev`
//   - angular.json         its project (built to dist/site/<id>, served at /<id>/)
//   - package.json         `npm run build` builds it; start:<id>, <id>:update-data, <id>:build-comps
//   - firebase.json        /<id>/ serves it
//   - .github/workflows    <id>-update-data.yml, manual-only until its data script is real
// Then follow libs/ranker/README.md ("Adding a sport") to make it the sport.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const [id, label = id?.toUpperCase()] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9]*$/.test(id)) {
  console.error('Usage: npm run new-sport -- <id> [LABEL]   (e.g. nhl NHL; the id is the URL path)');
  process.exit(1);
}
const at = (f) => path.join(ROOT, f);
if (existsSync(at(`apps/${id}`))) {
  console.error(`apps/${id} already exists`);
  process.exit(1);
}
const json = (f) => JSON.parse(readFileSync(at(f), 'utf8'));
const save = (f, data) => writeFileSync(at(f), JSON.stringify(data, null, 2) + '\n');
const edit = (f, fn) => writeFileSync(at(f), fn(readFileSync(at(f), 'utf8')));
const FROM = 'nba';

// The app: everything but the finished seasons' data
cpSync(at(`apps/${FROM}`), at(`apps/${id}`), {
  recursive: true,
  filter: (src) => !src.split(path.sep).join('/').includes('/StaticData/seasons'),
});
edit(`apps/${id}/src/sport/sport.ts`, (s) =>
  s
    .replace(`id: '${FROM}',`, `id: '${id}',`)
    .replace(`appName: 'NBA Ranker',`, `appName: '${label} Ranker',`)
    .replace('// NBA: what the engine needs to know about basketball', `// ${label} (scaffolded from the NBA app: replace the basketball): what the engine needs to know`),
);
edit(`apps/${id}/src/index.html`, (s) => s.replace('<title>NBA Ranker</title>', `<title>${label} Ranker</title>`));
edit(`apps/${id}/tsconfig.json`, (s) => s.replace(/\/\* The [A-Z]+ app:/, `/* The ${label} app:`));
for (const f of ['scripts/update-data.mjs', 'scripts/build-comps.mjs']) {
  edit(`apps/${id}/${f}`, (s) => s.split(`npm run ${FROM}:`).join(`npm run ${id}:`));
}

// sports.json: the sport bar and `npm run dev`
const sports = json('sports.json');
sports.push({ id, label });
writeFileSync(at('sports.json'), '[\n' + sports.map((s) => '  ' + JSON.stringify(s).replace(/,"/g, ', "').replace(/":/g, '": ').replace('{', '{ ').replace(/}$/, ' }')).join(',\n') + '\n]\n');

// angular.json: a project like the NBA app's, pointed at apps/<id>
const angular = json('angular.json');
angular.projects[id] = JSON.parse(
  JSON.stringify(angular.projects[FROM])
    .split(`apps/${FROM}`).join(`apps/${id}`)
    .split(`dist/site/${FROM}`).join(`dist/site/${id}`)
    .split(`${FROM}:build`).join(`${id}:build`)
    .split(`/${FROM}/`).join(`/${id}/`),
);
save('angular.json', angular);

// package.json: built with the rest; its own start and data scripts
const pkg = json('package.json');
pkg.scripts.build += ` && ng build ${id}`;
Object.assign(pkg.scripts, {
  [`start:${id}`]: `ng serve ${id}`,
  [`${id}:update-data`]: `node apps/${id}/scripts/update-data.mjs`,
  [`${id}:build-comps`]: `node apps/${id}/scripts/build-comps.mjs`,
});
save('package.json', pkg);

// firebase.json: serve it at /<id>/
const firebase = json('firebase.json');
firebase.hosting.rewrites.push({ source: `/${id}`, destination: `/${id}/index.html` }, { source: `/${id}/**`, destination: `/${id}/index.html` });
firebase.hosting.headers.push({ source: `/${id}/`, headers: [{ key: 'Cache-Control', value: 'no-cache' }] });
save('firebase.json', firebase);

// The nightly data workflow, manual-only until the data script pulls this sport
const workflow = readFileSync(at(`.github/workflows/${FROM}-update-data.yml`), 'utf8')
  .replace('name: NBA - Update Game Data', `name: ${label} - Update Game Data`)
  .replace(/  schedule:\n[\s\S]*?(  workflow_dispatch:)/, `  # (manual only for now: add a schedule once apps/${id}/scripts/update-data.mjs pulls ${label} data,\n  # like the other sports' workflows)\n$1`)
  .split(`${FROM}:update-data`).join(`${id}:update-data`)
  .split(`apps/${FROM}/src/StaticData`).join(`apps/${id}/src/StaticData`)
  .replace('Update NBA data', `Update ${label} data`)
  .replace('Pull stats from Basketball-Reference and ESPN', `Pull ${label} stats`);
writeFileSync(at(`.github/workflows/${id}-update-data.yml`), workflow);

console.log(`apps/${id} is ready (a copy of the NBA app, served at /${id}/ and in the sport bar).`);
console.log(`Next: libs/ranker/README.md, "Adding a sport". Try it: npx ng build ${id}, or npm run dev.`);
