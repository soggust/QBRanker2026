// The fields some sports' rows carry and others don't (each sport has its own row type; the engine reads
// these when they're there): the team's full name, the last few results (1 win, 0.5 tie, 0 loss, newest
// first), whom they came against ("@ Denver Broncos") and which went to overtime or a shootout
export interface RowExtras {
  teamName?: string | null;
  lastFive?: number[];
  lastFiveVs?: (string | null)[];
  // (and how each was decided past regulation, when it was: the NHL's "OT" or "SO")
  lastFiveOt?: (string | null)[];
}

export const extras = (row: object): RowExtras => row as RowExtras;

// A logo's file name, without the folder or the extension ("assets/NFL_Icons/KC.png" -> "KC")
export const logoFile = (logo: string | undefined): string | undefined => logo?.match(/([^/]+)\.\w+$/)?.[1];

// A row's team by the names it knows, for finding it at ESPN: its team's name, its own, its logo's file
export function rowTeamNames(row: { name: string; teamLogo?: string }): (string | undefined)[] {
  return [extras(row).teamName ?? undefined, row.name, logoFile(row.teamLogo)];
}
