// A list shared by its link: the tab and season are in the address already (?pos=, ?season=); the rest of
// what makes the list yours goes in ?list=, only what differs from the defaults (so a link stays short):
// each tab's sliders, the stats and groups switched off, the settings menu's settings and the sport's own.
// Opening the link applies them, then takes ?list= out of the address (from then on the list is yours to
// change). No accounts: the link is the whole of it.
import { POSITIONS, SkillPosition, StatGroupId, presetWeights } from '@sport/positions';
import { DEFAULT_SPORT_SETTINGS } from '@ranker/engine/unit-scoring';
import type { PositionService, RankerSettings } from '@ranker/engine/position.service';

interface Shared {
  v: 1;
  // each tab's sliders that differ from its defaults
  w?: Record<string, Record<string, number>>;
  // the stats switched off ("QB.passYards")
  h?: string[];
  // each tab's groups switched off
  g?: Record<string, string[]>;
  // the settings menu's settings that differ, and the sport's own
  s?: Partial<Omit<RankerSettings, 'sport'>>;
  sp?: Record<string, string | boolean>;
  // the grid as it looks (PositionService.layout): each tab's hand-dragged order, collapsed groups,
  // dragged columns ("QB.box") and the sidebar's card order
  o?: Record<string, string[]>;
  c?: Record<string, string[]>;
  k?: Record<string, string[]>;
  go?: Record<string, string[]>;
}

const PARAM = 'list';

// (JSON as URL-safe base64, and back; byte by byte, not spread: a list with long dragged orders can
// pass the engine's limit on a call's arguments)
const encode = (data: unknown): string =>
  btoa(Array.from(new TextEncoder().encode(JSON.stringify(data)), (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const decode = (code: string): unknown => {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
};

// The link to this list as it is now
export function shareLink(service: PositionService, defaults: RankerSettings): string {
  const shared: Shared = { v: 1 };
  for (const position of POSITIONS as SkillPosition[]) {
    const base = presetWeights(position, 'default');
    const now = service.getWeights(position) ?? {};
    const changed = Object.entries(now).filter(([key, value]) => (base as Record<string, number>)[key] !== value);
    if (changed.length) (shared.w ??= {})[position] = Object.fromEntries(changed);
    const groups = Object.entries(service.skillHiddenGroups(position)).filter(([, off]) => off).map(([id]) => id);
    if (groups.length) (shared.g ??= {})[position] = groups;
  }
  const eyes = Object.entries(service.statHiddenState).filter(([, off]) => off).map(([key]) => key);
  if (eyes.length) shared.h = eyes;
  const settings = service.settings;
  const own = Object.entries(settings).filter(([key, value]) => key !== 'sport' && defaults[key as keyof RankerSettings] !== value);
  if (own.length) shared.s = Object.fromEntries(own);
  const sport = Object.entries(settings.sport).filter(([key, value]) => DEFAULT_SPORT_SETTINGS[key] !== value);
  if (sport.length) shared.sp = Object.fromEntries(sport);
  const layout = service.layout;
  const some = (record: Record<string, string[]>) => {
    const kept = Object.entries(record).filter(([, list]) => list?.length);
    return kept.length ? Object.fromEntries(kept) : undefined;
  };
  shared.o = some(layout.orders);
  shared.c = some(layout.collapsed);
  shared.k = some(layout.columns);
  shared.go = some(layout.groups);
  for (const key of ['o', 'c', 'k', 'go'] as const) if (!shared[key]) delete shared[key];

  const url = new URL(location.href);
  url.hash = '';
  if (Object.keys(shared).length > 1) url.searchParams.set(PARAM, encode(shared));
  else url.searchParams.delete(PARAM);
  return url.toString();
}

// A shared list opened: its sliders, eyes, groups and settings applied (anything it names that the site
// doesn't have any more left out), then ?list= taken out of the address
export function applySharedLink(service: PositionService, defaults: RankerSettings): void {
  const url = new URL(location.href);
  const code = url.searchParams.get(PARAM);
  if (!code) return;
  url.searchParams.delete(PARAM);
  history.replaceState(null, '', url);
  let shared: Shared;
  try {
    shared = decode(code) as Shared;
  } catch {
    return;
  }
  if (shared?.v !== 1) return;
  const tabs = new Set<string>(POSITIONS);
  for (const [position, weights] of Object.entries(shared.w ?? {})) {
    if (!tabs.has(position)) continue;
    const sliders = Object.fromEntries(Object.entries(weights).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 100));
    service.saveWeights(position as SkillPosition, { ...service.getWeights(position as SkillPosition), ...sliders });
  }
  for (const key of shared.h ?? []) {
    const [position, stat] = key.split('.');
    if (tabs.has(position) && stat) service.setStatHidden(position as SkillPosition, stat, true);
  }
  for (const [position, ids] of Object.entries(shared.g ?? {})) {
    if (tabs.has(position)) for (const id of ids) service.setSkillGroupHidden(position as SkillPosition, id as StatGroupId, true);
  }
  // (only settings the site has, of the same kind as their defaults)
  const known = <T extends object>(values: Record<string, unknown> | undefined, base: T): Partial<T> =>
    Object.fromEntries(
      Object.entries(values ?? {}).filter(([key, value]) => {
        if (!(key in base)) return false;
        const was = (base as Record<string, unknown>)[key];
        // (a setting whose default is none, like Min Games' count: a number or none)
        return was === null ? value === null || typeof value === 'number' : typeof value === typeof was;
      }),
    ) as Partial<T>;
  const settings = known(shared.s, defaults);
  const sport = known(shared.sp, DEFAULT_SPORT_SETTINGS);
  service.updateSettings({ ...settings, sport: { ...service.settings.sport, ...sport } as RankerSettings['sport'] });

  // (the grid's look: only tabs the site has, and lists of names)
  const lists = (record: Record<string, unknown> | undefined, tab = (key: string) => key) =>
    Object.fromEntries(
      Object.entries(record ?? {}).filter(([key, list]) => tabs.has(tab(key)) && Array.isArray(list) && list.every((x) => typeof x === 'string')),
    ) as Record<string, string[]>;
  service.applyLayout({
    orders: lists(shared.o),
    collapsed: lists(shared.c),
    columns: lists(shared.k, (key) => key.split('.')[0]),
    groups: lists(shared.go) as Record<string, StatGroupId[]>,
  });
}

// A comparison shared by its link (?cmp=, on top of the list's own link: the sides ranked with the same
// sliders): each side as tab.season.id, "_" between them (an address leaves it as it is), the compare tab
// first when it isn't Overview ("stats_QB.2007.QB-1428_RB.2013.00-0011869"). The id is last, so it can
// hold anything ("_" and "%" kept out of it by escaping them).
export const COMPARE_PARAM = 'cmp';

export interface SharedSide {
  position: SkillPosition;
  season: number;
  gsisId: string;
}

export interface SharedCompare {
  sides: SharedSide[];
  tab: string;
}

export function compareCode({ sides, tab }: SharedCompare): string {
  const items = sides.map((s) => `${s.position}.${s.season}.${s.gsisId.replace(/%/g, '%25').replace(/_/g, '%5F')}`);
  return (tab === 'overview' ? items : [tab, ...items]).join('_');
}

// ...and read back: only the tabs and seasons the site has, each side once (the compare view takes the
// first four, and the tab when it has it); junk reads as nobody
export function readCompareCode(code: string, seasons: number[]): SharedCompare {
  const shared: SharedCompare = { sides: [], tab: 'overview' };
  const positions = new Set<string>(POSITIONS);
  code.split('_').forEach((item, i) => {
    const [, position, season, id] = item.match(/^([^.]+)\.(\d+)\.(.+)$/) ?? [];
    if (!id) {
      if (i === 0) shared.tab = item;
      return;
    }
    let gsisId: string;
    try {
      gsisId = decodeURIComponent(id);
    } catch {
      return;
    }
    const side = { position: position as SkillPosition, season: Number(season), gsisId };
    const twice = shared.sides.some((s) => s.position === side.position && s.season === side.season && s.gsisId === gsisId);
    if (positions.has(position) && seasons.includes(side.season) && !twice) shared.sides.push(side);
  });
  return shared;
}
