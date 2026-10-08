// The card's Zones tab (a sport's: SPORT.zones, MLB's): a player's season by zone, the strike zone's nine
// boxes and the four corners outside it, each a value in its hot or cold color, for each stat the sport
// keeps (a pitcher's pitches, average and slugging against; a hitter's average, slugging, exit
// velocity); and a pitcher's arsenal: each pitch type's share, speed and count.

export interface ZoneStat {
  key: string;
  label: string;
  // by zone ("01"-"09" the boxes, left to right and top down from the catcher's view; "11"-"14" the
  // corners outside: top left, top right, bottom left, bottom right)
  zones: Record<string, { value: string; color: string }>;
}

export interface ZoneView {
  kind: 'pitcher' | 'hitter';
  stats: ZoneStat[];
  arsenal: { type: string; share: number; mph: number | null; count: number }[];
}

// Each pitch type's color (the game view's pitch chart and the card's arsenal; the rest grey)
export const PITCH_COLORS: Record<string, string> = {
  'Four-seam FB': '#ff5a4f',
  'Four-Seam Fastball': '#ff5a4f',
  Fastball: '#ff5a4f',
  Sinker: '#ff9f40',
  'Two-seam FB': '#ff9f40',
  'Two-Seam Fastball': '#ff9f40',
  Cutter: '#c9875a',
  Slider: '#ffd54a',
  Sweeper: '#d4b400',
  Slurve: '#b9d04a',
  Curve: '#5ab4ff',
  Curveball: '#5ab4ff',
  'Knuckle Curve': '#3d8bd9',
  Changeup: '#3ecf6e',
  Splitter: '#2fd3c5',
  'Split-Finger': '#2fd3c5',
  Forkball: '#2fd3c5',
  Knuckleball: '#b48cff',
  Eephus: '#e0e0e0',
};

export const pitchColor = (type: string): string => PITCH_COLORS[type] ?? '#9aa0a6';
