// How an award shows under a name: a plaque with its short name, or (titles) an icon: a cup, gold for
// the champion, or a flag. Each sport lists its awards (apps/<sport>/src/sport/awards.ts) this way.
export interface AwardInfo {
  name: string;
  short: string;
  icon?: { name: 'emoji_events' | 'flag'; gold?: boolean };
}
