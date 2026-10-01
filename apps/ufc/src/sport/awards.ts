import type { AwardInfo } from '@ranker/engine/awards';
import type { SkillPlayer, SkillPosition } from '@sport/positions';

// A fighter's honors under his name: the championship belt (the #1 rank's trophy) for his division's
// champion, and a plaque for his pound-for-pound rank (UFC.com's rankings, read by the data script)
export type AwardId = 'champ' | `p4p${number}`;

const P4P: Record<string, AwardInfo> = Object.fromEntries(
  Array.from({ length: 15 }, (_, i) => [`p4p${i + 1}`, { name: `Pound-for-Pound #${i + 1}`, short: `P4P #${i + 1}` }]),
);

export const AWARD_INFO: Record<string, AwardInfo> = {
  champ: { name: 'Division Champion', short: 'Champ', icon: { name: 'trophy' } },
  ...P4P,
};

export interface AwardWin {
  id: AwardId;
  // Hover text: "Welterweight Champion"
  title: string;
}

const DIVISION_NAMES: Record<SkillPosition, string> = {
  HW: 'Heavyweight',
  LHW: 'Light Heavyweight',
  MW: 'Middleweight',
  WW: 'Welterweight',
  LW: 'Lightweight',
  FW: 'Featherweight',
  BW: 'Bantamweight',
  FLW: 'Flyweight',
  WBW: "Women's Bantamweight",
  WFLW: "Women's Flyweight",
  WSW: "Women's Strawweight",
};

// (no seasons: the UFC's "season" is the career, so it reads "Career")
export const seasonName = (_season: number) => 'Career';

export function awardsFor(unit: SkillPlayer, position: SkillPosition, _season: number): AwardWin[] {
  return (unit.awards ?? []).map((id) =>
    id === 'champ'
      ? { id: 'champ', title: `UFC ${DIVISION_NAMES[position]} Champion` }
      : { id: id as AwardId, title: `UFC ${position.startsWith('W') ? "Women's " : "Men's "}Pound-for-Pound #${id.slice(3)}` },
  );
}
