import type { SkillPlayer } from '@sport/positions';
import { FieldMapRole, FieldMapView, FieldMapsFile, PackedFieldMaps, expandFieldMaps, fieldMapView } from '@ranker/engine/player-card/field-map';

// The card's Field Map (SPORT.fieldMap): field-maps.json, a season's throws, targets, runs, kicks and punts
// by where on the field they went (scripts/build-field-maps.mjs: data/field-maps.json for the season being
// played, data/seasons/<year>/field-maps.json before it), packed; read back once a season and kept

const ROLES: FieldMapRole[] = ['QB', 'RB', 'WR', 'TE', 'K', 'P', 'DEF'];

const files = new Map<number, Promise<FieldMapsFile | null>>();

// (none when the season has no file: a missing one is a 404, or the site's page in its place, not JSON)
function fieldMapsFile(season: number, current: boolean): Promise<FieldMapsFile | null> {
  let file = files.get(season);
  if (!file) {
    const path = current ? 'data/field-maps.json' : `data/seasons/${season}/field-maps.json`;
    file = fetch(path, { cache: current ? 'no-cache' : 'default' })
      .then(async (res) => (res.ok ? expandFieldMaps((await res.json()) as PackedFieldMaps) : null))
      .catch(() => null);
    files.set(season, file);
  }
  return file;
}

// The rows that have one: a QB, a back, a receiver, a kicker, a punter, a defense
export const hasFieldMap = (player: SkillPlayer, position: string): boolean => ROLES.includes(position as FieldMapRole) && !!player.gsisId;

export async function loadFieldMap(player: SkillPlayer, position: string, season: number, part: 'regular' | 'post' | 'all', current: boolean): Promise<FieldMapView | null> {
  const section = (await fieldMapsFile(season, current))?.[part];
  // (a QB's row is keyed by his ESPN id)
  const stats = player.stats as Record<string, number | null | undefined>;
  const count = (key: string) => (typeof stats?.[key] === 'number' ? (stats[key] as number) : undefined);
  return section ? fieldMapView(section, position as FieldMapRole, [player.gsisId, player.id], { carries: count('carries'), targets: count('targets') }) : null;
}
