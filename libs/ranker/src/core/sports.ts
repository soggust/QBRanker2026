import { isDevMode } from '@angular/core';
import SPORTS from '../../../../sports.json';

// The sport bar: every sport on the site (each its own app, served at /<id>/), from sports.json (the
// same list `npm run dev` reads). A sport marked devOnly (not ready for the live site: MMA) is
// left out of production builds (`npm run build` doesn't build it) and out of their sport bar; the
// development builds `npm run dev` serves show it. A sport marked analysis publishes the AI write-ups (and
// the Bets page's bets: data/analysis).
export const SPORT_LINKS = (SPORTS as { id: string; label: string; devOnly?: boolean; analysis?: boolean }[])
  .filter((sport) => !sport.devOnly || isDevMode())
  .map(({ id, label, analysis }) => ({ id, label, analysis: !!analysis }));
