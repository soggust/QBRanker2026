// Min (settings menu): players with less than a share of the season so far are left out. The setting is
// a percent (0 means 1: everyone, then steps of MIN_SHARE_STEP), of the most playing time anyone on the
// tab has (the sport's measure, SPORT.playingTime: games, plate appearances), so it scales with the
// season: 10% is a game or two early on and a real cutoff by the end. A sport can make it a fixed count
// instead (SPORT.playingTime.fixed: MMA's fights).
import { SkillPlayer, SkillPosition } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { MIN_SHARE_STEP, RankerSettings } from '@ranker/engine/position.service';

// What the share is of: the most playing time anyone on the tab has, or the sport's season length
export function seasonLength(rows: Record<string, SkillPlayer[]>, position: SkillPosition): number {
  const length = SPORT.playingTime.seasonLength;
  return length ? length(rows, position) : Math.max(1, ...(rows[position] ?? []).map((p) => SPORT.playingTime.of(p)));
}

// The tab has a minimum (not the sport's team tabs, where everyone plays every game)
export function hasMin(position: SkillPosition): boolean {
  return !SPORT.playingTime.everyone?.includes(position);
}

// The cutoff: the share of a total, rounded (never under 1), or the sport's fixed count
export function minCount(settings: RankerSettings, total: number): number {
  const fixed = SPORT.playingTime.fixed;
  if (fixed) return settings.minCount ?? fixed.default;
  return settings.minShare ? Math.max(1, Math.round((settings.minShare / 100) * total)) : 1;
}

// The setting a step up or down gives (null: it can't move that way). A step moves the cutoff by
// MIN_SHARE_STEP of the season, or a whole game when that's less (early in a season 10% is under a game,
// and it took several clicks to move it at all); the setting stays a share, so it keeps scaling as the
// season goes. A fixed count moves by its own step.
export function steppedMin(settings: RankerSettings, total: number, step: number): Partial<RankerSettings> | null {
  const count = minCount(settings, total);
  const fixed = SPORT.playingTime.fixed;
  if (fixed) {
    const next = Math.min(total, Math.max(1, count + Math.sign(step) * fixed.step));
    return next === count ? null : { minCount: next };
  }
  const moved = Math.min(total, Math.max(1, count + Math.sign(step) * Math.max(1, Math.round((total * MIN_SHARE_STEP) / 100))));
  const next = moved <= 1 ? 0 : Math.min(100, (moved / total) * 100);
  return next === settings.minShare ? null : { minShare: next };
}
