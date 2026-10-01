import SPORTS from '../../../../sports.json';

// The sport bar: every sport on the site (each its own app, served at /<id>/), from sports.json (the
// same list `npm run dev` and its proxy read)
export const SPORT_LINKS = SPORTS.map(({ id, label }) => ({ id, label }));
