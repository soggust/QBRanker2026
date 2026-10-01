// `npm run dev`: every sport at once, all on one port, http://localhost:4200 (/nfl/, /mlb/, /nba/,
// /nhl/; a bare localhost:4200/ goes to the first sport in sports.json, like the live site), so the
// sport bar works like it does live and any number of sports can be open side by side. Each app is
// built in watch mode (a development build, into dist/dev/<sport>) and this one small server serves them
// all: no other ports are opened. A page reloads itself when its app finishes rebuilding. Ctrl+C stops
// everything. (PORT=4300 npm run dev if 4200 is taken.)
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, 'dist/dev');
const sports = JSON.parse(readFileSync(path.join(ROOT, 'sports.json'), 'utf8'));
const port = Number(process.env.PORT ?? 4200);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Live reload: each page listens on /__reload and reloads when its own app rebuilds
const listeners = new Set();
const RELOAD = `<script>new EventSource('/__reload').onmessage = (e) => location.pathname.startsWith('/' + e.data + '/') && location.reload();</script>`;

// Every app, building and rebuilding on each change
const builds = sports.map(({ id }) => {
  const child = spawn('npx', ['ng', 'build', id, '--watch', '--configuration', 'development', '--output-path', `dist/dev/${id}`], {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${id}] `;
  const relay = (out) => (chunk) => {
    const text = chunk.toString();
    out.write(text.replace(/^(?=.)/gm, tag));
    // (a finished build, first or a rebuild: tell its open pages)
    if (/Build at:/.test(text)) {
      console.log(`${tag}ready: http://localhost:${port}/${id}/`);
      for (const res of listeners) res.write(`data: ${id}\n\n`);
    }
  };
  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));
  child.on('exit', (code) => console.log(`${tag}stopped (${code})`));
  return child;
});

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(302, { Location: `/${sports[0].id}/${url.search}` });
    return res.end();
  }
  const [, id, ...rest] = url.pathname.split('/');
  if (!sports.some((s) => s.id === id)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  if (!rest.length) {
    res.writeHead(301, { Location: `/${id}/${url.search}` });
    return res.end();
  }
  const dir = path.join(OUT, id);
  let file = path.join(dir, decodeURIComponent(rest.join('/')));
  // (an app's own routes, and its root: its index.html)
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dir, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<p style="font: 16px sans-serif">${id.toUpperCase()} is still building... this page reloads when it's ready.</p>${RELOAD}`);
  }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  if (file.endsWith('index.html')) return res.end(readFileSync(file, 'utf8').replace('</body>', `${RELOAD}</body>`));
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`Building ${sports.map((s) => s.label).join(', ')}... then all at http://localhost:${port}/ (${sports.map((s) => `/${s.id}/`).join(', ')})`);
});

// (on Windows the build runs under a shell: end its whole process tree, not just the shell)
const stop = () => {
  for (const child of builds) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
