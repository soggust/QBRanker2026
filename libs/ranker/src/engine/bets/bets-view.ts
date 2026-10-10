// The Bets page's view (Place Bets; Open Bets, the user's bets not yet settled; or the Algorithm desk:
// development only): Place Bets unless the user chose another in this visit (kept for the page's life, not
// stored); a link that means the bets (the wallet's Place bets) sets it back to Place Bets first.
export type BetsView = 'bets' | 'open' | 'desk';

let chosen: BetsView = 'bets';

export function betsView(): BetsView {
  return chosen;
}

export function chooseBetsView(view: BetsView): void {
  chosen = view;
}
