// The player card's tabs, one component each (the card switches between them: player-card.component.html)
import { Component } from '@angular/core';
import { SPORT } from '@sport/sport';
import { extras, rowTeamNames } from '@ranker/engine/row-fields';
import { recentWord } from '@ranker/engine/stat-reader';
import { recentRef } from '../../game-view/game-view.service';
import { evidenceText, insteadText, paragraphs } from '../analysis';
import { PlayerCard } from '../card.model';
import type { GameLogViewRow } from '../game-log-view';
import { sortFlags } from '../overview';
import { ZoneStat, ZoneView, pitchColor } from '../zones';
import { CardTab } from './card-tab';

// Stats: each group a panel of stat tiles; Recent's W/L squares open their games
@Component({ selector: 'card-stats', templateUrl: './stats.component.html', standalone: false })
export class CardStatsTab extends CardTab {
  // The card's team (its Recent squares' games), a square's hover ("W 24-17 @ Miami Dolphins"), and a game
  // opened (the card set aside, as from the game log)
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

  // (decided past regulation: a lighter square)
  recentOt(card: PlayerCard, index: number): boolean {
    return !!extras(card.player).lastFiveOt?.[index];
  }

  openRecent(card: PlayerCard, index: number): void {
    const ref = recentRef(this.recentTeam(card), this.recentVs(card), index, card.season);
    if (ref) this.games.open(ref);
  }
}

// Overview: the archetype, flags, the skill radar, the scouting report, similar seasons
@Component({ selector: 'card-overview', templateUrl: './overview.component.html', standalone: false })
export class CardOverviewTab extends CardTab {
  readonly sortFlags = sortFlags;

  // A breakdown split's league tick after part i: the league's shares up to and including it
  splitAt(parts: { league: number }[], i: number): number {
    return parts.slice(0, i + 1).reduce((a, p) => a + p.league, 0);
  }
}

// Analysis: the AI write-up
@Component({ selector: 'card-analysis', templateUrl: './analysis.component.html', standalone: false })
export class CardAnalysisTab extends CardTab {
  readonly paragraphs = paragraphs;
  readonly evidenceText = evidenceText;
  readonly insteadText = insteadText;
}

// Team: the depth chart, special teams, coaches, changes, everyone who's played
@Component({ selector: 'card-team', templateUrl: './team.component.html', standalone: false })
export class CardTeamTab extends CardTab {
  // A headshot whose player the site has: his card (like his name)
  openLink(link: { position: string; gsisId: string } | null | undefined, season: number): void {
    if (link) this.cards.openLinked(link, season);
  }
}

// Zones (MLB's): the season by zone, the arsenal
@Component({ selector: 'card-zones', templateUrl: './zones.component.html', standalone: false })
export class CardZonesTab extends CardTab {
  readonly pitchColor = pitchColor;

  // The stat showing (the first until another is picked)
  zoneStat(view: ZoneView): ZoneStat {
    return view.stats.find((st) => st.key === this.cards.zoneStat) ?? view.stats[0];
  }
}

// Game Log: the season's games (a result opens its game) and the games to come
@Component({ selector: 'card-games', templateUrl: './games.component.html', standalone: false })
export class CardGamesTab extends CardTab {
  // A row's game: ESPN's id, or its day and the two teams
  openGame(card: PlayerCard, row: GameLogViewRow): void {
    if (row.event) this.games.open({ event: row.event });
    else if (row.when) this.games.open({ date: row.when, names: [row.vs.split(' ').slice(1).join(' '), extras(card.player).teamName ?? ''].filter(Boolean) });
  }
}

// The sport's history (SPORT.cardHistory: a fighter's fights), newest first
@Component({ selector: 'card-history', templateUrl: './history.component.html', standalone: false })
export class CardHistoryTab extends CardTab {
  historyRows(card: PlayerCard) {
    return SPORT.cardHistory?.rows(card.player) ?? [];
  }
}

// Seasons: the career arc and a line per season, each opening that season's card
@Component({ selector: 'card-seasons', templateUrl: './seasons.component.html', standalone: false })
export class CardSeasonsTab extends CardTab {}

export const CARD_TABS = [CardStatsTab, CardOverviewTab, CardAnalysisTab, CardTeamTab, CardZonesTab, CardGamesTab, CardHistoryTab, CardSeasonsTab];
