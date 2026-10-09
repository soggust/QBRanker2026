// Compare: up to four seasons side by side, anyone, any years, any tabs. Each season is read against its
// own list (that year's, that tab's, ranked with the current sliders, as the card reads it), so a 2013 back
// and a 2025 receiver meet on even ground: where each stood among his own peers. Opened from the grid (rows
// picked, then the compare button), from a card, or empty, to search everyone the sport has had.
//
// What it builds, once per change of sides: the skills (on one radar where they share three or more, and
// as bars), the edges (where each one is clearly the best of them), how alike they are, the grid's columns
// side by side (each side's tab's; the leader marked, the columns each one leads counted) and the career
// arcs (every season's standing, the compared one ringed).
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
import { CardRadar, CardSeason, SeasonContext } from '@ranker/engine/player-card/card.model';
import { archetypeFor, skillsOf } from '@ranker/engine/player-card/overview';
import { radar, radarShape } from '@ranker/engine/player-card/radar';

export const COMPARE_MAX = 4;

// Each side's color, in the order they're added (soft, like the vs Position pie's: a blue, a gold, a sea
// green, a lilac; the first two the furthest apart, for the usual pair)
const COLORS = ['#8ab4e0', '#e3cb8f', '#7fc8bb', '#c3a6e8'];

// An edge: a skill a side is better at than the best of the rest by this much (percentile points)
const EDGE = 10;

const TABS = Object.keys(SKILL_STATS) as SkillPosition[];
const isTeamTab = (position: SkillPosition) => !!SPORT.teamTabs?.includes(position);

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
  // "2008-2016", and the season a click adds (their best by the default sliders)
  span: string;
  best: { season: number; rank: number; of: number };
}

export interface CompareCell {
  text: string;
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

export interface CompareView {
  // Every skill any side has: each side's percentile (null: not one of its tab's), the leaders
  skills: { id: string; name: string; pcts: (number | null)[]; leaders: number[] }[];
  // One radar, every side's shape on it (the skills all of them have, three or more)
  radar: { base: CardRadar; shapes: { color: string; points: string; dots: { x: number; y: number }[] }[] } | null;
  // Where each side is clearly the best of them, biggest first
  edges: { skill: string; by: number }[][];
  // How alike each pair's skill shapes are (0-100)
  pairs: { a: number; b: number; alike: number }[];
  // The grid's columns, group by group (every side's tab's)
  groups: { id: string; title: string; icon: string; rows: CompareRow[] }[];
  // The columns each side leads outright, and how many had a leader
  wins: number[];
  contested: number;
}

// The career arcs: each side's seasons as points (x: its year in the league; teams alone, the season), on
// a 640 x 210 board
export interface CompareArcs {
  width: number;
  height: number;
  byYear: boolean;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  lines: { color: string; points: string; dots: { x: number; y: number; title: string; now: boolean }[] }[];
}

const ARC = { width: 640, height: 210, left: 40, right: 14, top: 14, bottom: 28 };

type SearchEntry = CompareHit & { key: string };

export class PlayerCompare {
  open = false;
  sides: CompareSide[] = [];
  view: CompareView | null = null;
  arcs: CompareArcs | null = null;
  tab: 'overview' | 'stats' | 'career' = 'overview';
  // Sides still loading (the add slot shows it), and the colors they'll take (picks load together)
  loading = 0;
  private claimed: string[] = [];
  // The search: what's typed, what it found, and whether it's found anything yet
  query = '';
  hits: CompareHit[] = [];
  searched = false;
  // A note for a moment (a fifth pick, a season already in)
  note = '';
  private noteTimer?: ReturnType<typeof setTimeout>;

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

  // From a card: its season into the view (added when it's open, a fresh one otherwise)
  async startWith(position: SkillPosition, season: number, gsisId: string): Promise<void> {
    if (!this.open) this.reset();
    await this.add(position, season, gsisId);
  }

  close(): void {
    this.open = false;
    this.sides = [];
    this.view = null;
    this.arcs = null;
  }

  // A season added (at: in place of the side there, its season switched)
  async add(position: SkillPosition, season: number, gsisId: string, at?: number): Promise<void> {
    const key = `${position}/${season}/${gsisId}`;
    if (this.sides.some((s, i) => s.key === key && i !== at)) return this.say('That season is already in');
    if (at === undefined && this.full) return this.say(`Up to ${COMPARE_MAX} at a time`);
    const color = at !== undefined ? this.sides[at].color : COLORS.find((c) => !this.sides.some((s) => s.color === c) && !this.claimed.includes(c))!;
    if (at === undefined) this.claimed.push(color);
    this.loading++;
    try {
      const side = await this.side(position, season, gsisId, color);
      if (!side || !this.open) return;
      if (at !== undefined && this.sides[at]) this.sides[at] = side;
      else this.sides.push(side);
      this.build();
      careerLines(this.data, this.host.season, position, gsisId)
        .then((career) => (side.career = career))
        .catch(() => (side.career = []))
        .finally(() => (this.arcs = this.buildArcs()));
    } catch (err) {
      console.error(err);
      this.say("Couldn't load that season");
    } finally {
      this.loading--;
      if (at === undefined) this.claimed.splice(this.claimed.indexOf(color), 1);
    }
  }

  remove(i: number): void {
    this.sides.splice(i, 1);
    this.build();
  }

  private reset(): void {
    this.close();
    this.tab = 'overview';
    this.clearSearch();
    this.open = true;
  }

  // ---------------------------------------------------------------------------
  // A side: its season read as the card reads it
  // ---------------------------------------------------------------------------
  private async side(position: SkillPosition, season: number, gsisId: string, color: string): Promise<CompareSide | null> {
    const { host } = this;
    let player = season === host.season && position === host.position ? host.playerList.find((p) => p.gsisId === gsisId) : undefined;
    let rows = SKILL_UNITS;
    let list = host.playerList;
    let context: SeasonContext | null = null;
    if (!player) {
      // (the whole season, as the card opens one: the sport's team names and values from other tabs read it)
      rows = season === host.season ? SKILL_UNITS : await this.data.rows(season);
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
    const logo = logoForSeason(player.teamLogo, season);
    return {
      key: `${position}/${season}/${gsisId}`,
      position,
      season,
      gsisId,
      color,
      player,
      name: player.name,
      surname: surname(player.name),
      tabLabel: tabLabel(position),
      seasonText: SPORT.careerOnly ? 'Career' : isLiveSeason(season) ? 'This Season' : SPORT.seasonText(season),
      short: SPORT.careerOnly ? '' : `’${String(season).slice(-2)}`,
      teamName: teamName && teamName !== player.name ? teamName : null,
      logo: SPORT.cardLogo ? SPORT.cardLogo(logo) : logo,
      badge: badgeColor(player.teamLogo),
      whiteLogo: whiteLogo(player.teamLogo),
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
    if (!sides.length) {
      this.view = null;
      this.arcs = null;
      return;
    }

    // (every skill any of them has, the first side's order first)
    const skillIds = [...new Set(sides.flatMap((s) => s.skills.map((k) => k.id)))];
    const skills = skillIds.map((id) => {
      const pcts = sides.map((s) => s.skills.find((k) => k.id === id)?.pct ?? null);
      const def = sides.flatMap((s) => s.skills).find((k) => k.id === id)!;
      return { id, name: def.name, short: def.short, pcts, leaders: leadersOf(pcts) };
    });

    // (the radar: the skills all of them have)
    const common = skills.filter((s) => s.pcts.every((p) => p !== null));
    const radarView: CompareView['radar'] =
      common.length < 3
        ? null
        : {
            base: radar(common.map((c) => ({ short: c.short, pct: 0 }))),
            shapes: sides.map((side, i) => {
              const pcts = common.map((c) => ({ short: c.short, pct: c.pcts[i]! }));
              return { color: side.color, points: radarShape(pcts.map((p) => p.pct)), dots: radar(pcts).dots };
            }),
          };

    // (edges: where a side beats the best of the others)
    const edges = sides.map((_, i) =>
      skills
        .map((s) => {
          const mine = s.pcts[i];
          const others = s.pcts.filter((p, j): p is number => j !== i && p !== null);
          return mine === null || !others.length ? null : { skill: s.name, by: Math.round((mine - Math.max(...others)) * 100) };
        })
        .filter((e): e is { skill: string; by: number } => !!e && e.by >= EDGE)
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
    const groups = this.columns().map(({ id, title, icon, stats }) => ({
      id,
      title,
      icon,
      rows: stats
        .map(({ key, of }): CompareRow => {
          const shared = of.find((s): s is SkillStat => !!s)!;
          const cells = sides.map((side, i) => cell(side, of[i]));
          const leaders = leadersOf(cells.map((c) => c.pct));
          // (counted toward the columns each side leads: not display-only stats or the team around them)
          if (!shared.infoOnly && (!shared.support || shared.supportHelps) && leaders.length) {
            contested++;
            if (leaders.length === 1) wins[leaders[0]]++;
          }
          const reader = sides[of.indexOf(shared)].reader;
          return { key, label: reader.label(shared), name: reader.name(shared), cells, leaders };
        })
        .filter((row) => row.cells.some((c) => c.text !== '-')),
    }));

    this.view = { skills, radar: radarView, edges, pairs, groups: groups.filter((g) => g.rows.length), wins, contested };
    this.arcs = this.buildArcs();
  }

  // Every side's tab's columns as its grid shows them (the Recent squares aside), merged: the groups in
  // the order they first come, each with every stat any side shows, and each side's own definition of it
  private columns(): { id: string; title: string; icon: string; stats: { key: string; of: (SkillStat | null)[] }[] }[] {
    const out: ReturnType<PlayerCompare['columns']> = [];
    this.sides.forEach((side, i) => {
      for (const group of this.host.shownGroups(side.reader, side.position)) {
        let merged = out.find((g) => g.id === group.id);
        if (!merged) out.push((merged = { id: group.id, title: group.title, icon: group.icon, stats: [] }));
        for (const stat of group.stats.filter((s) => s.format !== 'recent')) {
          let row = merged.stats.find((s) => s.key === stat.key);
          if (!row) merged.stats.push((row = { key: stat.key, of: this.sides.map(() => null) }));
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
    const byYear = !sides.every((s) => isTeamTab(s.position));
    const xOf = (side: CompareSide, line: CardSeason) => (byYear ? side.career!.indexOf(line) + 1 : line.season);
    const xs = sides.flatMap((s) => s.career!.map((c) => xOf(s, c)));
    const lo = Math.min(...xs);
    const hi = Math.max(...xs, lo + 1);
    const { width, height, left, right, top, bottom } = ARC;
    const px = (x: number) => Math.round((left + ((x - lo) / (hi - lo)) * (width - left - right)) * 10) / 10;
    const py = (pct: number) => Math.round((top + (1 - pct) * (height - top - bottom)) * 10) / 10;
    const step = Math.max(1, Math.ceil((hi - lo + 1) / 12));
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
      return { color: side.color, points: dots.map((d) => `${d.x},${d.y}`).join(' '), dots };
    });
    return { width, height, byYear, xTicks, yTicks, lines };
  }

  // ---------------------------------------------------------------------------
  // The search: everyone the sport has had, every tab, by name
  // ---------------------------------------------------------------------------
  private index: Promise<SearchEntry[]> | null = null;

  async search(query: string): Promise<void> {
    this.query = query;
    const words = normalize(query).split(' ').filter(Boolean);
    if (words.join('').length < 2) {
      this.hits = [];
      this.searched = false;
      return;
    }
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
      .sort((a, b) => score(b) - score(a))
      .slice(0, 8);
    this.searched = true;
  }

  // A hit picked: their best season in (another of theirs from the tape's season picker)
  async pick(hit: CompareHit): Promise<void> {
    this.clearSearch();
    await this.add(hit.position, hit.best.season, hit.id);
  }

  private clearSearch(): void {
    this.query = '';
    this.hits = [];
    this.searched = false;
  }

  // Everyone on every tab: the careers files' finished seasons (named by careers/names.json) and the
  // season being played, ranked with the default sliders like them
  private async entries(): Promise<SearchEntry[]> {
    const [names, careers, current] = await Promise.all([
      this.data.careerNames(),
      Promise.all(TABS.map((tab) => this.data.careers(tab).catch(() => ({})))),
      this.host.season === CURRENT_SEASON ? Promise.resolve(SKILL_UNITS) : this.data.rows(CURRENT_SEASON),
    ]);
    type Line = { season: number; logo: string; rank: number; of: number };
    return TABS.flatMap((position, t) => {
      const byId = new Map<string, { name: string; seasons: Line[] }>();
      for (const [id, lines] of Object.entries(careers[t])) {
        const name = names[position]?.[id]?.[0];
        if (name) byId.set(id, { name, seasons: lines.map(([season, logo, , rank, of]) => ({ season, logo: SPORT.teamLogo(logo), rank, of })) });
      }
      const rows = current[position] ?? [];
      const ranked = rows.length ? defaultRanking(position, presetWeights(position, 'default'), current) : [];
      for (const row of rows) {
        const line = { season: CURRENT_SEASON, logo: row.teamLogo, rank: ranked.indexOf(row) + 1, of: ranked.length };
        const known = byId.get(row.gsisId);
        if (!known) byId.set(row.gsisId, { name: row.name, seasons: [line] });
        else if (!known.seasons.some((s) => s.season === CURRENT_SEASON)) known.seasons.push(line);
      }
      return [...byId.entries()].map(([id, { name, seasons }]): SearchEntry => {
        seasons.sort((a, b) => a.season - b.season);
        const best = seasons.filter((s) => s.rank > 0).reduce((b, s) => (rankPct(s.rank, s.of) > rankPct(b.rank, b.of) ? s : b), seasons.at(-1)!);
        const [first, last] = [seasons[0].season, seasons.at(-1)!.season];
        const logo = logoForSeason(best.logo, best.season);
        return {
          position,
          tabLabel: tabLabel(position),
          id,
          key: normalize(name),
          name,
          logo: SPORT.cardLogo ? SPORT.cardLogo(logo) : logo,
          badge: badgeColor(best.logo),
          whiteLogo: whiteLogo(best.logo),
          span: SPORT.careerOnly ? '' : first === last ? SPORT.seasonText(first) : `${first}-${last}`,
          best: { season: best.season, rank: best.rank, of: best.of },
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
  const none: CompareCell = { text: '-', pct: null, rank: null, of: 0, tint: null };
  if (!stat || (side.context && SPORT.tableSeasonOnly?.(stat))) return none;
  const { reader, player, list } = side;
  const value = reader.value(player, stat);
  const text = reader.format(player, stat);
  if (value === null || stat.infoOnly) return { ...none, text };
  const lowerBetter = stat.format === 'rank' || (!!stat.negative && !stat.support);
  const values = list.map((p) => reader.value(p, stat)).filter((v): v is number => v !== null);
  const rank = 1 + values.filter((v) => (lowerBetter ? v < value : v > value)).length;
  return { text, pct: rankPct(rank, values.length), rank, of: values.length, tint: reader.valueColor(player, stat) };
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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
