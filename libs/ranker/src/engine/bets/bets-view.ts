// The Bets page's view (Bets, or the Algorithm desk: development only): Bets unless the user chose the
// Algorithm in this visit (kept for the page's life, not stored); a link that means the bets (the wallet's
// Place bets) sets it back to Bets first.
export type BetsView = 'bets' | 'desk';

let chosen: BetsView = 'bets';

export function betsView(): BetsView {
  return chosen;
}

export function chooseBetsView(view: BetsView): void {
  chosen = view;
}
