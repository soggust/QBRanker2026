# NFL Ranker

Rank players your way: every stat is normalized to the same scale, then your sliders decide what
matters. Live at https://qbranker2026.web.app/nfl/ (the bare address redirects there).

## Layout

The repo is set up to hold one app per sport, side by side, sharing the Angular workspace, the npm
dependencies and the TypeScript settings.

```
apps/
  nfl/                  the NFL app
    src/                app code, styles, assets, and StaticData/ (the season data it serves)
    scripts/            data scripts (nightly update, honors, similar seasons, run blocking)
    tsconfig.json       imports resolve from src/ (app/..., StaticData/...)
    tsconfig.app.json   build config
    tsconfig.spec.json  test config
angular.json            one project per app ("nfl")
tsconfig.json           compiler options shared by every app
firebase.json           hosting: serves dist/site, each sport under its own path (/nfl/); / redirects to /nfl/
.github/workflows/      nfl-update-data.yml (nightly data), firebase-deploy.yml (deploy on push)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Dev server at http://localhost:4200/nfl/ |
| `npm run build` | Production build to `dist/site/nfl` |
| `npm run update-data` | Pull the current season (`SEASON=2025` for a past one) |
| `npm run update-honors` | All-Pro and Pro Bowl lists from Wikipedia |
| `npm run build-comps` | The player card's similar seasons and season history |
| `npm run build-blocking` | The player card's run-blocking reads (after a season's participation data is out) |

## Adding another sport

1. Copy `apps/nfl` to `apps/<sport>` and strip it down to what's general: the scoring engine
   (`app/utils/unit-scoring.ts`), the table, sidebar, player card and styles carry over; positions,
   stats, presets, skills, awards and the data scripts are NFL-specific and get rewritten.
2. In `angular.json`, copy the `nfl` project to `<sport>` and change `apps/nfl` to `apps/<sport>`,
   `dist/site/nfl` to `dist/site/<sport>` and the `baseHref` `/nfl/` to `/<sport>/`.
3. Add npm scripts for it (`ng serve <sport>`, its data scripts) and a nightly workflow on its own
   schedule (copy `nfl-update-data.yml`).
4. Hosting: in `firebase.json`, add a rewrite from `/<sport>/**` to `/<sport>/index.html` and a
   redirect from `/<sport>` to `/<sport>/`, and make the build script build every app (they all land
   in `dist/site`). Keep asset paths relative (`assets/...`, never `/assets` or `../assets`) so each
   app works under its own path.
5. Once two apps share code that's truly identical, move it to `libs/` (a shared library project)
   rather than keeping two copies.
