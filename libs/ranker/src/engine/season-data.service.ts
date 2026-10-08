// Other seasons' data, for the player card (and Rookies Only): fetched when first asked for, then kept
// for the visit. A failed fetch is forgotten, so the next ask tries again.
import { Injectable } from '@angular/core';
import { SkillPlayer, SkillPosition } from '@sport/positions';
import { CURRENT_SEASON, fetchSeason, fetchSeasonFile } from '@ranker/engine/data';
import { unitsForSeason } from '@ranker/engine/unit-scoring';
import { CareersFile, CompsFile } from '@ranker/engine/player-card/card.model';

// A file checked with the server each visit: {} when it isn't there (a tab without any; the host's page
// fallback answers a missing file with the app's page, not JSON), a failure thrown (asked
// again next time)
function fetchOrEmpty<T>(url: string): Promise<T> {
  return fetch(url, { cache: 'no-cache' }).then((res) => (res.ok ? res.json().catch(() => ({}) as T) : res.status === 404 ? ({} as T) : Promise.reject(new Error(String(res.status)))));
}

@Injectable({ providedIn: 'root' })
export class SeasonDataService {
  private cache = new Map<string, Promise<unknown>>();

  private once<T>(key: string, load: () => Promise<T>, retry = true): Promise<T> {
    let data = this.cache.get(key) as Promise<T> | undefined;
    if (!data) {
      data = load();
      if (retry) data.catch(() => this.cache.delete(key));
      this.cache.set(key, data);
    }
    return data;
  }

  // A season's rows, every tab
  rows(season: number): Promise<Record<SkillPosition, SkillPlayer[]>> {
    return this.once(`rows.${season}`, () => fetchSeason(season).then((data) => unitsForSeason(data, season)));
  }

  // One tab's rows for a finished season (a small file per tab)
  tabRows(season: number, position: SkillPosition): Promise<SkillPlayer[]> {
    return this.once(`tab.${season}.${position}`, () => fetchSeasonFile<SkillPlayer[]>(season, `units/${position}.json`));
  }

  // A tab's finished seasons, each one's (checked with the server each visit: it changes once a year, at
  // the season rollover; none for a tab without any)
  careers(position: SkillPosition): Promise<CareersFile> {
    return this.once(`careers.${position}`, () => fetchOrEmpty<CareersFile>(`data/careers/${position}.json`));
  }

  // Everyone's first season in the data (Rookies Only)
  firstSeasons(): Promise<Record<string, number>> {
    return this.once('first-seasons', () => fetchOrEmpty<Record<string, number>>('data/careers/first-seasons.json'));
  }

  // A finished season's similar seasons
  comps(season: number): Promise<CompsFile> {
    return this.once(`comps.${season}`, () => fetchSeasonFile<CompsFile>(season, 'comps.json'), false);
  }

  // A season's extra file (the sport's card extras); missing reads as empty: not every season has one
  extraFile<T>(season: number, file: string): Promise<T> {
    return this.once(
      `extra.${season}/${file}`,
      () => (season === CURRENT_SEASON ? Promise.resolve({}) : fetchSeasonFile(season, file).catch(() => ({}))) as Promise<T>,
    );
  }
}
