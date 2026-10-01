// `npm run dev`: every app's dev server at once, all under http://localhost:4200 so the sport bar's
// links work like on the live site. The first sport in sports.json is the front door on 4200 and passes
// the others' paths through to their own dev servers (their devPort; proxy.dev.mjs, which also sends a
// bare localhost:4200/ to the first sport, like the live site). Each keeps its own live reload. Ctrl+C
// stops them all.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sports = JSON.parse(readFileSync(new URL('./sports.json', import.meta.url), 'utf8'));
const [front, ...others] = sports;

// (PORT=4300 npm run dev if 4200 is taken)
const port = process.env.PORT ?? String(front.devPort);

const servers = [
  ...others.map(({ id, devPort }) => [id, ['ng', 'serve', id, '--port', String(devPort), '--public-host', `localhost:${devPort}`]]),
  [front.id, ['ng', 'serve', front.id, '--port', port, '--proxy-config', 'proxy.dev.mjs']],
];

const children = servers.map(([name, args]) => {
  const child = spawn('npx', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${name}] `;
  const relay = (out) => (chunk) => out.write(chunk.toString().replace(/^(?=.)/gm, tag));
  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));
  child.on('exit', (code) => console.log(`${tag}stopped (${code})`));
  return child;
});

console.log(`Starting... ${sports.map(({ id, label }) => `${label} at http://localhost:${port}/${id}/`).join(', ')}`);

const stop = () => {
  for (const child of children) child.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
