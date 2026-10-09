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

  // (a split's pie: each part a slice in its own soft color: the NFL's WRs a blue, TEs a sea green, backs a gold)
  pieColor(i: number): string {
    return ['#8ab4e0', '#7fc8bb', '#e3cb8f'][i] ?? '#9aa0a6';
  }

  // The pie's slice under the pointer (its popover); null: none
  pieHover: number | null = null;

  // (each part's slice as an SVG path on a 100 x 100 box, clockwise from the top, with where its share
  // sits inside it)
  pieSlices(parts: { share: number }[]): { d: string; color: string; x: number; y: number; pct: string }[] {
    const total = parts.reduce((a, p) => a + p.share, 0) || 1;
    const point = (a: number, r: number) => [50 + r * Math.sin(a), 50 - r * Math.cos(a)].map((v) => Math.round(v * 100) / 100);
    let at = 0;
    return parts.map((p, i) => {
      const from = at;
      at += (p.share / total) * 2 * Math.PI;
      const [x0, y0] = point(from, 50);
      const [x1, y1] = point(at, 50);
      // (a big slice's share nearer the middle, clear of its edges)
      const [x, y] = point((from + at) / 2, at - from > 2.2 ? 24 : 31);
      const d = at - from >= 2 * Math.PI - 1e-6 ? 'M50,0 A50,50 0 1 1 49.99,0 Z' : `M50,50 L${x0},${y0} A50,50 0 ${at - from > Math.PI ? 1 : 0} 1 ${x1},${y1} Z`;
      return { d, color: this.pieColor(i), x, y, pct: `${Math.round(p.share * 100)}%` };
    });
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
  // A team log's points-for or points-against column (each shown on an LED tile); null for any other (a
  // player's PA, MLB's plate appearances, isn't one: only a log with PF has them)
  scoreSide(columns: { label: string }[], i: number): 'PF' | 'PA' | null {
    const label = columns[i]?.label;
    return (label === 'PF' || label === 'PA') && columns.some((c) => c.label === 'PF') ? label : null;
  }

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
