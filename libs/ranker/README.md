# libs/ranker: the shared ranker

Every sport on the site is the same product: a table of players ranked by sliders, a filter menu, a
settings menu, a player card and an About panel, each in its sport's colors. This library is the one
copy of all of that. A sport is a small folder of configuration and a theme.

```
libs/ranker/
  src/core/       used by every app, the NFL too
    analytics.ts, clipboard.ts, value-tint.ts, types.ts
    column-drag.directive.ts, column-highlight.directive.ts   (the column headers' drag and hover)
    sports.ts     the sport bar's list (from /sports.json)
  src/engine/     the ranker app (MLB, NBA and every sport added from here on)
    sport.ts      the contract: SportConfig (what a sport hands the engine), CardFlag, StatFormat
    app.module.ts, app.component.*                 the shell: sport bar, position tabs, filter menu
    skill-rankings/                                 the table, settings menu and player card
    sidebar/                                        the filter menu (presets, sliders, groups)
    position.service.ts                            sliders, settings, orders, the current tab
    unit-scoring.ts                                the ranking math (normalize, then weigh)
    data.ts                                         loading a season's JSON
    skills.ts, awards.ts                           shapes a sport's skills and awards follow
  src/styles/     the look
    _base.scss                    global styles (the app imports it first)
    _variables.scss, _theme.scss  fonts, mixins (lit dots, award plaques), the Material theme
    components/                   each component's styles, ending with the sport's partial
  src/assets/     shared textures (copied into every app's assets/)
  scripts/        shared data-script pieces
    build-comps.mjs   similar seasons and careers for the player card (each sport passes its minimums)
    grades.mjs        curve(): F to A+ grades on a curve (the support grades)
```

## How a sport plugs in

Each app's `tsconfig.json` maps two import aliases:

- `@ranker/*` to `libs/ranker/src/*`
- `@sport/*` to its own `src/sport/*`

The engine imports the sport's modules as `@sport/...`, so each app compiles the same engine against
its own sport. That's compile-time wiring: no runtime lookups or registries. The styles work the same
way: each app's `angular.json` project lists `libs/ranker/src/styles` and its own `src/theme` as Sass
include paths, so the shared component styles end with `meta.load-css("sport-rankings")` and pick up
that app's partial.

### What a sport provides (`apps/<sport>/src/sport/`)

| File | Exports |
| --- | --- |
| `sport.ts` | `SPORT: SportConfig`: id, names, seasons, how a season reads, the tabs' names, the playing-time measure for the Min setting, headshot and logo URLs, per-game decimals, wording, and the card's takes (`cardFlags`). The contract and its comments: `libs/ranker/src/engine/sport.ts` |
| `positions.ts` | The tabs (`Position`, `POSITIONS`), the stat keys, `SkillPlayer`, every tab's columns (`SKILL_STATS`), names and labels (`STAT_NAMES`, `PER_GAME_LABELS`, `STAT_BASIS_LABELS`, `PACE_GAMES`), the groups (`statGroup`, `skillGroups`, `headlineStats`), `presetWeights`, `unitStat` |
| `skill-presets.ts` | `SKILL_PRESETS`: the presets dropdown, per tab |
| `skills.ts` | The card's `SKILLS` (radar axes), `ARCHETYPES`, `VOLUME_VS_EFFICIENCY`, `WINS_VS_PLAY`, `fallbackArchetype` (shapes in `engine/skills.ts`) |
| `awards.ts` | `AWARD_INFO` (plaques; titles get an `icon`: a cup, gold for the champion, or a flag), `awardsFor` |
| `team-colors.ts` | `badgeColor`, `whiteLogo`, `teamColors` |
| `logo-eras.ts` | `logoForSeason`: a team's logo as it looked that season |
| `about/` | The About panel (its sections' content; the styles are shared) |

### Its look (`apps/<sport>/src/theme/`)

| Partial | What it holds |
| --- | --- |
| `_sport-settings.scss` | Switches the shared styles read (`$lit-label-weight`) |
| `_sport-global.scss` | The page and controls: background texture, slider knobs and switches, button and dropdown leather, accent color (`--scoreboard-led`), and the sport's textures as variables (`--tex-chalk-plays`, `--trophy-mask`) |
| `_sport-rankings.scss` | The grid: lines between rows and categories, award plaque metals (the `plaque-*` mixins), headshot shape |
| `_sport-card.scss` | The player card: headshot shape, stat-group edges |
| `_sport-sidebar.scss` | The filter menu: its ball, its edges |

Partials point at their own textures with relative paths (`url("../assets/textures/x.svg")`); Angular
rebases and bundles them.

### Its data (`apps/<sport>/src/StaticData/`, `apps/<sport>/scripts/`)

- `update-data.mjs` writes `skill-players.json`: `{ <tab>: [player, ...] }`, each player
  `{ id, gsisId, name, teamLogo, teamName, games, stats: { <key>: number | null }, awards: [ids],
  injured?, injuryStatus? }`. `gsisId` is the player's stable id, `id` the headshot's, and `teamLogo` a
  path the sport's `logo-eras.ts` and `team-colors.ts` understand. This season goes to `StaticData/`,
  finished ones (`SEASON=<year>`, `ALL=1`) to `StaticData/seasons/<year>/`. Use only Node's built-ins
  and `libs/ranker/scripts`: the nightly workflow runs it without installing packages.
- `build-comps.mjs` calls the shared `buildComps` with the sport's minimum games, writing the player
  card's similar seasons and careers.

## Adding a sport

1. `npm run new-sport -- nhl NHL`. This copies the NBA app to `apps/nhl` as a working starting point and
   wires it in: `sports.json` (sport bar, `npm run dev`), `angular.json`, `package.json`,
   `firebase.json` and a manual-only data workflow. `npx ng build nhl` works right away (still showing
   basketball).
2. Write the data script, `apps/nhl/scripts/update-data.mjs`: the source, the tabs, each player's stats,
   awards and support grades (`curve`). Run it for this season, then `ALL=1` for the past ones.
3. Rewrite the sport folder: `positions.ts` (tabs and columns), `skill-presets.ts`, `skills.ts`,
   `awards.ts`, `team-colors.ts` (and the team logos in `assets/`), `logo-eras.ts`, `about/`, and
   `sport.ts` (seasons, names, playing time, headshots, the card's takes).
4. Rework the theme partials and textures, the favicon and the loading screen (`index.html`).
5. Set the similar-seasons minimums in `scripts/build-comps.mjs` and run `npm run nhl:build-comps`.
6. Turn on the nightly schedule in `.github/workflows/nhl-update-data.yml`, and add the sport's yearly
   rollover (bumping `currentSeason` in `sport.ts` and `CURRENT_SEASON` in the data script).

## The NFL app

The NFL app (`apps/nfl`) uses the shared core and styles, but still runs its own copy of the app code.
It has features the engine doesn't: fantasy scoring, garbage time, unit ranks, team tabs (defenses,
offensive lines, head coaches) that grade each other, and preseason-blended support grades. Moving it
onto the engine means adding those as optional engine features (hooks in `SportConfig`); until then, a
change to the table, card or menus that should reach the NFL too is made in both places.

## Checking a change

Build every app (`npm run build`, or `npx ng build <sport>`). For anything visual, compare screenshots
of each app before and after: the refactor into this library was checked that way, view by view, and
came out pixel-identical.
