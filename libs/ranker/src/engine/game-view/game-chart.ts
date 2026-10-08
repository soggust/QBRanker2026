// The game view's chart, by sport: shots on a court or a rink, balls in play on a diamond (and the pitches),
// the NFL's drives and passes by zone

import { EspnPlay, EspnSummary } from './espn-summary';
import { GameArsenal, GameChart, GameDrive, GameMark, GamePassZone, GamePitch } from './game.model';

const PASS_ZONES = ['deep left', 'deep middle', 'deep right', 'short left', 'short middle', 'short right'];

export function gameChart(
  league: string,
  s: EspnSummary,
  sideOf: (id: string | undefined) => 'away' | 'home' | null,
  people: Map<string, { side: 'away' | 'home'; name: string }>,
): GameChart | null {
  // (ESPN marks a play it couldn't place far off the board)
  const placed = (c: { x?: number; y?: number } | undefined): c is { x: number; y: number } =>
    !!c && typeof c.x === 'number' && typeof c.y === 'number' && Math.abs(c.x) < 1000 && Math.abs(c.y) < 1000;

  // (the play's shooter or batter by the box score: ESPN's scorer, shooter or batter, else its first named)
  const who = (p: EspnPlay): string | null => {
    const parts = p.participants ?? [];
    const one = parts.find((x) => x.type === 'shooter' || x.type === 'scorer' || x.type === 'batter') ?? parts[0];
    return people.get(one?.athlete?.id ?? '')?.name ?? null;
  };

  if (league.includes('basketball')) {
    const marks: GameMark[] = [];
    for (const p of s.plays ?? []) {
      const side = sideOf(p.team?.id);
      // (free throws are placed at the line: not shots from the floor)
      if (!p.shootingPlay || !side || !placed(p.coordinate) || /free throw/i.test(p.text ?? '')) continue;
      marks.push({ x: p.coordinate.x, y: p.coordinate.y + 4, side, result: p.scoringPlay ? 'made' : 'missed', text: p.text ?? '', player: who(p) });
    }
    return marks.length ? { kind: 'court', marks } : null;
  }

  if (league.includes('hockey')) {
    const marks: GameMark[] = [];
    for (const p of s.plays ?? []) {
      const kind = p.type?.text ?? '';
      const side = sideOf(p.team?.id);
      if (!/^(Shot|Goal|Missed|Blocked)$/.test(kind) || !side || !placed(p.coordinate)) continue;
      // (each team attacking its own end: away to the left, home to the right)
      let { x, y } = p.coordinate;
      if ((side === 'home' && x < 0) || (side === 'away' && x > 0)) {
        x = -x;
        y = -y;
      }
      marks.push({ x: x + 100, y: 42.5 - y, side, result: kind === 'Goal' ? 'goal' : 'missed', text: p.text ?? '', player: who(p) });
    }
    return marks.length ? { kind: 'rink', marks } : null;
  }

  if (league.includes('baseball')) {
    // Each at-bat's result (its "play result" row: what happened, "Home Run", and how far, "(372 feet)")
    const results = new Map<string, EspnPlay>();
    for (const p of s.plays ?? []) if (p.type?.type === 'play-result' && p.atBatId) results.set(p.atBatId, p);
    const marks: GameMark[] = [];
    const placedAtBats = new Set<string>();
    for (const p of s.plays ?? []) {
      const side = sideOf(p.team?.id);
      if (!side || !placed(p.hitCoordinate)) continue;
      // (one mark an at-bat: ESPN repeats the spot on its rows)
      if (p.atBatId) {
        if (placedAtBats.has(p.atBatId)) continue;
        placedAtBats.add(p.atBatId);
      }
      const res = p.atBatId ? results.get(p.atBatId) : undefined;
      const kind = res?.alternativeType?.text ?? p.type?.text ?? '';
      const result = /home run/i.test(kind) ? 'hr' : /single|double|triple/i.test(kind) ? 'hit' : 'out';
      const feet = res?.text?.match(/\((\d+) feet\)/)?.[1];
      const player = who(res ?? p);
      const short = player ? player.replace(/^(\S)\S*\s+/, '$1. ') : null;
      // ("HR (398 ft) · K. Marte", "Fly Out · K. Marte")
      const text = [`${result === 'hr' ? 'HR' : kind}${feet ? ` (${feet} ft)` : ''}`, short].filter(Boolean).join(' · ');
      marks.push({ x: p.hitCoordinate.x, y: p.hitCoordinate.y, side, result, text, player });
    }
    // Every pitch with a type and a spot: who threw it (his team by the box score), and how it came out
    const pitches: GamePitch[] = [];
    for (const p of s.plays ?? []) {
      const type = p.pitchType?.text;
      const pitcher = people.get(p.participants?.find((x) => x.type === 'pitcher')?.athlete?.id ?? '');
      if (!type || !pitcher || !placed(p.pitchCoordinate)) continue;
      const kind = p.type?.type ?? '';
      const result = /^ball/.test(kind) || /pitchout|hit-by/.test(kind) ? 'ball' : /strike|foul/.test(kind) ? 'strike' : 'play';
      pitches.push({ x: p.pitchCoordinate.x, y: p.pitchCoordinate.y, side: pitcher.side, pitcher: pitcher.name, type, mph: p.pitchVelocity ?? null, result });
    }
    // Each pitcher's arsenal
    const byPitcher = new Map<string, GamePitch[]>();
    for (const p of pitches) byPitcher.set(p.side + p.pitcher, [...(byPitcher.get(p.side + p.pitcher) ?? []), p]);
    const arsenals: GameArsenal[] = [...byPitcher.values()]
      .map((list) => {
        const byType = new Map<string, GamePitch[]>();
        for (const p of list) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
        return {
          side: list[0].side,
          pitcher: list[0].pitcher,
          pitches: list.length,
          types: [...byType.entries()]
            .map(([type, ps]) => {
              const speeds = ps.map((p) => p.mph).filter((v): v is number => v !== null);
              return { type, share: ps.length / list.length, mph: speeds.length ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10 : null };
            })
            .sort((a, b) => b.share - a.share),
        };
      })
      .sort((a, b) => (a.side === b.side ? b.pitches - a.pitches : a.side === 'away' ? -1 : 1));
    return marks.length || pitches.length ? { kind: 'diamond', marks, pitches, arsenals } : null;
  }

  if (league.includes('football')) {
    // Every pass in the play-by-play, by its zone ("D.Jones pass short left to K.Allen ... for 7 yards")
    const teams = new Map<'away' | 'home', { passers: Set<string>; zones: Map<string, GamePassZone> }>();
    for (const d of s.drives?.previous ?? []) {
      const side = sideOf(d.team?.id);
      if (!side) continue;
      for (const p of d.plays ?? []) {
        const text = p.text ?? '';
        const m = text.match(/([A-Z][\w'.-]*\.?\s?[A-Z][\w'.-]+) pass (incomplete )?(short|deep) (left|middle|right)/);
        if (!m || /no play/i.test(text)) continue;
        const team = teams.get(side) ?? { passers: new Set<string>(), zones: new Map(PASS_ZONES.map((key) => [key, { key, att: 0, comp: 0, yds: 0, td: 0, int: 0 }])) };
        teams.set(side, team);
        team.passers.add(m[1]);
        const zone = team.zones.get(`${m[3]} ${m[4]}`)!;
        zone.att++;
        if (/INTERCEPTED/i.test(text)) zone.int++;
        else if (!m[2]) {
          zone.comp++;
          const yds = text.match(/for (-?\d+) yards?/);
          zone.yds += yds ? Number(yds[1]) : 0;
          if (/TOUCHDOWN/i.test(text)) zone.td++;
        }
      }
    }
    // Every drive, start to end
    const drives: GameDrive[] = (s.drives?.previous ?? [])
      .map((d) => ({
        side: sideOf(d.team?.id),
        quarter: d.start?.period?.number ?? 0,
        start: d.start?.yardLine,
        end: d.end?.yardLine,
        result: d.displayResult ?? d.result ?? '',
        scoring: !!d.isScore,
        label: `Q${d.start?.period?.number ?? ''} ${d.start?.clock?.displayValue ?? ''} · ${d.offensivePlays ?? 0} plays, ${d.yards ?? 0} yds`,
      }))
      .filter((d): d is GameDrive => !!d.side && typeof d.start === 'number' && typeof d.end === 'number');
    const out = (['away', 'home'] as const)
      .filter((side) => teams.has(side))
      .map((side) => ({ side, passers: [...teams.get(side)!.passers], zones: [...teams.get(side)!.zones.values()] }));
    return out.length || drives.length ? { kind: 'football', drives, teams: out } : null;
  }
  return null;
}
