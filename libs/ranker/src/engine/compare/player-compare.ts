// Compare: up to four seasons side by side, anyone, any years, any tabs. Each season is read against its
// own list (that year's, that tab's, ranked with the current sliders, as the card reads it), so a 2013 back
// and a 2025 receiver meet on even ground: where each stood among his own peers. Opened from the grid (rows
// picked, then the compare button), from a card, or empty, to search everyone the sport has had.
//
// What it builds, once per change of sides: the skills (on one radar where they share three or more, and
// as bars), the edges (where each one is clearly the best of them), how alike they are, the grid's columns
// side by side (each side's tab's; the leader marked, the columns each one leads counted), a summary (what
// each one leads, and where he's clearly the best) and the career arcs (every season's standing, the compared one ringed). Sides on different tabs
// share only what's the same skill or column by name, and a column they share goes to the bigger number: a
// percentile among backs and one among receivers don't say who did more.
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStat, presetWeights } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { extras } from '@ranker/engine/row-fields';
import { CURRENT_SEASON, isLiveSeason } from '@ranker/engine/data';
import { SKILL_UNITS, defaultRanking } from '@ranker/engine/unit-scoring';
import { StatReader } from '@ranker/engine/stat-reader';
import { CardSkill } from '@ranker/engine/skills';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { rankPct } from '@ranker/core/format';
import { CardHost, careerLines } from '@ranker/engine/player-card/player-cards';
import { CardRadar, CardSeason, CareersFile, SeasonContext } from '@ranker/engine/player-card/card.model';
import { archetypeFor, skillsOf } from '@ranker/engine/player-card/overview';
import { radar } from '@ranker/engine/player-card/radar';
import type { SharedCompare } from '@ranker/engine/share';

export const COMPARE_MAX = 4;

// Each side's color, in the order they're added (soft, like the vs Position pie's: a blue, a gold, a sea
// green, a lilac; the first two the furthest apart, for the usual pair)
export const COMPARE_COLORS = ['#8ab4e0', '#e3cb8f', '#7fc8bb', '#c3a6e8'];

// An edge: a skill a side is better at than the best of the rest by this much (percentile points)
export const EDGE = 10;

const TABS = Object.keys(SKILL_STATS) as SkillPosition[];
const isTeamTab = (position: SkillPosition) => !!SPORT.teamTabs?.includes(position);
const keyOf = (position: SkillPosition, season: number, id: string) => `${position}/${season}/${id}`;

export type CompareTab = 'overview' | 'stats' | 'career';
export type ArcBy = 'year' | 'season';

// The table the compare view opens from: the card's host, and its own reader
export interface CompareHost extends CardHost {
  readonly reader: StatReader;
}

export interface CompareSide {
  // tab/season/id: one per side (the same player in two seasons is two sides)
  key: string;
  position: SkillPosition;
  season: number;
  gsisId: string;
  color: string;
  player: SkillPlayer;
  name: string;
  // The name the narrow spots use: the last one, past a Jr. or a III ("Walker")
  surname: string;
  // As the legends and hovers name it ("Jamaal Charles ’13"), and the short of it ("Charles ’13")
  label: string;
  tag: string;
  // "RB" (a team tab's name: "Team")
  tabLabel: string;
  // "2013" ("2012-13"), and its short form for the tight spots ("’13")
  seasonText: string;
  short: string;
  teamName: string | null;
  logo: string;
  badge: string;
  whiteLogo: boolean;
  photo: string | null;
  rank: number;
  of: number;
  pct: number;
  archetype: string;
  skills: CardSkill[];
  // Every season they're in on this tab (the season picker, the career arc): null while it loads
  career: CardSeason[] | null;
  // (its season, read and ranked: no context for the table's own)
  reader: StatReader;
  list: SkillPlayer[];
  context: SeasonContext | null;
}

// A search hit: someone a tab has had, any season
export interface CompareHit {
  position: SkillPosition;
  tabLabel: string;
  id: string;
  name: string;
  logo: string;
  badge: string;
  whiteLogo: boolean;
  // Their headshot, small (none: the team card stands in)
  photo: string | null;
  // "2008-2016", the season a click adds (their best by the default sliders), and every season they have
  span: string;
  best: { season: number; rank: number; of: number };
  seasons: number[];
}

export interface CompareCell {
  text: string;
  // The value the column shows (none: not ranked), and whether less is better
  value: number | null;
  lowerBetter: boolean;
  // Where it stood in its own season's list: 0 (last) to 1 (first); null: not ranked
  pct: number | null;
  rank: number | null;
  of: number;
  tint: string | null;
}

export interface CompareRow {
  key: string;
  label: string;
  name: string;
  cells: CompareCell[];
  // The sides that lead it (more than one on a tie; none when it can't be told)
  leaders: number[];
}

export interface CompareSkill {
  id: string;
  name: string;
  // Its position's label when they're of different positions ("RB"), else none
  tab: string | null;
  // Each side's percentile (null: not one of its tab's), and the sides that lead it
  pcts: (number | null)[];
  leaders: number[];
  // What it's made of (hover-text.ts skillDefinition), for its hovers
  about: string;
}

// A side's summary: the skills it's clearly best at (none: no clear edge), and the columns it leads
export interface CompareSummary {
  best: string | null;
  leads: string;
}

export interface CompareView {
  // Every skill any side has, the first side's order first
  skills: CompareSkill[];
  // One radar, every side's shape on it (the skills all of them have, three or more)
  radar: { base: CardRadar; shapes: { color: string; points: string; dots: { x: number; y: number; pct: number }[] }[]; abouts: string[] } | null;
  // Where each side is clearly the best of them, biggest first
  edges: { skill: string; by: number }[][];
  // How alike each pair's skill shapes are (0-100)
  pairs: { a: number; b: number; alike: number }[];
  // The grid's columns, group by group (every side's tab's)
  groups: { id: string; title: string; icon: string; rows: CompareRow[] }[];
  // The columns each side leads outright, and how many had a leader
  wins: number[];
  contested: number;
  // What each one has over the rest, in a line each (one side alone: none)
  summary: CompareSummary[] | null;
  // More than one tab among them (the skills are each one's among his own tab's; a column two tabs share
  // goes to the bigger number)
  mixed: boolean;
}

// The career arcs: each side's seasons as points (x: its year in the league, or the season), on a board
// the size of ARC, the plot inside its margins
export interface CompareArcs {
  width: number;
  height: number;
  left: number;
  right: number;
  byYear: boolean;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  // (a line's key: its side's and the bottom's, so a line switched is drawn in again)
  lines: { key: string; name: string; color: string; points: string; dots: { x: number; y: number; title: string; now: boolean }[] }[];
}

// (the board drawn at the width it's shown at (the view measures it), so its labels stay the size the
// card's are; its height under a third of that, within limits)
const ARC = { width: 640, left: 40, right: 14, top: 14, bottom: 28 };
const arcHeight = (width: number) => Math.round(Math.min(300, Math.max(180, width * 0.3)));

type SearchEntry = Omit<CompareHit, 'photo'> & { key: string; headshotId: number | null };
type CareerNames = Awaited<ReturnType<SeasonDataService['careerNames']>>;

export class PlayerCompare {
  open = false;
  sides: CompareSide[] = [];
  view: CompareView | null = null;
  arcs: CompareArcs | null = null;
  tab: CompareTab = 'overview';
  // The career arcs along the bottom: each one's years in the league, or the seasons themselves (null: by
  // year, unless they're all teams)
  arcBy: ArcBy | null = null;
  // (the arcs' width on screen: the view measures it)
  arcWidth = ARC.width;
  // Sides still loading (the add slot shows it), and the colors they'll take (picks load together)
  loading = 0;
  private claimed: string[] = [];
  // The search: what's typed, what it found, the hit Enter picks (the arrow keys move it), and whether
  // it's found anything yet
  query = '';
  hits: CompareHit[] = [];
  active = 0;
  searched = false;
  // A note for a moment (a fifth pick, a season already in)
  note = '';
  private noteTimer?: ReturnType<typeof setTimeout>;
  private index: Promise<SearchEntry[]> | null = null;

  constructor(
    private readonly host: CompareHost,
    private readonly data: SeasonDataService,
  ) {}

  get full(): boolean {
    return this.sides.length + this.loading >= COMPARE_MAX;
  }

  // Opened: the rows picked in the grid (the table's season and tab), or nobody yet (the search ready)
  async start(picks: SkillPlayer[]): Promise<void> {
    this.reset();
    await Promise.all(picks.slice(0, COMPARE_MAX).map((p) => this.add(this.host.position, this.host.season, p.gsisId)));
  }

  // From a link (share.ts): its sides in the link's order (the first four; anyone not found left out), on
  // its tab
  async openLinked({ sides, tab }: SharedCompare): Promise<void> {
    this.reset();
    if (tab === 'stats' || (tab === 'career' && !SPORT.careerOnly)) this.tab = tab;
    const keys = sides.slice(0, COMPARE_MAX).map((s) => keyOf(s.position, s.season, s.gsisId));
    await Promise.all(sides.slice(0, COMPARE_MAX).map((s) => this.add(s.position, s.season, s.gsisId)));
    // (they load together, in whatever order they come back)
    this.sides.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
    this.build();
  }

  // From a card: its season into the view (added when it's open, a fresh one otherwise)
  async startWith(position: SkillPosition, season: number, gsisId: string): Promise<void> {
    if (!this.open) this.reset();
    await this.add(position, season, gsisId);
  }

  close(): void {
    this.open = false;
    this.sides = [];
    this.build();
  }

  // A season added (at: in place of the side there, its season switched, keeping its color and its
  // career; it's that side that's switched, wherever it's moved to by the time this one's loaded)
  async add(position: SkillPosition, season: number, gsisId: string, at?: number): Promise<void> {
    const key = keyOf(position, season, gsisId);
    const old = at === undefined ? undefined : this.sides[at];
    if (this.sides.some((s) => s.key === key && s !== old)) return this.say('That season is already in');
    if (!old && this.full) return this.say(`Up to ${COMPARE_MAX} at a time`);
    const color = old?.color ?? COMPARE_COLORS.find((c) => !this.sides.some((s) => s.color === c) && !this.claimed.includes(c))!;
    if (!old) this.claimed.push(color);
    this.loading++;
    try {
      const side = await this.side(position, season, gsisId, color);
      if (!side || !this.open) return;
      const i = old ? this.sides.indexOf(old) : -1;
      // (the side switched was removed meanwhile, or the same season came in first: a double click)
      if ((old && i < 0) || this.sides.some((s) => s.key === key && s !== old)) return;
      if (old) this.sides[i] = side;
      else this.sides.push(side);
      if (old?.position === position && old.gsisId === gsisId && old.career) side.career = old.career;
      this.build();
      // (a career-only sport: no seasons to pick or chart)
      if (side.career) return;
      if (SPORT.careerOnly) {
        side.career = [];
        return;
      }
      careerLines(this.data, this.host.season, position, gsisId)
        .catch(() => [])
        .then((career) => {
          side.career = career;
          this.arcs = this.buildArcs();
        });
    } catch (err) {
      console.error(err);
      this.say("Couldn't load that season");
    } finally {
      this.loading--;
      if (!old) this.claimed.splice(this.claimed.indexOf(color), 1);
    }
  }

  remove(i: number): void {
    this.sides.splice(i, 1);
    this.build();
  }

  // The arcs' bottom switched (the Career tab's dropdown)
  setArcBy(by: ArcBy): void {
    this.arcBy = by;
    this.arcs = this.buildArcs();
  }

  // The arcs' box resized: drawn again at its width (a pixel a unit)
  setArcWidth(width: number): void {
    if (Math.abs(width - this.arcWidth) < 2) return;
    this.arcWidth = width;
    this.arcs = this.buildArcs();
  }

  private reset(): void {
    this.close();
    this.tab = 'overview';
    this.arcBy = null;
    this.clearSearch();
    this.open = true;
  }

  // ---------------------------------------------------------------------------
  // A side: its season read as the card reads it
  // ---------------------------------------------------------------------------
  private async side(position: SkillPosition, season: number, gsisId: string, color: string): Promise<CompareSide | null> {
    const { host } = this;
    const tableSeason = season === host.season;
    let player = tableSeason && position === host.position ? host.playerList.find((p) => p.gsisId === gsisId) : undefined;
    let rows = SKILL_UNITS;
    let list = host.playerList;
    let context: SeasonContext | null = null;
    if (!player) {
      // (the whole season, as the card opens one: the sport's team names and values from other tabs read it)
      rows = tableSeason ? SKILL_UNITS : await this.data.rows(season);
      player = rows[position]?.find((p) => p.gsisId === gsisId);
      if (!player) return null;
      context = host.seasonContext(season, rows, position);
      // (someone under the Min Games setting still gets ranked, where they'd fall)
      if (!context.list.includes(player)) {
        context.list = context.manual ? [...context.list, player] : host.rankedIn(context, [...context.list, player]);
      }
      list = context.list;
    }
    const reader = context ? host.readerFor(context) : host.reader;
    const rank = list.indexOf(player) + 1;
    const pct = rankPct(rank, list.length);
    const skills = skillsOf(position, SKILL_STATS[position], reader, player, list);
    const teamName = SPORT.teamName ? SPORT.teamName(player, position, rows) : (extras(player).teamName ?? null);
    const short = SPORT.careerOnly ? '' : `’${String(season).slice(-2)}`;
    const last = surname(player.name);
    return {
      key: keyOf(position, season, gsisId),
      position,
      season,
      gsisId,
      color,
      player,
      name: player.name,
      surname: last,
      label: withShort(player.name, short),
      tag: withShort(last, short),
      tabLabel: tabLabel(position),
      seasonText: SPORT.careerOnly ? 'Career' : isLiveSeason(season) ? 'This Season' : SPORT.seasonText(season),
      short,
      teamName: teamName && teamName !== player.name ? teamName : null,
      ...teamLook(player.teamLogo, season),
      photo: host.headshot(player, 240),
      rank,
      of: list.length,
      pct,
      archetype: archetypeFor(position, skills, pct, player),
      skills,
      career: null,
      reader,
      list,
      context,
    };
  }

  // ---------------------------------------------------------------------------
  // The comparisons
  // ---------------------------------------------------------------------------
  private build(): void {
    const sides = this.sides;
    this.view = sides.length ? this.compareView(sides) : null;
    this.arcs = this.buildArcs();
  }

  private compareView(sides: CompareSide[]): CompareView {
    // (every skill any of them has, the first side's order first. A skill is a percentile among his own
    // position, so it's one skill only within a position: a back's Receiving and a receiver's are two, each
    // tagged with its position, and a back can only lead the backs at it)
    const mixed = new Set(sides.map((s) => s.position)).size > 1;
    const skillKey = (side: CompareSide, k: CardSkill) => `${side.position}|${k.id}`;
    const defs = new Map(sides.flatMap((s) => s.skills.map((k) => [skillKey(s, k), { def: k, side: s }] as const)));
    const skills = [...defs].map(([id, { def, side }]): CompareSkill & { short: string } => {
      const pcts = sides.map((s) => s.skills.find((k) => skillKey(s, k) === id)?.pct ?? null);
      return { id, name: def.name, tab: mixed ? side.tabLabel : null, short: def.short, pcts, leaders: leadersOf(pcts), about: def.about ?? '' };
    });

    // (the radar: the skills all of them have)
    const common = skills.filter((s) => s.pcts.every((p) => p !== null));
    const radarView: CompareView['radar'] =
      common.length < 3
        ? null
        : {
            base: radar(common.map((c) => ({ short: c.short, pct: 0 }))),
            shapes: sides.map((side, i) => {
              const shape = radar(common.map((c) => ({ short: c.short, pct: c.pcts[i]! })));
              return { color: side.color, points: shape.shape, dots: shape.dots };
            }),
            // (each axis' skill, what it's made of)
            abouts: common.map((c) => `${c.name}: ${c.about}`),
          };

    // (edges: where a side beats the best of the others)
    const edges = sides.map((_, i) =>
      skills
        .flatMap((s) => {
          const mine = s.pcts[i];
          const others = s.pcts.filter((p, j): p is number => j !== i && p !== null);
          const by = mine === null || !others.length ? 0 : Math.round((mine - Math.max(...others)) * 100);
          return by >= EDGE ? [{ skill: s.tab ? `${s.name} (${s.tab})` : s.name, by }] : [];
        })
        .sort((a, b) => b.by - a.by)
        .slice(0, 3),
    );

    // (how alike: one minus the average gap between two shapes, over the skills both have)
    const pairs: CompareView['pairs'] = [];
    for (let a = 0; a < sides.length; a++) {
      for (let b = a + 1; b < sides.length; b++) {
        const gaps = skills.filter((s) => s.pcts[a] !== null && s.pcts[b] !== null).map((s) => Math.abs(s.pcts[a]! - s.pcts[b]!));
        if (gaps.length) pairs.push({ a, b, alike: Math.round(100 * (1 - gaps.reduce((x, g) => x + g, 0) / gaps.length)) });
      }
    }

    // (the columns: each side's tab's as the grid shows them, merged group by group)
    const wins = sides.map(() => 0);
    let contested = 0;
    // (and group by group, the columns each one leads, for the summary)
    const tallies: GroupTally[] = [];
    const groups = this.columns().flatMap(({ stats, ...group }) => {
      const tally: GroupTally = { title: group.title, contested: 0, led: sides.map(() => []) };
      tallies.push(tally);
      const rows = stats
        .map(({ key, of }): CompareRow => {
          const i = of.findIndex((s) => !!s);
          const shared = of[i]!;
          const cells = sides.map((side, j) => cell(side, of[j]));
          // (sides on one tab: whoever stood higher in his own season; across tabs, where a percentile
          // among backs and one among receivers don't say who did more: the bigger number)
          const tabs = new Set(sides.filter((_, j) => cells[j].value !== null).map((s) => s.position));
          const leaders = leadersOf(tabs.size > 1 ? cells.map((c) => (c.value === null ? null : c.lowerBetter ? -c.value : c.value)) : cells.map((c) => c.pct));
          // (counted toward the columns each side leads: not display-only stats or the team around them)
          const { reader } = sides[i];
          const label = reader.label(shared);
          if (!shared.infoOnly && (!shared.support || shared.supportHelps) && leaders.length) {
            contested++;
            tally.contested++;
            if (leaders.length === 1) {
              wins[leaders[0]]++;
              tally.led[leaders[0]].push(label);
            }
          }
          return { key, label, name: reader.name(shared), cells, leaders };
        })
        .filter((row) => row.cells.some((c) => c.text !== '-'));
      return rows.length ? [{ ...group, rows }] : [];
    });

    return {
      skills: skills.map(({ short: _, ...s }) => s),
      radar: radarView,
      edges,
      pairs,
      groups,
      wins,
      contested,
      summary: sides.length > 1 ? summaryOf(tallies, edges) : null,
      mixed,
    };
  }

  // Every side's tab's columns as its grid shows them (the Recent squares aside), merged: the groups in
  // the order they first come, each with every column any side shows, and each side's own stat for it
  private columns(): { id: string; title: string; icon: string; stats: { key: string; of: (SkillStat | null)[] }[] }[] {
    const out: ReturnType<PlayerCompare['columns']> = [];
    this.sides.forEach((side, i) => {
      for (const group of this.host.shownGroups(side.reader, side.position)) {
        let merged = out.find((g) => g.id === group.id);
        if (!merged) out.push((merged = { id: group.id, title: group.title, icon: group.icon, stats: [] }));
        for (const stat of group.stats) {
          if (stat.format === 'recent') continue;
          // (one column when its key and its name are the same: a back's Total Yds aren't a receiver's)
          const key = `${stat.key}|${stat.label}`;
          let row = merged.stats.find((s) => s.key === key);
          if (!row) merged.stats.push((row = { key, of: this.sides.map(() => null) }));
          row.of[i] = stat;
        }
      }
    });
    return out;
  }

  // Every side's seasons on its tab (the default sliders' rank in each, the careers file's), its year in
  // the league along the bottom (teams alone: the seasons themselves), the compared season ringed
  private buildArcs(): CompareArcs | null {
    const sides = this.sides.filter((s) => s.career?.length);
    if (!sides.length || SPORT.careerOnly) return null;
    const byYear = this.arcBy ? this.arcBy === 'year' : !sides.every((s) => isTeamTab(s.position));
    const xOf = (side: CompareSide, line: CardSeason) => (byYear ? side.career!.indexOf(line) + 1 : line.season);
    const xs = sides.flatMap((s) => s.career!.map((c) => xOf(s, c)));
    const lo = Math.min(...xs);
    const hi = Math.max(...xs, lo + 1);
    const { left, right, top, bottom } = ARC;
    const width = Math.max(240, Math.round(this.arcWidth));
    const height = arcHeight(width);
    const round = (n: number) => Math.round(n * 10) / 10;
    const px = (x: number) => round(left + ((x - lo) / (hi - lo)) * (width - left - right));
    const py = (pct: number) => round(top + (1 - pct) * (height - top - bottom));
    // (a tick every 44px or more: fewer on a phone)
    const step = Math.max(1, Math.ceil((hi - lo + 1) / Math.max(4, Math.min(12, Math.floor((width - left - right) / 44)))));
    const xTicks: CompareArcs['xTicks'] = [];
    for (let x = lo; x <= hi; x += step) xTicks.push({ x: px(x), label: byYear ? `Yr ${x}` : `’${String(x).slice(-2)}` });
    const yTicks = [1, 0.75, 0.5, 0.25, 0].map((p) => ({ y: py(p), label: p === 1 ? 'Top' : p === 0 ? 'Last' : `${p * 100}%` }));
    const lines = sides.map((side) => {
      const dots = side.career!.map((c) => ({
        x: px(xOf(side, c)),
        y: py(c.pct),
        now: c.season === side.season,
        title: `${side.name}, ${SPORT.seasonText(c.season)}: #${c.rank} of ${c.of}${byYear ? ` (year ${xOf(side, c)})` : ''}`,
      }));
      return { key: `${side.key}/${byYear ? 'year' : 'season'}`, name: side.name, color: side.color, points: dots.map((d) => `${d.x},${d.y}`).join(' '), dots };
    });
    return { width, height, left, right, byYear, xTicks, yTicks, lines };
  }

  // ---------------------------------------------------------------------------
  // The search: everyone the sport has had, every tab, by name
  // ---------------------------------------------------------------------------
  async search(query: string): Promise<void> {
    this.query = query;
    const words = normalize(query).split(' ').filter(Boolean);
    if (words.join('').length < 2) return this.clearSearch(query);
    let entries: SearchEntry[];
    try {
      entries = await (this.index ??= this.entries());
    } catch (err) {
      // (asked again on the next keystroke)
      this.index = null;
      console.error(err);
      return this.say("Couldn't load the names");
    }
    if (query !== this.query) return;
    // (a name starting with what's typed first, then the table's own tab, then the better careers)
    const score = (e: SearchEntry) =>
      (e.key.split(' ').some((part) => part.startsWith(words[0])) ? 2 : 0) + (e.position === this.host.position ? 1 : 0) + rankPct(e.best.rank, e.best.of) / 2;
    this.hits = entries
      .filter((e) => words.every((w) => e.key.includes(w)))
      .map((e) => ({ e, score: score(e) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ e: { headshotId, ...hit } }) => ({ ...hit, photo: headshotId ? this.host.headshot({ id: headshotId }, 96) : null }));
    this.active = 0;
    this.searched = true;
  }

  // A hit picked: their best season in; that one's in already, the next one down (then up) that isn't
  async pick(hit: CompareHit): Promise<void> {
    this.clearSearch();
    const taken = (season: number) => this.sides.some((s) => s.key === keyOf(hit.position, season, hit.id));
    const below = hit.seasons.filter((s) => s < hit.best.season).reverse();
    const above = hit.seasons.filter((s) => s > hit.best.season);
    const season = [hit.best.season, ...below, ...above].find((s) => !taken(s));
    if (season === undefined) return this.say('Every one of their seasons is already in');
    await this.add(hit.position, season, hit.id);
  }

  private clearSearch(query = ''): void {
    this.query = query;
    this.hits = [];
    this.active = 0;
    this.searched = false;
  }

  // Everyone on every tab: the careers files' finished seasons (named by careers/names.json: only the tabs
  // it names have a file; a career-only sport has none) and the season being played, ranked with the
  // default sliders like them
  private async entries(): Promise<SearchEntry[]> {
    const [names, current] = await Promise.all([
      SPORT.careerOnly ? ({} as CareerNames) : this.data.careerNames(),
      this.host.season === CURRENT_SEASON ? SKILL_UNITS : this.data.rows(CURRENT_SEASON),
    ]);
    const careers = await Promise.all(TABS.map((tab): Promise<CareersFile> | CareersFile => (names[tab] ? this.data.careers(tab).catch(() => ({})) : {})));
    type Line = { season: number; logo: string; rank: number; of: number };
    return TABS.flatMap((position, t) => {
      // (a team's or a coach's: no headshot)
      const photos = !isTeamTab(position) && position !== SPORT.coachTab;
      const byId = new Map<string, { name: string; headshotId: number | null; seasons: Line[] }>();
      for (const [id, lines] of Object.entries(careers[t])) {
        const [name, headshotId] = names[position]?.[id] ?? [];
        if (name) byId.set(id, { name, headshotId: headshotId ?? null, seasons: lines.map(([season, logo, , rank, of]) => ({ season, logo: SPORT.teamLogo(logo), rank, of })) });
      }
      const rows = current[position] ?? [];
      const ranked = rows.length ? defaultRanking(position, presetWeights(position, 'default'), current) : [];
      for (const row of rows) {
        const line = { season: CURRENT_SEASON, logo: row.teamLogo, rank: ranked.indexOf(row) + 1, of: ranked.length };
        const known = byId.get(row.gsisId);
        if (!known) byId.set(row.gsisId, { name: row.name, headshotId: row.id ?? null, seasons: [line] });
        else if (!known.seasons.some((s) => s.season === CURRENT_SEASON)) known.seasons.push(line);
      }
      return [...byId].map(([id, { name, headshotId, seasons }]): SearchEntry => {
        seasons.sort((a, b) => a.season - b.season);
        // (their best ranked season; none ranked, the latest)
        const best = seasons.reduce<Line | null>((b, s) => (s.rank > 0 && (!b || rankPct(s.rank, s.of) > rankPct(b.rank, b.of)) ? s : b), null) ?? seasons.at(-1)!;
        const [first, last] = [seasons[0].season, seasons.at(-1)!.season];
        return {
          position,
          tabLabel: tabLabel(position),
          id,
          key: normalize(name),
          name,
          headshotId: photos ? headshotId : null,
          ...teamLook(best.logo, best.season),
          span: SPORT.careerOnly ? '' : first === last ? SPORT.seasonText(first) : `${first}-${last}`,
          best: { season: best.season, rank: best.rank, of: best.of },
          seasons: seasons.map((s) => s.season),
        };
      });
    });
  }

  private say(text: string): void {
    this.note = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => (this.note = ''), 2400);
  }
}

// A side's value in a column against its own season's list (none when its tab hasn't the column, or
// another season's card wouldn't show it: a value from another tab, the table's season's)
function cell(side: CompareSide, stat: SkillStat | null): CompareCell {
  const lowerBetter = !!stat && (stat.format === 'rank' || (!!stat.negative && !stat.support));
  const none: CompareCell = { text: '-', value: null, lowerBetter, pct: null, rank: null, of: 0, tint: null };
  if (!stat || (side.context && SPORT.tableSeasonOnly?.(stat))) return none;
  const { reader, player, list } = side;
  const value = reader.value(player, stat);
  const text = reader.format(player, stat);
  if (value === null || stat.infoOnly) return { ...none, text };
  const values = list.map((p) => reader.value(p, stat)).filter((v): v is number => v !== null);
  const rank = 1 + values.filter((v) => (lowerBetter ? v < value : v > value)).length;
  return { text, value, lowerBetter, pct: rankPct(rank, values.length), rank, of: values.length, tint: reader.valueColor(player, stat) };
}

// A stat group's columns each side leads outright, of those with a leader
export interface GroupTally {
  title: string;
  contested: number;
  led: string[][];
}

// What each side has over the rest, in plain words: the skills it's clearly the best at (its edges: two),
// then the groups it leads the most columns of (its two biggest, three of the columns named)
// ({ best: "Accuracy and Pocket", leads: "leads Advanced in 5 of 8 categories (EPA/Play, Success, CPOE and 2
// more); Box Score in 2 of 6 (Rating, Comp %)" })
export function summaryOf(groups: GroupTally[], edges: { skill: string }[][]): CompareSummary[] {
  return edges.map((own, i) => {
    const led = groups
      .filter((g) => g.led[i].length)
      .sort((a, b) => b.led[i].length - a.led[i].length)
      .slice(0, 2)
      .map((g, j) => {
        const columns = g.led[i];
        const more = columns.length > 3 ? ` and ${columns.length - 3} more` : '';
        return `${g.title} in ${columns.length} of ${g.contested}${j ? '' : ' categories'} (${columns.slice(0, 3).join(', ')}${more})`;
      });
    const best = own.slice(0, 2).map((e) => e.skill);
    return { best: best.length ? best.join(' and ') : null, leads: led.length ? `leads ${led.join('; ')}` : 'leads no column outright' };
  });
}

// The best of a few percentiles: every side at the top (ties), none when fewer than two have one or
// they're all level
export function leadersOf(pcts: (number | null)[]): number[] {
  const known = pcts.filter((p): p is number => p !== null);
  if (known.length < 2) return [];
  const top = Math.max(...known);
  if (known.every((p) => p === top)) return [];
  return pcts.flatMap((p, i) => (p === top ? [i] : []));
}

// A team's look that season: its logo (as the cards show it), its badge's color, whether it's drawn white
function teamLook(teamLogo: string, season: number): { logo: string; badge: string; whiteLogo: boolean } {
  const logo = logoForSeason(teamLogo, season);
  return { logo: SPORT.cardLogo ? SPORT.cardLogo(logo) : logo, badge: badgeColor(teamLogo), whiteLogo: whiteLogo(teamLogo) };
}

// "Jamaal Charles ’13" (a career-only sport: just the name)
function withShort(name: string, short: string): string {
  return short ? `${name} ${short}` : name;
}

// "RB"; a team tab, its name ("Team")
function tabLabel(position: SkillPosition): string {
  return isTeamTab(position) || position === SPORT.coachTab ? SPORT.positionNames[position] : position;
}

// "Kenneth Walker III" -> "Walker"
export function surname(name: string): string {
  return name.split(' ').filter((p) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p)).at(-1) ?? name;
}

// A name for matching: lowercase, accents and punctuation off ("Dončić" finds "doncic", "Ja'Marr" "jamarr")
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
