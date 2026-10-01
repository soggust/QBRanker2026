// How an award shows under a name: a plaque with its short name, or an icon in a metal (silver unless
// it says): a cup (titles: gold for the champion), a flag (a pennant) or a star (an All-Star). Each
// sport lists its awards (apps/<sport>/src/sport/awards.ts) this way.
export interface AwardInfo {
  name: string;
  short: string;
  icon?: { name: 'trophy' | 'emoji_events' | 'flag' | 'star'; metal?: 'gold' | 'silver' | 'bronze' };
}
