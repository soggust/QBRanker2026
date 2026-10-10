import { Component, HostListener, OnDestroy, inject } from '@angular/core';
import { POSITIONS, SkillPlayer, SkillPosition } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { badgeColor, whiteLogo } from '@sport/team-colors';
import { logoForSeason } from '@sport/logo-eras';
import { SITE_SPORTS } from '@ranker/core/sports';
import { CURRENT_SEASON, SEASONS, dataPart, dataSeason, isLiveSeason } from '@ranker/engine/data';
import { SKILL_UNITS, DEFAULT_SPORT_SETTINGS } from '@ranker/engine/unit-scoring';
import { SeasonDataService } from '@ranker/engine/season-data.service';
import { PositionService } from '@ranker/engine/position.service';
import { AccountService } from '../account.service';
import { Profile, errorMessage } from '../account-helpers';
import { canUse } from '../features';
import { logoUrl } from '../lists/lists-helpers';
import { CommunityStore, EntryCard } from './community.store';
import { ConsensusRow, Maker, boardKey, boardWithLists, byScore, consensus, leaderboard } from './community-helpers';

// (#community/<tab>/<season>: the board asked for; the rankings' tab and the current season otherwise)
export function readCommunityHash(hash: string): { tab: string | null; season: number | null } {
  const [, tab, season] = /^#?community(?:\/([^/]+))?(?:\/(\d{4}))?/.exec(hash) ?? [];
  return { tab: tab ? decodeURIComponent(tab) : null, season: season ? Number(season) : null };
}

interface PlayerInfo {
  name: string;
  logo: string | null;
  teamLogo: string | null;
  photo: string | null;
}

// The Community (#community): pick a sport, a tab and a season; the consensus ranking everyone's
// submitted lists add up to (a Borda count, worked out here from the entries: each player's points, his
// average place and how many lists have him), then the lists themselves as cards, best voted first, with
// up and down votes (one per person per list, not on your own), and the list makers with the most votes
// on the sport's boards that season.
@Component({
  selector: 'community-page',
  templateUrl: './community-page.component.html',
  styleUrls: ['../../../styles/components/account-lists.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class CommunityPageComponent implements OnDestroy {
  readonly account = inject(AccountService);
  private readonly store = inject(CommunityStore);
  private readonly seasonData = inject(SeasonDataService);
  private readonly positions = inject(PositionService);

  readonly sportId = SPORT.id;
  readonly seasons = SEASONS;
  readonly tabNames = SPORT.tabNames as Record<string, string>;

  tab: string = POSITIONS[0];
  season = CURRENT_SEASON;

  state: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  cards: EntryCard[] = [];
  rows: ConsensusRow[] = [];
  makers: Maker[] | null = null;
  profiles = new Map<string, Profile | null>();
  open = new Set<string>();
  // (the consensus's top 15, or all of it)
  allRows = false;
  voting: string | null = null;
  voteError = '';
  private players = new Map<string, PlayerInfo>();
  private loadCount = 0;
  // (every tab's cards this season, for the leaderboard; this board's are the cards above)
  private seasonCards: EntryCard[][] = [];
  private destroyed = false;

  constructor() {
    void this.account.start().catch(() => undefined);
    this.fromHash();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  // (the board was asked for by its address; otherwise it's a guess, and an empty guess moves on to a
  // position that has lists: see loadMakers)
  private asked = false;

  @HostListener('window:hashchange')
  fromHash(): void {
    const { tab, season } = readCommunityHash(location.hash);
    this.asked = !!tab && this.tabs.includes(tab);
    // (nothing asked for: the tab and season the rankings are on, when this page came from them)
    const shown = this.positions.position as string;
    const shownSeason = this.positions.season;
    const nextTab = this.asked ? tab! : this.tabs.includes(shown) ? shown : this.tabs[0];
    const nextSeason = season && SEASONS.includes(season) ? season : !tab && SEASONS.includes(shownSeason) ? shownSeason : CURRENT_SEASON;
    if (nextTab === this.tab && nextSeason === this.season && this.state !== 'loading') return;
    this.tab = nextTab;
    this.season = nextSeason;
    void this.load();
  }

  // The tabs the sport shows by default (MMA's men's divisions)
  get tabs(): string[] {
    return POSITIONS.filter((tab) => SPORT.tabVisible?.(tab, DEFAULT_SPORT_SETTINGS) ?? true);
  }

  get sports(): { id: string; label: string }[] {
    return SITE_SPORTS.filter((s) => !s.devOnly || canUse('mma'));
  }

  seasonName(season: number): string {
    return isLiveSeason(season) ? `${SPORT.seasonText(season)} (current)` : SPORT.seasonText(season);
  }

  // (how many lists each position's board has this season, once counted)
  listCount(tab: string): number | null {
    const i = this.tabs.indexOf(tab);
    return this.seasonCards.length && i >= 0 ? (this.seasonCards[i]?.length ?? 0) : null;
  }

  get boardName(): string {
    return `${this.tabNames[this.tab] ?? this.tab} · ${SPORT.seasonText(this.season)}`;
  }

  // (a board picked: its address, so it can be shared and the back button works)
  pick(tab: string, season: number): void {
    location.hash = `#community/${encodeURIComponent(tab)}/${season}`;
  }

  // ---------------------------------------------------------------------------
  // A board: its entries and votes, the consensus, the players' names and pictures, the leaderboard
  // ---------------------------------------------------------------------------
  private async load(): Promise<void> {
    const load = ++this.loadCount;
    this.state = 'loading';
    this.error = '';
    this.makers = null;
    this.seasonCards = [];
    this.allRows = false;
    this.open.clear();
    try {
      const [cards] = await Promise.all([this.store.board(boardKey(SPORT.id, this.tab, this.season)), this.loadPlayers()]);
      if (load !== this.loadCount || this.destroyed) return;
      this.cards = byScore(cards);
      this.rows = consensus(cards.map((c) => c.entry));
      if (!this.asked && !cards.length) {
        // (an empty guess: every position counted first, and on to one that has lists)
        await this.loadMakers(load);
        if (load === this.loadCount && !this.destroyed) this.state = 'ready';
        return;
      }
      this.state = 'ready';
      for (const card of cards) {
        if (!this.profiles.has(card.entry.owner)) {
          void this.store.profile(card.entry.owner).then((p) => this.profiles.set(card.entry.owner, p));
        }
      }
      void this.loadMakers(load);
    } catch (error) {
      if (load !== this.loadCount) return;
      console.error('Community', error);
      this.error = errorMessage(error);
      this.state = 'error';
    }
  }

  // The season's rows (names, logos and pictures), else what the entries saved
  private async loadPlayers(): Promise<void> {
    let rows: Record<SkillPosition, SkillPlayer[]>;
    try {
      rows = this.season === dataSeason && dataPart === 'regular' ? SKILL_UNITS : await this.seasonData.rows(this.season);
    } catch {
      rows = {} as Record<SkillPosition, SkillPlayer[]>;
    }
    this.players = new Map(
      (rows[this.tab as SkillPosition] ?? []).map((p) => [
        p.gsisId,
        {
          name: p.name,
          teamLogo: p.teamLogo,
          logo: logoUrl(SPORT.id, logoForSeason(p.teamLogo, this.season)),
          photo: p.id ? SPORT.headshot(p.id, 120) : null,
        },
      ]),
    );
  }

  // The list makers by the votes on their lists across the sport's boards this season (worked out from
  // every tab's entries; an Admin tally can replace it)
  private async loadMakers(load: number): Promise<void> {
    try {
      const boards = await Promise.all(
        this.tabs.map((tab) => (tab === this.tab ? Promise.resolve(this.cards) : this.store.board(boardKey(SPORT.id, tab, this.season)).catch(() => []))),
      );
      if (load !== this.loadCount || this.destroyed) return;
      this.seasonCards = boards;
      // (a guessed board with no lists, when another position has some: that one instead, so a list
      // submitted on another tab isn't hidden behind an empty board)
      const withLists = this.asked ? -1 : boardWithLists(boards.map((b) => b.length), this.tabs.indexOf(this.tab));
      if (withLists >= 0) {
        history.replaceState(null, '', `${location.pathname}${location.search}#community/${encodeURIComponent(this.tabs[withLists])}/${this.season}`);
        this.fromHash();
        return;
      }
      this.makers = leaderboard(boards.flat(), 5);
      for (const maker of this.makers) {
        if (!this.profiles.has(maker.owner)) void this.store.profile(maker.owner).then((p) => this.profiles.set(maker.owner, p));
      }
    } catch {
      this.makers = [];
    }
  }

  player(id: string, card?: EntryCard, i?: number): PlayerInfo {
    const known = this.players.get(id);
    if (known) return known;
    // (not in the season's rows: as the entry saved him)
    for (const c of card ? [card] : this.cards) {
      const at = i !== undefined && card ? i : c.entry.ids.indexOf(id);
      if (at >= 0 && c.entry.names[at]) {
        const teamLogo = c.entry.logos[at] ?? null;
        return { name: c.entry.names[at], teamLogo, logo: logoUrl(SPORT.id, teamLogo), photo: null };
      }
    }
    return { name: 'Unknown player', teamLogo: null, logo: null, photo: null };
  }

  badge(info: PlayerInfo): string | null {
    return info.teamLogo ? badgeColor(info.teamLogo) : null;
  }

  white(info: PlayerInfo): boolean {
    return !!info.teamLogo && whiteLogo(info.teamLogo);
  }

  private photoMisses = new Set<string>();

  photo(id: string, info: PlayerInfo): string | null {
    return info.photo && !this.photoMisses.has(id) ? info.photo : null;
  }

  noPhoto(id: string): void {
    this.photoMisses.add(id);
  }

  rankClass(i: number): string {
    if (i === 0) return 'count top-5';
    if (i < 10) return 'count top-10';
    return 'count';
  }

  avg(row: ConsensusRow): string {
    return row.avgRank.toFixed(row.avgRank % 1 ? 1 : 0);
  }

  ownerProfile(card: EntryCard): Profile | null {
    return this.profiles.get(card.entry.owner) ?? null;
  }

  isMine(card: EntryCard): boolean {
    return this.account.user()?.uid === card.entry.owner;
  }

  listHref(card: EntryCard): string {
    return `#lists/${encodeURIComponent(card.entry.owner)}/${encodeURIComponent(card.entry.listId)}`;
  }

  toggle(card: EntryCard): void {
    if (this.open.has(card.entry.owner)) this.open.delete(card.entry.owner);
    else this.open.add(card.entry.owner);
  }

  // A vote: up or down (the same again takes it back); signed out, the sign-in first; never your own
  async vote(card: EntryCard, value: 1 | -1): Promise<void> {
    if (!this.account.user()) {
      this.account.openLogin();
      return;
    }
    if (this.isMine(card) || this.voting) return;
    const before = { ...card.tally };
    const next = card.tally.mine === value ? 0 : value;
    // (shown at once, put back if it doesn't go through)
    const t = card.tally;
    if (t.mine === 1) t.up--;
    if (t.mine === -1) t.down--;
    if (next === 1) t.up++;
    if (next === -1) t.down++;
    t.mine = next;
    t.score = t.up - t.down;
    this.voting = card.entry.owner;
    this.voteError = '';
    try {
      await this.store.vote(boardKey(SPORT.id, this.tab, this.season), card.entry.owner, next, (card.entry as { submittedAt?: unknown }).submittedAt);
      // (the leaderboard counts it too)
      if (this.seasonCards.length) this.makers = leaderboard(this.seasonCards.flat(), 5);
    } catch (error) {
      card.tally = before;
      this.voteError = errorMessage(error);
    } finally {
      this.voting = null;
    }
  }

  makerProfile(maker: Maker): Profile | null {
    return this.profiles.get(maker.owner) ?? null;
  }
}
