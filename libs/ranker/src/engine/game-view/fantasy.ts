import { GameFantasy, GameView } from './game.model';

// Fantasy points from the box score. Football: 1 pt per 25 pass yds, 4 per pass TD, -2 per INT, 1 per
// 10 rush or rec yds, 6 per TD, -2 per fumble lost, kickers 3 per FG and 1 per XP (catches kept apart: the
// Fantasy Scoring setting prices them). DraftKings' for the rest: basketball 1 per pt, +0.5 per 3, 1.25
// per reb, 1.5 per ast, 2 per stl or blk, -0.5 per TO, +1.5 double-double, +3 triple-double; hockey 8.5
// per goal, 5 per assist, 1.5 per shot, 1.3 per block, goalies 0.7 per save and -3.5 per goal against;
// baseball 3 per hit (10 a HR; a hit that isn't a home run counts as a single: the box score doesn't
// split them), 2 per RBI, run or walk, pitchers 2.25 per inning, 2 per K, -2 per ER, -0.6 per hit or walk

const FANTASY_SPORTS = ['football', 'basketball', 'hockey', 'baseball'];

export function fantasyPoints(league: string, box: GameView['box']): GameFantasy[] {
  const sport = FANTASY_SPORTS.find((k) => league.includes(k)) ?? '';
  const players = new Map<string, GameFantasy>();
  const num = (v: string | undefined) => {
    const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  // "17/25" or "3-7": the made part
  const made = (v: string | undefined) => num(String(v ?? '').split(/[/-]/)[0]);
  // innings: "6.1" is six and a third
  const innings = (v: string | undefined) => {
    const [whole, outs] = String(v ?? '0').split('.');
    return num(whole) + num(outs) / 3;
  };
  for (const team of box) {
    for (const g of team.groups) {
      for (const row of g.rows) {
        if (row.dnp) continue;
        const v = (label: string) => {
          const i = g.labels.indexOf(label);
          return i < 0 ? undefined : row.values[i];
        };
        const p = players.get(team.side + row.name) ?? { side: team.side, name: row.name, position: row.position, headshot: row.headshot, points: 0, receptions: 0, parts: [] };
        // (its points, and the line as the box score writes it: "6.1 IP" for 6 1/3 innings)
        const add = (pts: number, amount: number, label: string, shown?: string) => {
          if (!amount) return;
          p.points += pts;
          p.parts.push(`${shown ?? (Number.isInteger(amount) ? amount : amount.toFixed(1))} ${label}`);
        };
        if (sport === 'football') {
          if (g.key === 'passing') {
            add(num(v('YDS')) * 0.04, num(v('YDS')), 'pass yds');
            add(num(v('TD')) * 4, num(v('TD')), 'pass TD');
            add(num(v('INT')) * -2, num(v('INT')), 'INT');
          } else if (g.key === 'rushing') {
            add(num(v('YDS')) * 0.1, num(v('YDS')), 'rush yds');
            add(num(v('TD')) * 6, num(v('TD')), 'rush TD');
          } else if (g.key === 'receiving') {
            // (catches: scored by the setting, on the page)
            p.receptions += num(v('REC'));
            add(0, num(v('REC')), 'rec');
            add(num(v('YDS')) * 0.1, num(v('YDS')), 'rec yds');
            add(num(v('TD')) * 6, num(v('TD')), 'rec TD');
          } else if (g.key === 'fumbles') {
            add(num(v('LOST')) * -2, num(v('LOST')), 'fum lost');
          } else if (g.key === 'kicking') {
            add(made(v('FG')) * 3, made(v('FG')), 'FG');
            add(made(v('XP')), made(v('XP')), 'XP');
          } else continue;
        } else if (sport === 'basketball') {
          const pts = num(v('PTS'));
          const reb = num(v('REB'));
          const ast = num(v('AST'));
          const stl = num(v('STL'));
          const blk = num(v('BLK'));
          add(pts, pts, 'pts');
          add(made(v('3PT')) * 0.5, made(v('3PT')), '3PM');
          add(reb * 1.25, reb, 'reb');
          add(ast * 1.5, ast, 'ast');
          add(stl * 2, stl, 'stl');
          add(blk * 2, blk, 'blk');
          add(num(v('TO')) * -0.5, num(v('TO')), 'TO');
          const doubles = [pts, reb, ast, stl, blk].filter((x) => x >= 10).length;
          if (doubles >= 3) add(3, 1, 'triple-double');
          else if (doubles === 2) add(1.5, 1, 'double-double');
        } else if (sport === 'hockey') {
          if (g.labels.includes('SV')) {
            add(num(v('SV')) * 0.7, num(v('SV')), 'saves');
            add(num(v('GA')) * -3.5, num(v('GA')), 'GA');
          } else {
            add(num(v('G')) * 8.5, num(v('G')), 'G');
            add(num(v('A')) * 5, num(v('A')), 'A');
            add(num(v('SOG')) * 1.5, num(v('SOG')), 'SOG');
            add(num(v('BS')) * 1.3, num(v('BS')), 'blk');
          }
        } else if (sport === 'baseball') {
          if (g.labels.includes('IP')) {
            const ip = innings(v('IP'));
            add(ip * 2.25, ip, 'IP', v('IP'));
            add(num(v('K')) * 2, num(v('K')), 'K');
            add(num(v('ER')) * -2, num(v('ER')), 'ER');
            add((num(v('H')) + num(v('BB'))) * -0.6, num(v('H')) + num(v('BB')), 'H+BB');
          } else {
            const hr = num(v('HR'));
            add((num(v('H')) - hr) * 3, num(v('H')) - hr, 'H');
            add(hr * 10, hr, 'HR');
            add(num(v('RBI')) * 2, num(v('RBI')), 'RBI');
            add(num(v('R')) * 2, num(v('R')), 'R');
            add(num(v('BB')) * 2, num(v('BB')), 'BB');
          }
        }
        players.set(team.side + row.name, p);
      }
    }
  }
  const fantasy = [...players.values()]
    .filter((p) => p.parts.length)
    .map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 }))
    .sort((a, b) => b.points - a.points);
  return fantasy;
}
