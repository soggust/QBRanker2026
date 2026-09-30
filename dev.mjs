// `npm run dev`: every app's dev server at once, all under http://localhost:4200 so the sport bar's
// links work like on the live site. The NFL server is the front door on 4200 and passes /mlb/ and /nba/
// through to the MLB server on 4201 and the NBA server on 4202 (proxy.dev.json); each keeps its own live reload. Ctrl+C stops them all.
import { spawn } from 'node:child_process';

// (PORT=4300 npm run dev if 4200 is taken)
const port = process.env.PORT ?? '4200';

const servers = [
  ['mlb', ['ng', 'serve', 'mlb', '--port', '4201', '--public-host', 'localhost:4201']],
  ['nba', ['ng', 'serve', 'nba', '--port', '4202', '--public-host', 'localhost:4202']],
  ['nfl', ['ng', 'serve', 'nfl', '--port', port, '--proxy-config', 'proxy.dev.json']],
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

console.log(`Starting... NFL at http://localhost:${port}/nfl/ , MLB at http://localhost:${port}/mlb/ and NBA at http://localhost:${port}/nba/`);

const stop = () => {
  for (const child of children) child.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
