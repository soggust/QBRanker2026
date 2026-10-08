import { Component, HostListener, Input } from '@angular/core';
import { AWARD_INFO } from '@sport/awards';
import { SPORT } from '@sport/sport';
import { whiteLogo } from '@sport/team-colors';
import { CURRENT_SEASON, isLiveSeason } from '@ranker/engine/data';
import { rankPct, rankTone } from '@ranker/core/format';
import { PlayerCard } from './card.model';
import { PlayerCards } from './player-cards';
import { sortFlags } from './overview';
import { evidenceText, insteadText, paragraphs } from './analysis';
import { GameViewService } from '../game-view/game-view.service';
import type { GameLogViewRow } from './game-log-view';

// The player card: a scoreboard panel over the dimmed page, the hero (team card, name, awards, overall
// rank) over the Overview, Stats, Seasons and the sport's history tab. Arrow keys flip through the
// list, Escape closes it.
@Component({
  selector: 'player-card',
  templateUrl: './player-card.component.html',
  // (the shared look: libs/ranker/src/styles/components, plus this sport's card partial)
  styleUrls: ['../../styles/components/player-card.scss'],
  standalone: false,
})
export class PlayerCardComponent {
  @Input({ required: true }) cards!: PlayerCards;

  constructor(readonly games: GameViewService) {}

  // A game log's row: its game (ESPN's id, or its day and the two teams)
  openGame(card: PlayerCard, row: GameLogViewRow): void {
    if (row.event) this.games.open({ event: row.event });
    else if (row.when) this.games.open({ date: row.when, names: [row.vs.split(' ').slice(1).join(' '), (card.player as { teamName?: string | null }).teamName ?? ''].filter(Boolean) });
  }

  readonly sport = SPORT;
  readonly awardInfo = AWARD_INFO;
  readonly currentSeason = CURRENT_SEASON;
  readonly rankTone = rankTone;
  readonly rankPct = rankPct;
  readonly sortFlags = sortFlags;
  readonly paragraphs = paragraphs;
  readonly evidenceText = evidenceText;
  readonly insteadText = insteadText;

  // "2025", "2024-25", or "Current" while it's being played
  seasonName(season: number): string {
    return isLiveSeason(season) ? 'Current' : SPORT.seasonText(season);
  }

  seasonText(season: number): string {
    return SPORT.seasonText(season);
  }

  // Logos drawn in white on the board (e.g. the Giants')
  whiteLogo(teamLogo: string): boolean {
    return whiteLogo(teamLogo);
  }

  // The sport's history rows (SPORT.cardHistory: a fighter's fights), newest first
  historyRows(card: PlayerCard) {
    return SPORT.cardHistory?.rows(card.player) ?? [];
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
    else if (event.key === 'Escape') this.cards.close();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') this.cards.step(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') this.cards.step(-1);
    else return;
    event.preventDefault();
  }
}
