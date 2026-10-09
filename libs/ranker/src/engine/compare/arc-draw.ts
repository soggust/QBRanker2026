import type { CompareArcs } from './player-compare';

// The career arcs drawn in: one sweep left to right across the board, every line's head at the same x at
// the same time (a line starting further right starts when the sweep gets there), each season's dot
// landing as the head reaches it, each line's face riding its head, then settling just past its end

// (the sweep's length, start to the last face settled)
export const ARC_DRAW_MS = 3300;

// A face's ride: its offset from where it rests (translate), at each point of the sweep (0 to 1)
export interface FaceKey {
  offset: number;
  dx: number;
  dy: number;
}

export interface ArcDraw {
  // (the sweep's x, start and end: the board's left edge to the last face at rest)
  from: number;
  to: number;
  // When each line's dots land (lines', then dots' order: the sweep's fraction)
  dots: number[][];
  // Each face: when it shows (its line's first point reached), its ride, and when it's at rest (its tie
  // drawn then)
  faces: { start: number; rest: number; keys: FaceKey[] }[];
}

// The sweep for a board: when every dot lands, where every face is along the way
export function arcDraw(arcs: CompareArcs): ArcDraw {
  const from = arcs.left;
  const to = Math.max(from + 1, ...arcs.faces.map((f) => f.x), ...arcs.lines.flatMap((l) => l.dots.map((d) => d.x)));
  const at = (x: number) => Math.min(1, Math.max(0, (x - from) / (to - from)));
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  const dots = arcs.lines.map((l) => l.dots.map((d) => round(at(d.x))));
  const faces = arcs.faces.map((face, i) => {
    // (its line's points, then the place it rests)
    const path = [...(arcs.lines[i]?.dots ?? []), { x: face.x, y: face.y }].sort((a, b) => a.x - b.x);
    const keys: FaceKey[] = path.map((p) => ({ offset: round(at(p.x)), dx: round(p.x - face.x), dy: round(p.y - face.y) }));
    // (held at its first point before, at rest after)
    if (keys[0].offset > 0) keys.unshift({ ...keys[0], offset: 0 });
    if (keys[keys.length - 1].offset < 1) keys.push({ offset: 1, dx: 0, dy: 0 });
    return { start: round(at(path[0].x)), rest: round(at(face.x)), keys };
  });
  return { from, to, dots, faces };
}
