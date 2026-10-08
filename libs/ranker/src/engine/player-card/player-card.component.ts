import { Component, HostListener, Input } from '@angular/core';
import { AWARD_INFO } from '@sport/awards';
import { whiteLogo } from '@sport/team-colors';
import { rankPct, rankTone } from '@ranker/core/format';
import { PlayerCards } from './player-cards';
import { GameViewService } from '../game-view/game-view.service';

// The player card: a scoreboard panel over the dimmed page, the hero (team card, name, awards, overall
// rank) over its tabs (PlayerCards.tabsFor: Overview, Analysis, Team, Stats, Zones, Game Log, the history),
// each its own component (tabs/card-tabs.ts). Escape closes it.
@Component({
  selector: 'player-card',
  templateUrl: './player-card.component.html',
  // (its look is global, kept to its element: styles/_cards.scss)
  standalone: false,
})
export class PlayerCardComponent {
  @Input({ required: true }) cards!: PlayerCards;

  constructor(readonly games: GameViewService) {}

  readonly awardInfo = AWARD_INFO;
  readonly rankTone = rankTone;
  readonly rankPct = rankPct;

  // The card closed (no game to go back to any more)
  close(): void {
    this.games.backTo = null;
    this.cards.close();
  }

  // Logos drawn in white on the board (e.g. the Giants')
  whiteLogo(teamLogo: string): boolean {
    return whiteLogo(teamLogo);
  }

  // A spot's popover (everyone at a depth chart spot) shuts on a click anywhere outside its spot
  @HostListener('document:click', ['$event'])
  outside(event: MouseEvent): void {
    if (this.games.game) return;
    if (this.cards.depthOpen && !(event.target as Element | null)?.closest?.('.depth-slot')) this.cards.depthOpen = null;
  }

  @HostListener('document:keydown', ['$event'])
  keys(event: KeyboardEvent): void {
    // (a game open over the card has the keys)
    if (!this.cards.card || this.games.game) return;
    // (Escape shuts an open popover first, then the card)
    if (event.key === 'Escape' && this.cards.depthOpen) this.cards.depthOpen = null;
    else if (event.key === 'Escape') this.close();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') this.cards.step(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') this.cards.step(-1);
    else return;
    event.preventDefault();
  }
}
