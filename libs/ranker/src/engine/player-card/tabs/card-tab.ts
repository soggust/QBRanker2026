import { Directive, Input, inject } from '@angular/core';
import { SPORT } from '@sport/sport';
import { whiteLogo } from '@sport/team-colors';
import { CURRENT_SEASON, isLiveSeason } from '@ranker/engine/data';
import { ordinal, rankPct, rankTone } from '@ranker/core/format';
import { GameViewService } from '../../game-view/game-view.service';
import { PlayerCard } from '../card.model';
import { PlayerCards } from '../player-cards';

// What every tab of the player card has: the card it's showing (c, as the card's own template calls it),
// the cards (their state and actions), the game view, and the helpers their templates share. A tab's host
// element lays out as if it weren't there (display: contents, player-card.scss), so the tab's panels sit
// in the card's body as they always have.
@Directive()
export abstract class CardTab {
  @Input({ required: true }) c!: PlayerCard;
  @Input({ required: true }) cards!: PlayerCards;

  readonly games = inject(GameViewService);

  readonly sport = SPORT;
  readonly currentSeason = CURRENT_SEASON;
  readonly rankTone = rankTone;
  readonly rankPct = rankPct;

  // "2025", "2024-25", or "Current" while it's being played
  seasonName(season: number): string {
    return isLiveSeason(season) ? 'Current' : SPORT.seasonText(season);
  }

  seasonText(season: number): string {
    return SPORT.seasonText(season);
  }

  // A 0-1 standing as a hover's words: "88th percentile"
  pctText(pct: number): string {
    return `${ordinal(Math.max(1, Math.min(99, Math.round(pct * 100))))} percentile`;
  }

  // Logos drawn in white on the board (e.g. the Giants')
  whiteLogo(teamLogo: string): boolean {
    return whiteLogo(teamLogo);
  }
}
