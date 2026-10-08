// A game's venue: the weather at game time (outdoors only) and a photo when ESPN has none

import { fetchJson, memo } from '@ranker/core/http';
import { GameView } from './game.model';

// ---- the weather at game time (outdoors only): the city's, from Open-Meteo (its geocoding, then the
// hours of the game: its archive for older games, its forecast's past days for recent ones)

export interface GameWeather {
  tempF: number | null;
  windMph: number | null;
  precipIn: number | null;
  sky: string;
}

const SKY = (code: number): string =>
  code >= 95 ? 'Thunderstorms' : code >= 85 ? 'Snow showers' : code >= 80 ? 'Rain showers' : code >= 71 ? 'Snow' : code >= 61 ? 'Rain' : code >= 51 ? 'Drizzle' : code >= 45 ? 'Fog' : code >= 3 ? 'Overcast' : code >= 1 ? 'Partly cloudy' : 'Clear';

// (each city's place, looked up once a visit: a team's home games all ask for the same one)
const places = new Map<string, Promise<{ results?: { latitude: number; longitude: number; admin1?: string; country_code?: string }[] }>>();

export async function loadWeather(game: GameView): Promise<GameWeather | null> {
  if (!game.venue || game.venue.roof === 'indoors' || !game.venue.city || !game.date) return null;
  const city = game.venue.city;
  const place = await memo(places, city, () =>
    fetchJson<{ results?: { latitude: number; longitude: number; admin1?: string; country_code?: string }[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5`,
      {},
    ),
  );
  const results = place.results ?? [];
  const state = (game.venue.state ?? '').toLowerCase();
  const at = results.find((r) => state && (r.admin1 ?? '').toLowerCase().startsWith(state.slice(0, 4))) ?? results[0];
  if (!at) return null;
  const start = new Date(game.date);
  const end = new Date(start.getTime() + 3 * 36e5);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const recent = Date.now() - start.getTime() < 60 * 864e5;
  const base = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const url =
    `${base}?latitude=${at.latitude}&longitude=${at.longitude}&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&start_date=${day(start)}&end_date=${day(end)}`;
  const data = await fetchJson<{ hourly?: { time: string[]; temperature_2m: (number | null)[]; precipitation: (number | null)[]; wind_speed_10m: (number | null)[]; weather_code: (number | null)[] } }>(url, {});
  const h = data.hourly;
  if (!h?.time?.length) return null;
  const hours = h.time.map((t, i) => ({ t: new Date(`${t}:00Z`), i })).filter(({ t }) => t >= new Date(start.getTime() - 36e5 + 1) && t < end).map(({ i }) => i);
  if (!hours.length) return null;
  const values = (key: 'temperature_2m' | 'precipitation' | 'wind_speed_10m' | 'weather_code') => hours.map((i) => h[key][i]).filter((v): v is number => v !== null && v !== undefined);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const temp = avg(values('temperature_2m'));
  const wind = avg(values('wind_speed_10m'));
  const precip = values('precipitation').reduce((a, b) => a + b, 0);
  const codes = values('weather_code');
  return {
    tempF: temp === null ? null : Math.round(temp),
    windMph: wind === null ? null : Math.round(wind),
    precipIn: Math.round(precip * 100) / 100,
    sky: codes.length ? SKY(Math.max(...codes)) : '',
  };
}

// A venue's photo when ESPN has none (a game abroad: Tottenham Hotspur Stadium, a Munich or São Paulo
// game): Wikipedia's lead photo for the venue, else for its city (its summary API: free, open to the page)
const photos = new Map<string, Promise<string | null>>();
export function venuePhoto(name: string, city: string | null): Promise<string | null> {
  return memo(photos, `${name}/${city}`, () => findVenuePhoto(name, city));
}

async function findVenuePhoto(name: string, city: string | null): Promise<string | null> {
  for (const title of [name, city].filter((t): t is string => !!t)) {
    const page = await fetchJson<{ thumbnail?: { source?: string }; originalimage?: { source?: string } } | null>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      null,
    );
    // (its thumbnail at a wider size; the original can be huge)
    const photo = page?.thumbnail?.source?.replace(/\/\d+px-/, '/1280px-') ?? page?.originalimage?.source;
    if (photo) return photo;
  }
  return null;
}
