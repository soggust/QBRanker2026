// espn-api.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { StaticData } from 'StaticData/StaticData';
import { Player } from 'app/types';

@Injectable({
  providedIn: 'root',
})
export class EspnApiService {
  private apiUrl =
    'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/types/2/athletes';
  playerIds: number[] = StaticData.map((player) => player.id);
  playerStats$: Observable<Player[]>;

  constructor(private http: HttpClient) {
    // Bundle API Calls
    // Skip players with no stats this season (ESPN returns 404) so one miss doesn't fail the whole list
    const observables = this.playerIds.map((playerId) =>
      this.http.get(`${this.apiUrl}/${playerId}/statistics`).pipe(
        map((response) => this.mapPlayerStats(response, playerId)),
        catchError(() => {
          console.log('No stats found for player id: ' + playerId);
          return of(null);
        })
      )
    );
    this.playerStats$ = forkJoin(observables).pipe(
      map((players) => players.filter((player): player is Player => !!player))
    );
  }

  // Map Player Stats To Usable Object
  mapPlayerStats(rawStats: any, id: number): Player {
    const generalStats = rawStats.splits.categories.find(
      (category) => category.name === 'general'
    );
    const passingStats = rawStats.splits.categories.find(
      (category) => category.name === 'passing'
    );
    const rushingStats = rawStats.splits.categories.find(
      (category) => category.name === 'rushing'
    );

    const games = generalStats.stats.find(
      (stat) => stat.name === 'gamesPlayed'
    ).value;
    const fumbles = generalStats.stats.find(
      (stat) => stat.name === 'fumblesLost'
    ).value;

    const passTouchdowns = passingStats.stats.find(
      (stat) => stat.name === 'passingTouchdowns'
    ).value;
    const passYards = passingStats.stats.find(
      (stat) => stat.name === 'passingYards'
    ).value;
    const ypa = passingStats.stats.find(
      (stat) => stat.name === 'yardsPerPassAttempt'
    ).value;
    const compPercent = passingStats.stats.find(
      (stat) => stat.name === 'completionPct'
    ).value;
    const interceptions = passingStats.stats.find(
      (stat) => stat.name === 'interceptions'
    ).value;
    const rating = passingStats.stats.find(
      (stat) => stat.name === 'QBRating'
    ).value;

    const rushingYards = rushingStats.stats.find(
      (stat) => stat.name === 'rushingYards'
    ).value;
    const rushingTds = rushingStats.stats.find(
      (stat) => stat.name === 'rushingTouchdowns'
    ).value;

    const staticData = StaticData.find((data) => {
      return data.id === id;
    });

    if (staticData && games != staticData.wins + staticData.losses) {
      console.log(
        'More games than games started for player: ' + staticData.name
      );
    }

    return {
      name: staticData ? staticData.name : '',
      teamLogo: staticData ? staticData.teamLogo : '',
      compPercent: compPercent.toFixed(1),
      passYards: passYards,
      rushYards: rushingYards,
      passTd: passTouchdowns,
      rushTd: rushingTds,
      ypa: ypa.toFixed(1),
      ints: interceptions,
      fumLost: fumbles,
      rating: rating,
      epaPerPlay: staticData ? staticData.epaPerPlay : null,
      cpoe: staticData ? staticData.cpoe : null,
      successRate: staticData ? staticData.successRate : null,
      fantasyStd: staticData ? staticData.fantasyStd : null,
      receptions: staticData ? staticData.receptions : 0,
      wins: staticData ? staticData.wins : 0,
      losses: staticData ? staticData.losses : 0,
      ties: staticData ? staticData.ties : 0,
      games: games,
      id: id,
      lastFive: staticData ? staticData.lastFive : [0, 0, 0, 0, 0],
      injured: staticData ? staticData.injured : false,
      weapons: staticData ? staticData.weapons : 0,
      coaching: staticData ? staticData.coaching : 0,
      oline: staticData ? staticData.oline : 0,
      defense: staticData ? staticData.defense : 6,
      defenseOverride: staticData?.defenseOverride,
      responsibility: staticData ? staticData.responsibility : 0,
      outOfDate:
        staticData &&
        games < staticData.wins + staticData.losses + (staticData.ties ?? 0)
          ? true
          : false,
    };
  }
}
