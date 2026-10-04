# libs/ranker: the shared ranker

Every sport on the site is the same product: a table of players ranked by sliders, a filter menu, a
settings menu, a player card and an About panel, each in its sport's colors. This library is the one
copy of all of that. A sport is a small folder of configuration and a theme.

```
libs/ranker/
  src/core/       small utilities the engine and apps share
    analytics.ts, clipboard.ts, value-tint.ts
    format.ts     how values read: grades, rates, innings, ordinals, rank colors
    column-drag.directive.ts, column-highlight.directive.ts   (the column headers' drag and hover)
    sports.ts     the sport bar's list (from /sports.json)
  src/engine/     the ranker app, for every sport
    sport.ts      the contract: SportConfig (what a sport hands the engine, optional features
                  included), StatDef (a stat), StatFormat, StatBasis, StatGroup, CardFlag
    app.module.ts, app.component.*                 the shell: sport bar, position tabs, filter menu
    skill-rankings/                                 the grid and its button bar, the settings menu,
                                                   the rows' glide when the list re-ranks
    player-card/                                    the player card: its data (card.model), what
                                                   builds it (player-cards), the Overview's words,
                                                   career history and radar, and the component
    sidebar/                                        the filter menu (presets, sliders, groups)
    about/                                          the About panel's frame (each sport fills it)
    position.service.ts                            sliders, settings, orders, the current tab
    stat-reader.ts                                 a season's values as the settings show them,
                                                   their labels, averages and colors
    unit-scoring.ts                                the ranking math (normalize, then weigh), and a
                                                   stat's value (data, or worked out in the app)
    playing-time.ts, setting-options.ts            the Min setting; the sport's own settings
    data.ts, season-data.service.ts                loading a season's JSON; other seasons' files
    team-rows.ts                                   a Teams tab built from the head coach rows
    skills.ts, awards.ts                           shapes a sport's skills and awards follow
  src/styles/     the look
    _base.scss                    global styles (the app imports it first)
    _variables.scss, _theme.scss  fonts, mixins (lit dots, panels, team cards, award plaques), the
                                  Material theme
    _sport-kit.scss               the sport themes' kit: the selectors they dress, and shared pieces
                                  (ball knobs, painted lines, list lettering)
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
| `positions.ts` | The tabs (`Position`, `POSITIONS`), the stat keys, `SkillPlayer`, `SkillStat` (`StatDef` over its keys), every tab's columns (`SKILL_STATS`), names and labels (`STAT_NAMES`, `PER_GAME_LABELS`, `STAT_BASIS_LABELS`, `PACE_GAMES`), the groups (`statGroup`, `skillGroups`, `headlineStats`), `presetWeights`, `unitStat` |
| `skill-presets.ts` | `SKILL_PRESETS`: the presets dropdown, per tab |
| `skills.ts` | The card's `SKILLS` (radar axes), `ARCHETYPES`, `VOLUME_VS_EFFICIENCY`, `WINS_VS_PLAY`, `fallbackArchetype` (shapes in `engine/skills.ts`) |
| `awards.ts` | `AWARD_INFO` (plaques; titles get an `icon`: a cup, gold for the champion, or a flag), `awardsFor` |
| `team-colors.ts` | `badgeColor`, `whiteLogo`, `teamColors` |
| `logo-eras.ts` | `logoForSeason`: a team's logo as it looked that season |
| `about/` | The About panel's content: its sections, glossary and text (the frame and styles are shared) |

A sport can add files of its own beside these for its optional features (below): the NFL has
`qb-rows.ts` (the QBs tab, built from its game results), `team-grades.ts` (fantasy points, unit ranks
and the team grades the tabs give each other) and `blocking.ts` (the card's run blocking).

### Optional features (`SportConfig`'s optional fields)

Everything here is off unless a sport's `SPORT` sets it; the NFL uses all of it.

| Field | What it turns on |
| --- | --- |
| `dataFiles`, `extraRows` | More files per season (read into `DATA`), and tabs built from them rather than read from `skill-players.json` |
| `settings` | The sport's own settings-menu entries: a choice cycled by clicking, or an on/off switch, in a given spot. Their values reach `unitStat`, `computedValue`, `statLabel` and `statName` |
| `computedValue`, `tableSeasonOnly` | Values worked out in the app (fantasy points, league ranks, grades from other tabs), and which of them only the table's season has |
| `connect` | Called once at startup with the engine's rankings of every tab (`rankedUnits`), so tabs can grade each other; what it returns re-sorts the table when those grades change |
| `combined` | Pairs of stats shown as one total column (rushing + receiving yards), with a parent slider in the filter menu and a Combine switch in the settings |
| `statLabel`, `statName` | A column's label and hover name under the sport's settings ("Off Rank (Pts)") |
| `cardFlagsLast`, `cardExtras` | Card takes after the engine's own, and more for the card once it's open (a skill on the radar, takes, an archetype; the NFL reads run blocking from a file per season) |
| `teamTabs`, `rowHeader`, `teamName` | Tabs whose rows are teams, the name column's header per tab, and the card's team name |
| `playingTime.seasonLength`, `playingTime.everyone` | What the Min setting's share is of, and tabs with no minimum |
| `careerOnly` | One career table rather than seasons (MMA): no season dropdown, the card reads "Career", no seasons tab or similar seasons |
| `tabVisible` | Tabs a sport setting shows or hides (MMA's women's divisions) |
| `cardHistory` | A history tab on the card (MMA's fights): a result, what it was, where and when, and a detail per line |

Stat formats the engine draws for any sport: `recent` (the last five results as dots, from a row's
`lastFive`) and `rank` (a league rank with a dimmed "#" and a "(t)" for ties).

### Its look (`apps/<sport>/src/theme/`)

| Partial | What it holds |
| --- | --- |
| `_sport-settings.scss` | Switches the shared styles read (`$lit-label-weight`) |
| `_sport-global.scss` | The page and controls: background texture, slider knobs and switches, button and dropdown leather, accent color (`--scoreboard-led`), and the sport's textures as variables (`--tex-chalk-plays`, `--trophy-mask`) |
| `_sport-rankings.scss` | The grid: lines between rows and categories, headshot shape |
| `_sport-awards.scss` | Which awards' plaques are silver, bronze or steel (the `plaque-*` mixins; gold otherwise), on the grid and the card |
| `_sport-card.scss` | The player card: headshot shape, stat-group edges |
| `_sport-sidebar.scss` | The filter menu: its ball, its edges |

Partials point at their own textures with relative paths (`url("../assets/textures/x.svg")`); Angular
rebases and bundles them. What several sports draw the same way (a painted category line, a ball on
the slider knobs, the dropdowns' list lettering) comes from `_sport-kit.scss`.

### Its data (`apps/<sport>/src/StaticData/`, `apps/<sport>/scripts/`)

- `update-data.mjs` writes `skill-players.json`: `{ <tab>: [player, ...] }`, each player
  `{ id, gsisId, name, teamLogo, teamName, games, stats: { <key>: number | null }, awards: [ids],
  injured?, injuryStatus? }`. `gsisId` is the player's stable id, `id` the headshot's, and `teamLogo` a
  path the sport's `logo-eras.ts` and `team-colors.ts` understand. This season goes to `StaticData/`,
  finished ones (`SEASON=<year>`, `ALL=1`) to `StaticData/seasons/<year>/`. Use only Node's built-ins
  and `libs/ranker/scripts`: the nightly workflow runs it without installing packages.
- `build-comps.mjs` calls the shared `buildComps` with the sport's minimum games (and its
  `dataFiles`, and which stats seasons are compared on, if they differ), writing the player card's
  similar seasons and careers.

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
6. Turn on the nightly schedule in `.github/workflows/nhl-update-data.yml`, with its yearly rollover
   step (`node scripts/rollover.mjs <sport> --if-due`) before the data pull: it needs ESPN's scoreboard
   path for the sport in `scripts/rollover.mjs`.

## Yearly rollover

A new season becomes current on its own: each sport's nightly workflow runs
`node scripts/rollover.mjs <sport> --if-due` first, which rolls over once yesterday's ESPN scoreboard
is a newer season, in its regular season, with a game finished. It bumps the current season (the data
script's `CURRENT_SEASON`, and `currentSeason` and `currentSeasonEnds` in `sport.ts`), archives the
finished season (`SEASON=<year>` run of the data script) and rebuilds the similar seasons, in that order;
the night's update then fills in the new season. `npm run rollover -- <sport>` does it by hand, and
`--dry-run` shows what it would change. Still by hand: the NFL's preseason grades for the new season,
awards lists kept in `awards.ts`, and new team logos.

## Checking a change

Build every app (`npm run build`, or `npx ng build <sport>`). For anything visual, compare screenshots
of each app before and after: the refactor into this library was checked that way, view by view, and
came out pixel-identical. The cleanup of the styles and the engine after it was checked the same way,
plus every element's computed styles and the text of the grid, the player card's tabs and the settings
menu, before and after.
