// What changes between a week's reports: ESPN's injury report and DraftKings lines, and the kickoff
// forecast at each outdoor stadium. Shared by the dossiers (Tuesday: an early forecast) and the bet desk
// (closer to the games: fresh lines, injuries and weather).

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
// (ESPN's abbreviations that differ from nflverse's)
export const ESPN_ABBR = { WSH: 'WAS', LAR: 'LA' };

// ---- ESPN: the injury report (everyone not Active, with ESPN's note) by nflverse team

export async function espnInjuries() {
  const res = await fetch(`${ESPN}/injuries`);
  if (!res.ok) throw new Error(`ESPN injuries: ${res.status}`);
  const data = await res.json();
  const byTeam = new Map();
  for (const team of data.injuries ?? []) {
    for (const i of team.injuries ?? []) {
      if (!i.status || i.status === 'Active') continue;
      const abbr = i.athlete?.team?.abbreviation;
      const t = ESPN_ABBR[abbr] ?? abbr;
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t).push({
        espnId: i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1] ?? null,
        name: i.athlete?.displayName,
        pos: i.athlete?.position?.abbreviation,
        status: i.status,
        injury: [i.details?.type, i.details?.detail].filter((x) => x && x !== 'Not Specified').join(', ') || null,
        returnDate: i.details?.returnDate ?? null,
        reported: i.date?.slice(0, 10) ?? null,
        news: i.shortComment ?? null,
      });
    }
  }
  return byTeam;
}

// ---- ESPN: a day's DraftKings lines, by matchup ("BAL@ATL")

export async function espnLines(dates) {
  const lines = new Map();
  for (const d of dates) {
    const res = await fetch(`${ESPN}/scoreboard?dates=${d.replace(/-/g, '')}`).catch(() => null);
    if (!res?.ok) continue;
    for (const e of (await res.json()).events ?? []) {
      const c = e.competitions?.[0];
      const o = c?.odds?.[0];
      if (!o?.details) continue;
      const team = (side) => {
        const a = c.competitors.find((x) => x.homeAway === side)?.team?.abbreviation;
        return ESPN_ABBR[a] ?? a;
      };
      lines.set(`${team('away')}@${team('home')}`, { line: o.details, overUnder: o.overUnder ?? null, homeMoneyline: o.moneyline?.home?.close?.odds ?? null, awayMoneyline: o.moneyline?.away?.close?.odds ?? null, book: o.provider?.name ?? null });
    }
  }
  return lines;
}

// ---- kickoff: nflverse's schedule gives Eastern times ("2026-10-11", "09:30"); as an ISO time (UTC),
// with that day's Eastern offset (EDT or EST)

export function kickoffIso(day, time) {
  if (!/^\d{4}-\d\d-\d\d$/.test(day ?? '') || !/^\d\d:\d\d$/.test(time ?? '')) return null;
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${day}T17:00:00Z`))
    .find((p) => p.type === 'timeZoneName')
    .value.replace('GMT', '')
    .replace(/^([+-])(\d)$/, '$10$2');
  return new Date(`${day}T${time}:00${offset}:00`).toISOString();
}

// ---- the weather at kickoff

// Each stadium nflverse's schedule names (its stadium_id): where it is. Its roof comes from the schedule:
// a dome or closed roof is indoors; a blank one is retractable (likely shut in bad weather)
// Each stadium nflverse's schedule names (its stadium_id): where it is, and its city
const STADIUMS = {
  ATL97: [33.755, -84.401, 'Atlanta'], BAL00: [39.278, -76.623, 'Baltimore'], BOS00: [42.091, -71.264, 'Foxborough'],
  BUF00: [42.774, -78.787, 'Orchard Park'], CAR00: [35.226, -80.853, 'Charlotte'], CHI98: [41.862, -87.617, 'Chicago'],
  CIN00: [39.095, -84.516, 'Cincinnati'], CLE00: [41.506, -81.7, 'Cleveland'], DAL00: [32.748, -97.093, 'Arlington'],
  DEN00: [39.744, -105.02, 'Denver'], DET00: [42.34, -83.046, 'Detroit'], GNB00: [44.501, -88.062, 'Green Bay'],
  HOU00: [29.685, -95.411, 'Houston'], IND00: [39.76, -86.164, 'Indianapolis'], JAX00: [30.324, -81.637, 'Jacksonville'],
  KAN00: [39.049, -94.484, 'Kansas City'], LAX01: [33.953, -118.339, 'Inglewood'], MIA00: [25.958, -80.239, 'Miami Gardens'],
  MIN01: [44.974, -93.258, 'Minneapolis'], NAS00: [36.166, -86.771, 'Nashville'], NOR00: [29.951, -90.081, 'New Orleans'],
  NYC01: [40.814, -74.074, 'East Rutherford'], PHI00: [39.901, -75.168, 'Philadelphia'], PHO00: [33.528, -112.263, 'Glendale'],
  PIT00: [40.447, -80.016, 'Pittsburgh'], SEA00: [47.595, -122.332, 'Seattle'], SFO01: [37.403, -121.97, 'Santa Clara'],
  TAM00: [27.976, -82.503, 'Tampa'], VEG00: [36.091, -115.184, 'Las Vegas'], WAS00: [38.908, -76.864, 'Landover'],
  // (abroad)
  LON00: [51.556, -0.28, 'London'], LON01: [51.456, -0.342, 'London'], LON02: [51.604, -0.066, 'London'],
  GER00: [48.219, 11.625, 'Munich'], MUN01: [48.219, 11.625, 'Munich'], FRA00: [50.069, 8.645, 'Frankfurt'],
  BER00: [52.515, 13.239, 'Berlin'], DUB00: [53.361, -6.251, 'Dublin'], MEX00: [19.303, -99.15, 'Mexico City'],
  SAO00: [-23.545, -46.474, 'São Paulo'], RIO00: [-22.912, -43.23, 'Rio de Janeiro'], MAD01: [40.453, -3.688, 'Madrid'],
  PAR00: [48.924, 2.36, 'Paris'], MEL00: [-37.82, 144.983, 'Melbourne'],
};

// A game's venue: its stadium's name and city (an id the table doesn't know: just the name)
export function venue({ stadiumId, stadium }) {
  const id = ABROAD.find(([name]) => name.test(stadium ?? ''))?.[1] ?? stadiumId;
  return { stadium: stadium || null, city: STADIUMS[id]?.[2] ?? null };
}
const INDOORS = new Set(['dome', 'closed']);
// A game abroad by its stadium's name first: the schedule names the venue right before it moves the
// game's stadium id off the home team's own ("Tottenham Hotspur Stadium" under JAX00)
const ABROAD = [
  [/tottenham/i, 'LON02'], [/wembley/i, 'LON00'], [/twickenham/i, 'LON01'], [/allianz|bayern/i, 'MUN01'],
  [/frankfurt|deutsche bank/i, 'FRA00'], [/olympiastadion|berlin/i, 'BER00'], [/croke/i, 'DUB00'],
  [/azteca|banorte/i, 'MEX00'], [/corinthians/i, 'SAO00'], [/maracan/i, 'RIO00'], [/bernab/i, 'MAD01'],
  [/stade de france/i, 'PAR00'], [/melbourne/i, 'MEL00'],
];

// Open-Meteo's weather codes, in words (the ones that matter for a game)
const SKY = (code) =>
  code >= 95 ? 'thunderstorms' : code >= 85 ? 'snow showers' : code >= 80 ? 'rain showers' : code >= 71 ? 'snow' : code >= 61 ? 'rain' : code >= 51 ? 'drizzle' : code >= 45 ? 'fog' : code >= 3 ? 'overcast' : code >= 1 ? 'partly cloudy' : 'clear';

// The forecast for a game's first three hours: { roof, tempF, windMph, gustMph, precipChance (%),
// precipIn, sky, hoursAhead, early (more than 3 days out: rough, especially wind) }; indoors just its
// roof; null when there's no telling (an unknown stadium, or more than 15 days out)
export async function kickoffForecast({ stadiumId, stadium, roof, kickoff }) {
  const roofType = INDOORS.has(roof) ? 'indoors' : roof ? 'outdoors' : 'retractable';
  if (roofType === 'indoors') return { roof: 'indoors' };
  const at = STADIUMS[ABROAD.find(([name]) => name.test(stadium ?? ''))?.[1] ?? stadiumId];
  const start = kickoff ? new Date(kickoff) : null;
  if (!at || !start) return null;
  const hoursAhead = Math.round((start - Date.now()) / 36e5);
  if (hoursAhead < -4 || hoursAhead > 15 * 24) return null;
  const day = (d) => d.toISOString().slice(0, 10);
  const end = new Date(start.getTime() + 3 * 36e5);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${at[0]}&longitude=${at[1]}` +
    '&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code' +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&start_date=${day(start)}&end_date=${day(end)}`;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const h = (await res.json()).hourly;
  const hours = (h?.time ?? [])
    .map((t, i) => ({ at: new Date(`${t}:00Z`), i }))
    .filter(({ at: t }) => t >= new Date(start.getTime() - 36e5 + 1) && t < end)
    .map(({ i }) => i);
  if (!hours.length) return null;
  const pick = (key) => hours.map((i) => h[key][i]).filter((v) => v !== null && v !== undefined);
  const max = (key) => (pick(key).length ? Math.max(...pick(key)) : null);
  const temps = pick('temperature_2m');
  return {
    roof: roofType,
    tempF: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    windMph: max('wind_speed_10m') === null ? null : Math.round(max('wind_speed_10m')),
    gustMph: max('wind_gusts_10m') === null ? null : Math.round(max('wind_gusts_10m')),
    precipChance: max('precipitation_probability'),
    precipIn: Math.round(pick('precipitation').reduce((a, b) => a + b, 0) * 100) / 100,
    sky: SKY(max('weather_code') ?? 0),
    hoursAhead,
    early: hoursAhead > 72,
  };
}
