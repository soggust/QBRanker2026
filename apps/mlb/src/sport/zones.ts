// MLB's Zones tab: a player's season by zone, from MLB's stats API (free; the Statcast era, 2015 on). A
// pitcher's pitches, and the average, slugging and OPS against him, in each of the zone's nine boxes and
// the four corners outside it, with his arsenal (each pitch's share, speed and count); a hitter's
// average, slugging, OPS and exit velocity by zone. Each zone keeps MLB's own hot or cold color.
import type { ZoneStat, ZoneView } from '@ranker/engine/player-card/zones';

const API = 'https://statsapi.mlb.com/api/v1/people';

// The stats shown, in order, and their names
const PITCHER: [string, string][] = [
  ['numberOfPitches', 'Pitches'],
  ['battingAverage', 'AVG Against'],
  ['sluggingPercentage', 'SLG Against'],
  ['onBasePlusSlugging', 'OPS Against'],
  ['numberOfStrikes', 'Strikes'],
];
const HITTER: [string, string][] = [
  ['battingAverage', 'AVG'],
  ['sluggingPercentage', 'SLG'],
  ['onBasePlusSlugging', 'OPS'],
  ['exitVelocity', 'Exit Velo'],
  ['onBasePercentage', 'OBP'],
];

export const PITCHERS = ['SP', 'RP'];

interface ZonesResponse {
  stats?: { splits?: { stat?: { name?: string; zones?: { zone: string; value: string; color: string }[] } }[] }[];
}
interface ArsenalResponse {
  stats?: { splits?: { stat?: { type?: { description?: string }; percentage?: number; averageSpeed?: number; count?: number } }[] }[];
}

export async function loadZones(id: number, position: string, season: number): Promise<ZoneView> {
  const pitcher = PITCHERS.includes(position);
  const group = pitcher ? 'pitching' : 'hitting';
  const [zones, arsenal] = await Promise.all([
    fetch(`${API}/${id}/stats?stats=hotColdZones&season=${season}&group=${group}`).then((r) => (r.ok ? (r.json() as Promise<ZonesResponse>) : ({} as ZonesResponse))),
    pitcher
      ? fetch(`${API}/${id}/stats?stats=pitchArsenal&season=${season}&group=pitching`).then((r) => (r.ok ? (r.json() as Promise<ArsenalResponse>) : ({} as ArsenalResponse)))
      : Promise.resolve({} as ArsenalResponse),
  ]);
  const byName = new Map((zones.stats?.[0]?.splits ?? []).map((s) => [s.stat?.name ?? '', s.stat?.zones ?? []]));
  const stats: ZoneStat[] = (pitcher ? PITCHER : HITTER)
    .filter(([key]) => byName.get(key)?.length)
    .map(([key, label]) => {
      const list = byName.get(key)!;
      const num = (zone: string, of: string) => Number(byName.get(of)?.find((z) => z.zone === zone)?.value) || 0;
      // (the counts MLB doesn't color, as rates: a zone's share of all his pitches; its pitches that were strikes)
      const counts = list.every((z) => !z.color);
      if (!counts) return { key, label, zones: Object.fromEntries(list.map((z) => [z.zone, { value: z.value, color: z.color }])) };
      const total = list.reduce((sum, z) => sum + (Number(z.value) || 0), 0) || 1;
      const rate = (z: { zone: string; value: string }) =>
        key === 'numberOfStrikes' ? (Number(z.value) || 0) / (num(z.zone, 'numberOfPitches') || 1) : (Number(z.value) || 0) / total;
      const rates = list.map(rate);
      const most = Math.max(...rates, 0.0001);
      return {
        key,
        label: key === 'numberOfStrikes' ? 'Strike %' : 'Pitch %',
        zones: Object.fromEntries(
          list.map((z, i) => [z.zone, { value: `${(rates[i] * 100).toFixed(1)}%`, color: `rgba(214, 41, 52, ${(0.1 + 0.62 * (rates[i] / most)).toFixed(2)})` }]),
        ),
      };
    });
  return {
    kind: pitcher ? 'pitcher' : 'hitter',
    stats,
    arsenal: (arsenal.stats?.[0]?.splits ?? [])
      .map((s) => ({
        type: s.stat?.type?.description ?? '',
        share: s.stat?.percentage ?? 0,
        mph: s.stat?.averageSpeed ?? null,
        count: s.stat?.count ?? 0,
      }))
      .filter((p) => p.type && p.count)
      .sort((a, b) => b.share - a.share),
  };
}
