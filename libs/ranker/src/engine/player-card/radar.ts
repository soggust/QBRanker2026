// The Overview's skill radar: its geometry in a 320 x 290 box centered on 0,0. An axis per skill
// clockwise from the top, rings at 25 / 50 / 75 / 100%, and a skill's point out along its axis by its
// percentile (from a small hub, so a 0 doesn't vanish into the center).
import { CardSkill } from '@ranker/engine/skills';
import { CardRadar } from './card.model';

const RADIUS = 100;

function point(i: number, n: number, pct: number): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const r = RADIUS * (0.1 + 0.9 * pct);
  return [Math.round(Math.cos(angle) * r * 10) / 10, Math.round(Math.sin(angle) * r * 10) / 10];
}

// A shape's points (an SVG polygon's): one percentile per axis
export function radarShape(pcts: number[]): string {
  return pcts.map((p, i) => point(i, pcts.length, p).join(',')).join(' ');
}

export function radar(skills: CardSkill[]): CardRadar {
  const n = skills.length;
  const axes = skills.map((skill, i) => {
    const [x, y] = point(i, n, 1);
    const [lx, ly] = point(i, n, 1.24);
    const anchor = Math.abs(lx) < 8 ? 'middle' : lx > 0 ? 'start' : 'end';
    return { x, y, lx, ly: ly + 4, anchor, label: skill.short, pct: skill.pct };
  });
  return {
    axes,
    rings: [0.25, 0.5, 0.75, 1].map((p) => radarShape(skills.map(() => p))),
    shape: radarShape(skills.map((s) => s.pct)),
    dots: skills.map((s, i) => {
      const [x, y] = point(i, n, s.pct);
      return { x, y, pct: s.pct };
    }),
  };
}
