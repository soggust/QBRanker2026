// `npm run dev`: the first sport's dev server (sports.json, on 4200) is the front door. It passes every
// other sport's path through to that sport's own dev server, and sends a bare localhost:4200/ to the
// first sport like the live site's redirect (firebase.json). Each app keeps its own live reload.
import { readFileSync } from 'node:fs';

const [front, ...others] = JSON.parse(readFileSync(new URL('./sports.json', import.meta.url), 'utf8'));

export default [
  ...others.map(({ id, devPort }) => ({
    context: [`/${id}`],
    target: `http://localhost:${devPort}`,
    secure: false,
    changeOrigin: true,
  })),
  {
    // Only the site root: answer with a redirect instead of proxying anywhere
    context: (path) => path === '/',
    target: `http://localhost:${front.devPort}`,
    onProxyReq: (proxyReq, _req, res) => {
      proxyReq.destroy();
      res.writeHead(302, { Location: `/${front.id}/` });
      res.end();
    },
    onError: () => {},
  },
];
