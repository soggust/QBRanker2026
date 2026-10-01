// Fighter badges: each row's flag (his country's, from ESPN) sits on a dark canvas-red disc. There are no
// team colors in fighting: every badge is the same.
export function badgeColor(_teamLogo: string): string {
  return '#3a1416';
}

// [primary, secondary] for anything that wants a pair
export function teamColors(teamLogo: string): [string, string] {
  const c = badgeColor(teamLogo);
  return [c, c];
}

// (the flags read on the dark disc as they are)
export function whiteLogo(_teamLogo: string): boolean {
  return false;
}
