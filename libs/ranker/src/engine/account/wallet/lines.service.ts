import { Injectable, signal } from '@angular/core';
import { ESPN_LEAGUES } from '../../bets/desk-math';
import { SummaryBox, liveStat } from '../../bets/live-props';
import { EspnEvent, GameBoard, boardOf, espnDay } from './wallet-math';

// Every game's DraftKings lines, from ESPN's free scoreboard (the one the bettor reads when it has no Odds API
// key: espn.mjs linesOf), straight from the browser. A sport's day is asked for once a minute at most; the
// boards land in one signal (by "sport|event") so every board on the page updates together.
@Injectable({ providedIn: 'root' })
export class LinesService {
  private readonly days = new Map<string, { at: number; load: Promise<GameBoard[]> }>();
  private readonly all = signal(new Map<string, GameBoard>());
  readonly boards = this.all.asReadonly();
  // (each sport's day as last loaded: when, for the board's "as of")
  readonly loadedAt = signal<number | null>(null);

  board(sport: string, event: string): GameBoard | undefined {
    return this.all().get(`${sport}|${event}`);
  }

  // A sport's games on a day (ESPN's day: US Eastern), fresh within the last minute
  day(sport: string, day: string, maxAge = 60e3): Promise<GameBoard[]> {
    const key = `${sport}|${day}`;
    const kept = this.days.get(key);
    if (kept && Date.now() - kept.at < maxAge) return kept.load;
    const load = fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_LEAGUES[sport]}/scoreboard?dates=${day}&limit=200`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { events?: EspnEvent[] } | null) => {
        const games = (body?.events ?? []).map((e) => boardOf(sport, e)).filter((g): g is GameBoard => !!g);
        const next = new Map(this.all());
        for (const g of games) next.set(`${sport}|${g.event}`, g);
        this.all.set(next);
        this.loadedAt.set(Date.now());
        return games;
      })
      .catch(() => {
        // (a scoreboard that won't load: tried again next time it's asked for)
        this.days.delete(key);
        return [] as GameBoard[];
      });
    this.days.set(key, { at: Date.now(), load });
    return load;
  }

  // A game's board, by its ESPN id and the day it starts on
  async game(sport: string, event: string, start: string, maxAge = 60e3): Promise<GameBoard | null> {
    await this.day(sport, espnDay(start), maxAge);
    return this.board(sport, event) ?? null;
  }

  // Many games at once: each sport's days asked for once
  async games(list: { sport: string; start: string }[], maxAge = 60e3): Promise<void> {
    const wanted = new Set(list.filter((g) => ESPN_LEAGUES[g.sport]).map((g) => `${g.sport}|${espnDay(g.start)}`));
    await Promise.all([...wanted].map((k) => this.day(k.split('|')[0], k.split('|')[1], maxAge)));
  }

  // A prop's count so far (a game under way or over), from its game's box score (live-props.ts: the reading
  // the grader does); null when it isn't in it
  async propCounts(sport: string, event: string, props: { id: string; propType: string; athlete: string }[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    const body = (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_LEAGUES[sport]}/summary?event=${event}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)) as SummaryBox | null;
    for (const p of props) out.set(p.id, liveStat(sport, p.propType, p.athlete, body));
    return out;
  }
}
