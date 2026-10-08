import { Component, HostListener, Input } from '@angular/core';
import { AWARD_INFO } from '@sport/awards';
import { SPORT } from '@sport/sport';
import { extras, rowTeamNames } from '@ranker/engine/row-fields';
import { recentWord } from '@ranker/engine/stat-reader';
import { whiteLogo } from '@sport/team-colors';
import { CURRENT_SEASON, isLiveSeason } from '@ranker/engine/data';
import { rankPct, rankTone } from '@ranker/core/format';
import { PlayerCard } from './card.model';
import { PlayerCards } from './player-cards';
import { sortFlags } from './overview';
import { evidenceText, insteadText, paragraphs } from './analysis';
import { GameViewService, recentRef } from '../game-view/game-view.service';
import type { GameLogViewRow } from './game-log-view';
import { ZoneStat, ZoneView, pitchColor } from './zones';

// The player card: a scoreboard panel over the dimmed page, the hero (team card, name, awards, overall
// rank) over its tabs (PlayerCards.tabsFor: Overview, Analysis, Team, Stats, Zones, Game Log, the history).
// Escape closes it.
@Component({
  selector: 'player-card',
  templateUrl: './player-card.component.html',
  // (its look is global, kept to its element: styles/_cards.scss)
  standalone: false,
})
export class PlayerCardComponent {
  @Input({ required: true }) cards!: PlayerCards;

  constructor(readonly games: GameViewService) {}

  // The Zones tab's stat showing (the first until another is picked), and a pitch type's color
  zoneStat(view: ZoneView): ZoneStat {
    return view.stats.find((st) => st.key === this.cards.zoneStat) ?? view.stats[0];
  }

  readonly pitchColor = pitchColor;

  // The card's recent games (its Stats tab's Recent): the team, a game's hover ("W 24-17 @ Miami Dolphins"),
  // and a game opened (the card set aside, as from the game log)
  recentTeam(card: PlayerCard): (string | undefined)[] {
    return rowTeamNames(card.player);
  }

  private recentVs(card: PlayerCard): (string | null)[] | undefined {
    return extras(card.player).lastFiveVs;
  }

  recentTitle(card: PlayerCard, result: number, index: number): string {
    const word = recentWord(result, extras(card.player).lastFiveOt?.[index]);
    const vs = this.recentVs(card)?.[index];
    const score = this.games.recentScore(this.recentTeam(card), this.recentVs(card), index, card.season);
    return [word, score, vs ? (/^(@|vs) /.test(vs) ? vs : 'vs ' + vs) : null].filter(Boolean).join(' ');
  }

  // A headshot whose player the site has: his card (like his name)
  openLink(link: { position: string; gsisId: string } | null | undefined, season: number): void {
    if (link) this.cards.openLinked(link, season);
  }

  recentOt(card: PlayerCard, index: number): boolean {
    return !!extras(card.player).lastFiveOt?.[index];
  }

  openRecent(card: PlayerCard, index: number): void {
    const ref = recentRef(this.recentTeam(card), this.recentVs(card), index, card.season);
    if (ref) this.games.open(ref);
  }

  // The card closed (no game to go back to any more)
  close(): void {
    this.games.backTo = null;
    this.cards.close();
  }

  // A game log's row: its game (ESPN's id, or its day and the two teams)
  openGame(card: PlayerCard, row: GameLogViewRow): void {
    if (row.event) this.games.open({ event: row.event });
    else if (row.when) this.games.open({ date: row.when, names: [row.vs.split(' ').slice(1).join(' '), extras(card.player).teamName ?? ''].filter(Boolean) });
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
    else if (event.key === 'Escape') this.close();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') this.cards.step(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') this.cards.step(-1);
    else return;
    event.preventDefault();
  }
}
