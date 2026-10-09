// A prop's stat so far in a game under way, from ESPN's game summary (its box score): the same reading the
// desk's grader does once the game's final (libs/ranker/scripts/model/props.mjs statInFinal), so the count in
// play is the one the bet will be graded on. MLB's total bases aren't in ESPN's box score (the grader asks
// MLB's): no count for them here.

interface BoxStats {
  name?: string;
  type?: string;
  labels?: string[];
  athletes?: { athlete?: { id?: string | number }; stats?: string[]; didNotPlay?: boolean }[];
}

export interface SummaryBox {
  boxscore?: { players?: { statistics?: BoxStats[] }[] };
}

export function liveStat(sport: string, propType: string, athlete: string, body: SummaryBox | null): number | null {
  if (!body) return null;
  if (sport === 'nfl' && propType === 'rushRecYds') {
    const rush = liveStat(sport, 'rushYds', athlete, body);
    const rec = liveStat(sport, 'recYds', athlete, body);
    return rush === null && rec === null ? null : (rush ?? 0) + (rec ?? 0);
  }
  for (const team of body.boxscore?.players ?? []) {
    for (const s of team.statistics ?? []) {
      const a = (s.athletes ?? []).find((x) => String(x.athlete?.id) === athlete);
      if (!a?.stats?.length || a.didNotPlay) continue;
      const at = (k: string) => (s.labels ?? []).indexOf(k);
      const num = (k: string, part = 0) => Number(String(a.stats![at(k)] ?? '').split(/[-/]/)[part]) || 0;
      if (sport === 'nfl') {
        if (s.name === 'passing') {
          const v = { passYds: num('YDS'), passAtt: num('C/ATT', 1), passCmp: num('C/ATT', 0), passTd: num('TD'), passInt: num('INT') }[propType];
          if (v !== undefined) return v;
        }
        if (s.name === 'rushing' && (propType === 'rushYds' || propType === 'rushAtt')) return propType === 'rushYds' ? num('YDS') : num('CAR');
        if (s.name === 'receiving' && (propType === 'recYds' || propType === 'rec')) return propType === 'recYds' ? num('YDS') : num('REC');
        continue;
      }
      if (sport === 'nba') return { pts: num('PTS'), reb: num('REB'), ast: num('AST'), fg3: num('3PT'), pra: num('PTS') + num('REB') + num('AST') }[propType] ?? null;
      if (sport === 'nhl') return propType === 'saves' ? num('SV') : propType === 'sog' ? num('S') : num('G') + num('A');
      if (sport === 'mlb' && (s.type === 'pitching' || s.name === 'pitching') && (propType === 'k' || propType === 'outs')) {
        const [whole, part] = String(a.stats[at('IP')] ?? '0').split('.').map(Number);
        return propType === 'k' ? num('K') : whole * 3 + (part || 0);
      }
      if (sport === 'mlb' && (s.type === 'batting' || s.name === 'batting') && propType === 'hits') return num('H');
    }
  }
  return null;
}
