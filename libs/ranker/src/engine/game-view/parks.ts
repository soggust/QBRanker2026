// Baseball parks' outfield walls, for the spray chart: each park's distances in feet down the left-field
// line, to left-center, center, right-center and down the right-field line (the published ones, rounded),
// found by the venue's name (any of its names over the years); the 2000 season on, today's parks and the
// ones since replaced. A park not here gets a standard one. Most walls are straight runs between their
// corners; the round ones (the multipurpose bowls and a few others) are drawn as an arc.
const PARKS: [RegExp, [number, number, number, number, number]][] = [
  [/yankee stadium|steinbrenner/i, [318, 399, 408, 385, 314]],
  [/fenway/i, [310, 379, 390, 420, 302]],
  [/camden yards|oriole park/i, [333, 384, 400, 373, 318]],
  [/tropicana/i, [315, 370, 404, 370, 322]],
  [/rogers centre|skydome/i, [328, 375, 400, 375, 328]],
  [/progressive field|jacobs field/i, [325, 370, 400, 375, 325]],
  [/comerica/i, [345, 370, 412, 365, 330]],
  [/kauffman/i, [330, 387, 410, 387, 330]],
  [/target field/i, [339, 377, 404, 367, 328]],
  [/metrodome|humphrey/i, [343, 385, 408, 367, 327]],
  [/rate field|guaranteed rate|u\.s\. cellular|comiskey/i, [330, 375, 400, 375, 335]],
  [/minute maid|daikin|enron|astros field/i, [315, 362, 409, 373, 326]],
  [/angel stadium|edison/i, [347, 390, 396, 370, 350]],
  [/coliseum|network associates|mcafee|overstock|ringcentral/i, [330, 388, 400, 388, 330]],
  [/sutter health/i, [330, 388, 403, 388, 325]],
  [/t-mobile park|safeco/i, [331, 378, 401, 381, 326]],
  [/globe life field/i, [329, 372, 407, 374, 326]],
  [/globe life park|rangers ballpark|ameriquest|ballpark in arlington/i, [332, 390, 400, 377, 325]],
  [/truist|suntrust/i, [335, 385, 400, 375, 325]],
  [/turner field/i, [335, 380, 400, 390, 330]],
  [/loandepot|marlins park/i, [344, 386, 400, 387, 335]],
  [/pro player|dolphin|sun life|land shark/i, [330, 385, 404, 385, 345]],
  [/citi field/i, [335, 379, 408, 383, 330]],
  [/shea/i, [338, 371, 410, 371, 338]],
  [/citizens bank/i, [329, 374, 401, 369, 330]],
  [/veterans stadium/i, [330, 371, 408, 371, 330]],
  [/nationals park/i, [336, 377, 402, 370, 335]],
  [/rfk|robert f\. kennedy/i, [335, 380, 410, 380, 335]],
  [/olympic stadium|stade olympique/i, [325, 375, 404, 375, 325]],
  [/wrigley/i, [355, 368, 400, 368, 353]],
  [/great american/i, [328, 379, 404, 370, 325]],
  [/cinergy|riverfront/i, [325, 370, 404, 370, 325]],
  [/american family|miller park/i, [344, 371, 400, 374, 345]],
  [/pnc park/i, [325, 389, 399, 375, 320]],
  [/three rivers/i, [335, 375, 400, 375, 335]],
  [/busch stadium/i, [336, 375, 400, 375, 335]],
  [/chase field|bank one/i, [330, 374, 407, 374, 334]],
  [/coors/i, [347, 390, 415, 375, 350]],
  [/dodger stadium/i, [330, 375, 395, 375, 330]],
  [/petco/i, [336, 390, 396, 391, 322]],
  [/qualcomm|jack murphy/i, [327, 370, 405, 370, 327]],
  [/oracle park|at&t park|sbc park|pac bell/i, [339, 364, 399, 421, 309]],
];
const STANDARD: [number, number, number, number, number] = [330, 375, 400, 375, 330];

// The parks with a round wall, a smooth arc from pole to pole
const ROUND = /shea|veterans stadium|cinergy|riverfront|three rivers|olympic stadium|stade olympique|dodger stadium|kauffman|qualcomm|jack murphy|rfk|robert f. kennedy|tropicana|rogers centre|skydome|coliseum|network associates|mcafee|overstock|ringcentral|angel stadium|edison|metrodome|humphrey/i;

// The park's wall: its five distances (left line to right line)
export function parkWall(venue: string | null | undefined): [number, number, number, number, number] {
  return PARKS.find(([name]) => name.test(venue ?? ''))?.[1] ?? STANDARD;
}

// The spray chart's scale: ESPN's units (Gameday's) are about 2.39 feet, home plate at (125.2, 204.5), up
// the field
export const FEET_PER_UNIT = 2.39;
export const HOME: [number, number] = [125.2, 204.5];

// A spot on the field by its distance (feet) and its angle from the left-field line (0) to the right (90)
export function fieldSpot(feet: number, angle: number): [number, number] {
  const a = ((135 - angle) * Math.PI) / 180;
  const r = feet / FEET_PER_UNIT;
  return [HOME[0] + r * Math.cos(a), HOME[1] - r * Math.sin(a)];
}

// The wall through its five points, and the foul lines out to it: straight runs corner to corner; a round
// park's a smooth curve through them (Catmull-Rom)
export function wallPath(venue: string | null | undefined): { wall: string; left: [number, number]; right: [number, number] } {
  const d = parkWall(venue);
  const points = d.map((feet, i) => fieldSpot(feet, i * 22.5));
  const p = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  let path = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  if (!ROUND.test(venue ?? '')) {
    for (const [x, y] of points.slice(1)) path += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    return { wall: path, left: points[0], right: points[points.length - 1] };
  }
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { wall: path, left: points[0], right: points[points.length - 1] };
}

// ---- the current parks traced (MLB's Gameday diagrams, by GeomMLBStadiums: apps/mlb/scripts/
// build-parks.mjs): a venue's park by its names, from the season it opened (the old Busch Stadium shared
// its name with today's)
const TRACED: [RegExp, string, number?][] = [
  [/yankee stadium|steinbrenner/i, 'yankees'],
  [/fenway/i, 'red_sox'],
  [/camden yards|oriole park/i, 'orioles'],
  [/tropicana/i, 'rays'],
  [/rogers centre|skydome/i, 'blue_jays'],
  [/progressive field|jacobs field/i, 'guardians'],
  [/comerica/i, 'tigers'],
  [/kauffman/i, 'royals'],
  [/target field/i, 'twins'],
  [/rate field|guaranteed rate|u\.s\. cellular|comiskey/i, 'white_sox'],
  [/minute maid|daikin|enron|astros field/i, 'astros'],
  [/angel stadium|edison/i, 'angels'],
  [/coliseum|network associates|mcafee|overstock|ringcentral/i, 'athletics'],
  [/t-mobile park|safeco/i, 'mariners'],
  [/globe life field/i, 'rangers'],
  [/truist|suntrust/i, 'braves'],
  [/loandepot|marlins park/i, 'marlins'],
  [/citi field/i, 'mets'],
  [/citizens bank/i, 'phillies'],
  [/nationals park/i, 'nationals'],
  [/wrigley/i, 'cubs'],
  [/great american/i, 'reds'],
  [/american family|miller park/i, 'brewers'],
  [/pnc park/i, 'pirates'],
  [/busch stadium/i, 'cardinals', 2006],
  [/chase field|bank one/i, 'diamondbacks'],
  [/coors/i, 'rockies'],
  [/dodger stadium/i, 'dodgers'],
  [/petco/i, 'padres'],
  [/oracle park|at&t park|sbc park|pac bell/i, 'giants'],
];

export interface TracedPark {
  wall: string;
  infield: string | null;
  fouls: string | null;
}

// The traced parks, loaded once (MLB's data file; none in another sport's)
let traced: Promise<Record<string, TracedPark>> | null = null;
export function loadTracedParks(): Promise<Record<string, TracedPark>> {
  traced ??= fetch('data/parks.json')
    .then((r) => (r.ok ? r.json() : { teams: {} }))
    .then((j) => (j.teams ?? {}) as Record<string, TracedPark>)
    .catch(() => ({}));
  return traced;
}

// A venue's traced park for a season, when there is one
export function tracedPark(parks: Record<string, TracedPark>, venue: string | null | undefined, season: number): TracedPark | null {
  const hit = TRACED.find(([name, , since]) => name.test(venue ?? '') && (!since || season >= since));
  return hit ? (parks[hit[1]] ?? null) : null;
}
