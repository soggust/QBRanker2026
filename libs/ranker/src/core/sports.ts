import { isDevMode } from '@angular/core';
import SPORTS from '../../../../sports.json';

// The sports (each its own app, served at /<id>/), from sports.json (the same list `npm run dev` reads).
// A sport marked devOnly (not ready for everyone: MMA) is built for the live site too, but shown there
// only to an admin (the sport bar: SITE_SPORTS and features.ts; the app itself says Coming soon to
// everyone else); these links, which the Bets page reads, keep it to development builds. A sport marked analysis publishes the AI write-ups (and
// the Bets page's bets: data/analysis).
export const SPORT_LINKS = (SPORTS as { id: string; label: string; devOnly?: boolean; analysis?: boolean }[])
  .filter((sport) => !sport.devOnly || isDevMode())
  .map(({ id, label, analysis }) => ({ id, label, analysis: !!analysis }));

// Every sport on the site, the ones not ready for everyone marked (the sport bar shows those to an admin
// too: features.ts)
export const SITE_SPORTS = (SPORTS as { id: string; label: string; devOnly?: boolean }[]).map(({ id, label, devOnly }) => ({
  id,
  label,
  devOnly: !!devOnly,
}));
