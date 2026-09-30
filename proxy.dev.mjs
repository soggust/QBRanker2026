// `npm run dev`: the NFL dev server (4200) is the front door. It passes /mlb/ and /nba/ through to
// their own dev servers (4201, 4202), and sends a bare localhost:4200/ to /nfl/ like the live site's
// redirect (firebase.json). Each app keeps its own live reload.
export default [
  { context: ['/mlb'], target: 'http://localhost:4201', secure: false, changeOrigin: true },
  { context: ['/nba'], target: 'http://localhost:4202', secure: false, changeOrigin: true },
  {
    // Only the site root: answer with a redirect instead of proxying anywhere
    context: (path) => path === '/',
    target: 'http://localhost:4200',
    onProxyReq: (proxyReq, _req, res) => {
      proxyReq.destroy();
      res.writeHead(302, { Location: '/nfl/' });
      res.end();
    },
    onError: () => {},
  },
];
