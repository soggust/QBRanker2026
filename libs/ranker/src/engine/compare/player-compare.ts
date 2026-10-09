// Compare: up to four seasons side by side, any years, one tab (QBs with QBs, teams with teams). Each
// season is read against its own league (its list ranked with the current sliders, as the card reads it),
// so a 2013 back and a 2025 one meet on even ground: where each stood among his own peers. Opened from the
// grid (rows picked, then the compare button) or empty, to search everyone the tab has ever had.
//
// What it builds: each side's tape (the card's hero in miniature: team card, season, rank, archetype),
// then the comparisons, worked out once per change of sides: the skills overlaid on one radar with each
// skill's bars, the edges (where each one is clearly better than the rest), how alike they are, every
// column the grid shows stat by stat (the leader marked, the categories each one takes counted), and the
// career arcs (every season's standing, the compared one ringed).
import { SKILL_STATS, SkillPlayer, SkillPosition, SkillStatGroup } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { SKILLS } from '@sport/skills';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { extras } from '@ranker/engine/row-fields';
import { CURRENT_SEASON, isLiveSeason } from '@ranker/engine/data';
import { SKILL_UNITS, defaultRanking } from '@ranker/engine/unit-scoring';
import { presetWeights } from '@sport/positions';
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

// The table the compare view opens from: the card's host, and its own reader and list
export interface CompareHost extends CardHost {
  readonly reader: StatReader;
}

export interface CompareSide {
  // season/id: one per side (the same player in two seasons is two sides)
  key: string;
  season: number;
  gsisId: string;
  color: string;
  player: SkillPlayer;
  name: string;
  // The name the narrow spots use: the last one, past a Jr. or a III ("Walker")
  surname: string;
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
  // Every season they're in (the season picker, the career arc): null while it loads
  career: CardSeason[] | null;
  // (its season, read and ranked: a context null for the table's own)
  reader: StatReader;
  list: SkillPlayer[];
  context: SeasonContext | null;
}

// A search hit: someone the tab has had, any season
export interface CompareHit {
  id: string;
  name: string;
  photo: string | null;
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
  // Counts toward the categories each one takes (not display-only stats or the team around them)
  trait: boolean;
}

export interface CompareView {
  // The skills every side has, in the sport's order: each side's percentile, the leader's index
  skills: { id: string; name: string; short: string; pcts: (number | null)[]; leaders: number[] }[];
  // One radar, every side's shape on it (the skills all of them have; three or more)
  radar: { base: CardRadar; shapes: { color: string; points: string; dots: { x: number; y: number }[] }[] } | null;
  // Where each side is clearly the best of them (by 10 points or more), biggest first
  edges: { skill: string; by: number }[][];
  // How alike each pair's skill shapes are (0-100)
  pairs: { a: number; b: number; alike: number }[];
  // The grid's columns, group by group
  groups: { id: string; title: string; icon: string; rows: CompareRow[] }[];
  // The categories each side takes outright, and how many were contested
  wins: number[];
  contested: number;
}

// A career arc: each side's seasons as points (x: its year in the league, or the season for a team
// tab), on a 640 x 210 board
export interface CompareArcs {
  width: number;
  height: number;
  byYear: boolean;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  lines: { color: string; points: string; dots: { x: number; y: number; title: string; now: boolean }[] }[];
}

const ARC = { width: 640, height: 210, left: 40, right: 14, top: 14, bottom: 28 };

export class PlayerCompare {
  open = false;
  position: SkillPosition | null = null;
  sides: CompareSide[] = [];
  view: CompareView | null = null;
  arcs: CompareArcs | null = null;
  tab: 'overview' | 'stats' | 'career' = 'overview';
  // Sides still loading (the add slot shows it), and the colors they'll take (picks load together)
  loading = 0;
  private claimed: string[] = [];
  // The search: what's typed, what it found, and whether its list is open
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

  // Opened: the rows picked in the grid (the table's season), or nobody yet (the search ready)
  async start(picks: SkillPlayer[]): Promise<void> {
    this.reset(this.host.position);
    await Promise.all(picks.slice(0, COMPARE_MAX).map((p) => this.add(this.host.season, p.gsisId)));
  }

  // From a card: its season, on its tab (added to the view when it's open on that tab, a new one
  // otherwise)
  async startWith(season: number, gsisId: string, position: SkillPosition): Promise<void> {
    if (!this.open || this.position !== position) this.reset(position);
    await this.add(season, gsisId);
  }

  private reset(position: SkillPosition): void {
    this.position = position;
    this.sides = [];
    this.view = null;
    this.arcs = null;
    this.tab = 'overview';
    this.query = '';
    this.hits = [];
    this.searched = false;
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.sides = [];
    this.view = null;
    this.arcs = null;
  }

  // A season added (at: in place of the side there, a season switched)
  async add(season: number, gsisId: string, at?: number): Promise<void> {
    const key = `${season}/${gsisId}`;
    if (this.sides.some((s, i) => s.key === key && i !== at)) return this.say('That season is already in');
    if (at === undefined && this.full) return this.say(`Up to ${COMPARE_MAX} at a time`);
    const color =
      at !== undefined ? this.sides[at].color : (COLORS.find((c) => !this.sides.some((s) => s.color === c) && !this.claimed.includes(c)) ?? COLORS[0]);
    if (at === undefined) this.claimed.push(color);
    this.loading++;
    try {
      const side = await this.side(season, gsisId, color);
      if (!side || !this.open) return;
      if (at !== undefined && this.sides[at]) this.sides[at] = side;
      else this.sides.push(side);
      this.build();
      careerLines(this.data, this.host.season, this.position!, gsisId)
        .then((career) => {
          side.career = career;
          this.arcs = this.buildArcs();
        })
        .catch(() => (side.career = []));
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

  // ---------------------------------------------------------------------------
  // A side: its season read as the card reads it
  // ---------------------------------------------------------------------------
  private async side(season: number, gsisId: string, color: string): Promise<CompareSide | null> {
    const { host } = this;
    const position = this.position!;
    let list: SkillPlayer[];
    let context: SeasonContext | null = null;
    let player = season === host.season && position === host.position ? host.playerList.find((p) => p.gsisId === gsisId) : undefined;
    let rows: Record<SkillPosition, SkillPlayer[]> = SKILL_UNITS;
    if (player) {
      list = host.playerList;
    } else {
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
    let teamName: string | null = null;
    try {
      teamName = SPORT.teamName ? (SPORT.teamName(player, position, rows) ?? null) : (extras(player).teamName ?? null);
    } catch {
      teamName = extras(player).teamName ?? null;
    }
    const text = SPORT.careerOnly ? 'Career' : isLiveSeason(season) ? 'This Season' : SPORT.seasonText(season);
    const logo = logoForSeason(player.teamLogo, season);
    return {
      key: `${season}/${gsisId}`,
      season,
      gsisId,
      color,
      player,
      name: player.name,
      surname: surname(player.name),
      seasonText: text,
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
    const position = this.position!;
    const pctOf = (side: CompareSide, id: string) => side.skills.find((s) => s.id === id)?.pct ?? null;

    // (the skills any of them has, in the sport's order)
    const skills = SKILLS[position]
      .filter((def) => sides.some((s) => pctOf(s, def.id) !== null))
      .map((def) => {
        const pcts = sides.map((s) => pctOf(s, def.id));
        return { id: def.id, name: def.name, short: def.short, pcts, leaders: leadersOf(pcts) };
      });

    // (the radar: the skills all of them have)
    const common = skills.filter((s) => s.pcts.every((p) => p !== null));
    let radarView: CompareView['radar'] = null;
    if (common.length >= 3) {
      const base = radar(sides[0].skills.filter((s) => common.some((c) => c.id === s.id)).sort((a, b) => order(position, a.id) - order(position, b.id)));
      radarView = {
        base,
        shapes: sides.map((side, i) => {
          const points = radarShape(common.map((c) => c.pcts[i]!));
          const dots = points.split(' ').map((p) => {
            const [x, y] = p.split(',').map(Number);
            return { x, y };
          });
          return { color: side.color, points, dots };
        }),
      };
    }

    // (edges: where a side beats the best of the others by 10 points or more)
    const edges = sides.map((_, i) =>
      sides.length < 2
        ? []
        : skills
            .map((s) => {
              const mine = s.pcts[i];
              const others = s.pcts.filter((p, j) => j !== i && p !== null) as number[];
              return mine === null || !others.length ? null : { skill: s.name, by: Math.round((mine - Math.max(...others)) * 100) };
            })
            .filter((e): e is { skill: string; by: number } => !!e && e.by >= 10)
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

    // (the grid's columns, each side's value against its own season)
    const shown: SkillStatGroup[] = this.host.shownGroups(this.host.reader, position);
    const wins = sides.map(() => 0);
    let contested = 0;
    const groups = shown
      .map((group) => {
        const rows = group.stats
          .filter((stat) => stat.format !== 'recent')
          .map((stat): CompareRow => {
            const lowerBetter = stat.format === 'rank' || (!!stat.negative && !stat.support);
            const cells = sides.map((side): CompareCell => {
              // (another season's card leaves out the values from other tabs, which are the table's season's)
              if (side.context && SPORT.tableSeasonOnly?.(stat)) return { text: '-', pct: null, rank: null, of: 0, tint: null };
              const value = side.reader.value(side.player, stat);
              const text = side.reader.format(side.player, stat);
              if (value === null || stat.infoOnly) return { text, pct: null, rank: null, of: 0, tint: null };
              const values = side.list.map((p) => side.reader.value(p, stat)).filter((v): v is number => v !== null);
              const rank = 1 + values.filter((v) => (lowerBetter ? v < value : v > value)).length;
              return { text, pct: rankPct(rank, values.length), rank, of: values.length, tint: side.reader.valueColor(side.player, stat) };
            });
            const trait = !stat.infoOnly && (!stat.support || !!stat.supportHelps);
            const leaders = sides.length > 1 ? leadersOf(cells.map((c) => c.pct)) : [];
            if (trait && leaders.length) {
              contested++;
              if (leaders.length === 1) wins[leaders[0]]++;
            }
            return { key: stat.key, label: this.host.reader.label(stat), name: this.host.reader.name(stat), cells, leaders, trait };
          })
          .filter((row) => row.cells.some((c) => c.text !== '-'));
        return { id: group.id, title: group.title, icon: group.icon, rows };
      })
      .filter((g) => g.rows.length);

    this.view = { skills, radar: radarView, edges, pairs, groups, wins, contested };
    this.arcs = this.buildArcs();
  }

  // Every side's seasons (the default sliders' rank in each, the careers file's), its year in the league
  // along the bottom (a team tab: the seasons themselves), the compared season ringed
  private buildArcs(): CompareArcs | null {
    const sides = this.sides.filter((s) => s.career?.length);
    if (!sides.length || SPORT.careerOnly) return null;
    const byYear = !SPORT.teamTabs?.includes(this.position!);
    const xOf = (side: CompareSide, line: CardSeason) => (byYear ? side.career!.findIndex((c) => c.season === line.season) + 1 : line.season);
    const xs = sides.flatMap((s) => s.career!.map((c) => xOf(s, c)));
    const [lo, hi] = [Math.min(...xs), Math.max(...xs, Math.min(...xs) + 1)];
    const { width, height, left, right, top, bottom } = ARC;
    const px = (x: number) => Math.round((left + ((x - lo) / (hi - lo)) * (width - left - right)) * 10) / 10;
    const py = (pct: number) => Math.round((top + (1 - pct) * (height - top - bottom)) * 10) / 10;
    const step = Math.max(1, Math.ceil((hi - lo + 1) / 12));
    const xTicks: CompareArcs['xTicks'] = [];
    for (let x = lo; x <= hi; x += step) xTicks.push({ x: px(x), label: byYear ? `Yr ${x}` : `’${String(x).slice(-2)}` });
    const yTicks = [1, 0.75, 0.5, 0.25, 0].map((p) => ({ y: py(p), label: p === 1 ? 'Top' : p === 0 ? 'Last' : `${Math.round(p * 100)}%` }));
    const lines = sides.map((side) => {
      const career = side.career!;
      const dots = career.map((c) => ({
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
  // The search: everyone the tab has had, by name
  // ---------------------------------------------------------------------------
  private index: { position: SkillPosition; entries: (CompareHit & { key: string; seasons: number })[] } | null = null;

  async search(query: string): Promise<void> {
    this.query = query;
    const words = normalize(query).split(' ').filter(Boolean);
    if (!words.length || words.join('').length < 2) {
      this.hits = [];
      this.searched = false;
      return;
    }
    const entries = await this.entries();
    if (query !== this.query) return;
    const scored = entries
      .filter((e) => words.every((w) => e.key.includes(w)))
      .map((e) => ({ e, starts: e.key.split(' ').some((part) => part.startsWith(words[0])) ? 1 : 0 }))
      .sort((a, b) => b.starts - a.starts || rankPct(b.e.best.rank, b.e.best.of) - rankPct(a.e.best.rank, a.e.best.of));
    this.hits = scored.slice(0, 8).map((s) => s.e);
    this.searched = true;
  }

  private async entries(): Promise<(CompareHit & { key: string; seasons: number })[]> {
    const position = this.position!;
    if (this.index?.position === position) return this.index.entries;
    const [names, careers, current] = await Promise.all([
      this.data.careerNames().catch(() => ({}) as Awaited<ReturnType<SeasonDataService['careerNames']>>),
      this.data.careers(position).catch(() => ({})),
      this.host.season === CURRENT_SEASON ? Promise.resolve(SKILL_UNITS) : this.data.rows(CURRENT_SEASON),
    ]);
    const byId = new Map<string, { name: string; espnId: number | null; seasons: { season: number; logo: string; rank: number; of: number }[] }>();
    const tabNames = names[position] ?? {};
    for (const [id, lines] of Object.entries(careers)) {
      const [name, espnId] = tabNames[id] ?? [];
      if (!name) continue;
      byId.set(id, { name, espnId: espnId ?? null, seasons: lines.map(([season, logo, , rank, of]) => ({ season, logo: SPORT.teamLogo(logo), rank, of })) });
    }
    // (the season being played, ranked with the default sliders like the careers file's)
    const rows = current[position] ?? [];
    const ranked = defaultRanking(position, presetWeights(position, 'default'), current);
    for (const row of rows) {
      const line = { season: CURRENT_SEASON, logo: row.teamLogo, rank: ranked.indexOf(row) + 1, of: ranked.length };
      const known = byId.get(row.gsisId);
      if (known) {
        if (!known.seasons.some((s) => s.season === CURRENT_SEASON)) known.seasons.push(line);
      } else byId.set(row.gsisId, { name: row.name, espnId: row.id ?? null, seasons: [line] });
    }
    const entries = [...byId.entries()].map(([id, e]) => {
      const seasons = [...e.seasons].sort((a, b) => a.season - b.season);
      const best = seasons.reduce((b, s) => (s.rank > 0 && (!b || rankPct(s.rank, s.of) > rankPct(b.rank, b.of)) ? s : b), null as (typeof seasons)[0] | null) ?? seasons.at(-1)!;
      const first = seasons[0].season;
      const last = seasons.at(-1)!.season;
      const logo = logoForSeason(best.logo, best.season);
      return {
        id,
        key: normalize(e.name),
        name: e.name,
        photo: this.host.headshot({ id: e.espnId }, 120),
        logo: SPORT.cardLogo ? SPORT.cardLogo(logo) : logo,
        badge: badgeColor(best.logo),
        whiteLogo: whiteLogo(best.logo),
        span: SPORT.careerOnly ? '' : first === last ? SPORT.seasonText(first) : `${first}-${last}`,
        best: { season: best.season, rank: best.rank, of: best.of },
        seasons: seasons.length,
      };
    });
    this.index = { position, entries };
    return entries;
  }

  // A hit picked: their best season in (another of theirs from the tape's season picker)
  async pick(hit: CompareHit): Promise<void> {
    this.query = '';
    this.hits = [];
    this.searched = false;
    await this.add(hit.best.season, hit.id);
  }

  private say(text: string): void {
    this.note = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => (this.note = ''), 2400);
  }
}

// The best of a few percentiles: every side at the top (ties), none when fewer than two have one
function leadersOf(pcts: (number | null)[]): number[] {
  const known = pcts.filter((p): p is number => p !== null);
  if (known.length < 2) return [];
  const top = Math.max(...known);
  if (known.every((p) => p === top)) return [];
  return pcts.map((p, i) => (p === top ? i : -1)).filter((i) => i >= 0);
}

function order(position: SkillPosition, id: string): number {
  return SKILLS[position].findIndex((def) => def.id === id);
}

// "Kenneth Walker III" -> "Walker"
function surname(name: string): string {
  const parts = name.split(' ').filter((p) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p));
  return parts.at(-1) ?? name;
}

// A name for matching: lowercase, accents and punctuation off ("Ja'Marr" finds "jamarr")
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
