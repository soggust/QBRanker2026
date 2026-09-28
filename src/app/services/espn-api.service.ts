// espn-api.service.ts

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { StaticData } from 'StaticData/StaticData';
import { Player, StaticPlayerData } from 'app/types';

// QB stats come from the nightly data update (games.json), which fetches ESPN's box stats in the
// same run as the game results, so a QB's stats and record always change together. QBs with no
// ESPN stats this season yet are left out, as before.
@Injectable({
  providedIn: 'root',
})
export class EspnApiService {
  playerStats$: Observable<Player[]> = of(
    StaticData.filter((data) => !!data.box).map((data) => this.toPlayer(data)),
  );

  // Map the stored stats to the QB table's player object
  private toPlayer(data: StaticPlayerData): Player {
    const box = data.box!;
    return {
      name: data.name,
      teamLogo: data.teamLogo,
      compPercent: Number(box.compPercent.toFixed(1)),
      passYards: box.passYards,
      rushYards: box.rushYards,
      passTd: box.passTd,
      rushTd: box.rushTd,
      ypa: Number(box.ypa.toFixed(1)),
      ints: box.ints,
      fumLost: box.fumLost,
      rating: box.rating,
      epaPerPlay: data.epaPerPlay,
      cpoe: data.cpoe,
      successRate: data.successRate,
      fantasyStd: data.fantasyStd,
      receptions: data.receptions,
      pressureToSack: data.pressureToSack,
      badThrowPct: data.badThrowPct,
      timeToThrow: data.timeToThrow,
      adot: data.adot,
      aggressiveness: data.aggressiveness,
      wins: data.wins,
      losses: data.losses,
      ties: data.ties,
      games: box.games,
      id: data.id,
      lastFive: data.lastFive,
      injured: data.injured,
      weapons: data.weapons,
      coaching: data.coaching,
      oline: data.oline,
      defense: data.defense,
      defenseOverride: data.defenseOverride,
      coachingOverride: data.coachingOverride,
      responsibility: data.responsibility,
      // Box stats and results come from the same run now, so this only flags a QB whose ESPN
      // games count trails his starts (an ESPN stat correction still in progress)
      outOfDate: box.games < data.wins + data.losses + (data.ties ?? 0),
    };
  }
}
