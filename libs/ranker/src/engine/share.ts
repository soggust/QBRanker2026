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
}

const PARAM = 'list';

// (JSON as URL-safe base64, and back)
const encode = (data: unknown): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data))))
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
}
