// The NFL's second round of context, all from nflverse unless said: each team's efficiency when the game was
// still a game (EPA a play on runs and passes with the win chance between 10% and 90%, the last two minutes of
// each half left out: no garbage time, no kneel-downs, no trailing-late heaves), season to date with last
// season's at half weight; each game's flags (for the officials); its offensive line's continuity (how many of
// the five who started its last game don't start this one: snap counts, and for a coming game the injury
// report); and the wind across the field (which way each field runs, from OpenStreetMap, and where the wind
// blew from at kickoff, Open-Meteo's archive; the forecast for a coming game).
//
// Kept in the context's facts (.cache/model/context-<sport>.json): plays (each game's [home EPA, home plays, away EPA, away plays, flags]), ol (each
// game's [home, away] starters changed), olLast (each team's last five), fields (each stadium's bearing and
// place), wdir (each outdoor game's wind direction).

import { term } from './terms.mjs';
import { fieldBearing, nflverseRows, pool, weatherHistory } from './sources.mjs';


export const FOOTBALL_TERMS = [
  term('nsEpa', 'strength', 'm', 'Neutral-script EPA', 'per 0.1 EPA a play better (offense less defense allowed) this season, garbage time left out'),
  term('nsEpaT', 'strength', 't', 'Neutral-script EPA (total)', "to the total per 0.1 EPA a play of both offenses and both defenses' allowed"),
  term('olChanges', 'starters', 'm', 'Line continuity', "per offensive-line starter the other side changed since its last game, less its own"),
  term('crosswind', 'weather', 't', 'Crosswind', 'to the total per 10 mph of wind across the field over 10 (outdoors)'),
];

const NEUTRAL = (p) => (p.play_type === 'pass' || p.play_type === 'run') && p.epa !== '' && p.epa !== 'NA' && Number(p.wp) >= 0.1 && Number(p.wp) <= 0.9 && Number(p.half_seconds_remaining) > 120;
const OL = new Set(['T', 'G', 'C', 'OL', 'OT', 'OG']);

// The facts above, for every final that doesn't have them yet (the seasons it needs, read once)
// (part: plays, snaps or fields)
export async function gatherFootball(cfg, history, upcoming, facts, live, part) {
  facts.plays ??= {};
  facts.ol ??= {};
  facts.olLast ??= {};
  facts.fields ??= {};
  facts.wdir ??= {};
  const rows = facts.nfl;
  if (!rows?.size) return;
  const espnOf = new Map([...rows.values()].map((r) => [r.game_id, r.espn]));
  const byId = new Map(history.map((g) => [g.id, g]));
  const finals = history.filter((g) => g.final && rows.has(g.id));
  const current = Math.max(...history.map((g) => g.season));

  // (the plays: a season's file only when one of its finals is missing them; a past season's final the file
  // hasn't is tried once: null)
  const missing = (kept, g) => !kept[g.id] && !(g.season < current && g.id in kept);
  const playSeasons = part === 'plays' ? [...new Set(finals.filter((g) => missing(facts.plays, g)).map((g) => g.season))].sort() : [];
  for (const season of playSeasons) {
    const plays = await nflverseRows('pbp', `play_by_play_${season}.csv.gz`, ['game_id', 'posteam', 'home_team', 'play_type', 'epa', 'wp', 'half_seconds_remaining', 'penalty'], season === current ? 12 : 24 * 365);
    if (!plays) continue;
    const per = new Map();
    for (const p of plays) {
      const id = espnOf.get(p.game_id);
      if (!id) continue;
      const a = per.get(id) ?? [0, 0, 0, 0, 0];
      if (p.penalty === '1') a[4]++;
      if (NEUTRAL(p)) {
        const at = p.posteam === p.home_team ? 0 : 2;
        a[at] += Number(p.epa);
        a[at + 1]++;
      }
      per.set(id, a);
    }
    let n = 0;
    for (const [id, a] of per) if (a[1] + a[3] > 20 && byId.get(id)?.final) (facts.plays[id] = [Math.round(a[0] * 100) / 100, a[1], Math.round(a[2] * 100) / 100, a[3], a[4]]), n++;
    if (season < current) for (const g of finals) if (g.season === season && !facts.plays[g.id]) facts.plays[g.id] = null;
    console.log(`nfl: plays for ${n} games of ${season}`);
  }

  // (the line: each team's five offensive linemen with the most snaps, against its last game's five)
  const olSeasons = part === 'snaps' ? [...new Set(finals.filter((g) => missing(facts.ol, g) && g.season >= 2012).map((g) => g.season))].sort() : [];
  for (const season of olSeasons) {
    const snaps = await nflverseRows('snap_counts', `snap_counts_${season}.csv.gz`, ['game_id', 'week', 'player', 'pfr_player_id', 'position', 'team', 'offense_snaps'], season === current ? 12 : 24 * 365);
    if (!snaps) continue;
    const five = new Map();
    for (const s of snaps) {
      if (!OL.has(s.position)) continue;
      const key = `${s.game_id}|${s.team}`;
      five.set(key, [...(five.get(key) ?? []), { id: s.pfr_player_id, name: s.player, n: Number(s.offense_snaps) || 0, week: Number(s.week) }]);
    }
    const byTeam = new Map();
    for (const [key, list] of five) {
      const [gameId, team] = key.split('|');
      const top = list.sort((a, b) => b.n - a.n).slice(0, 5);
      byTeam.set(team, [...(byTeam.get(team) ?? []), { gameId, week: top[0]?.week ?? 0, top }]);
    }
    for (const [team, games] of byTeam) {
      games.sort((a, b) => a.week - b.week);
      games.forEach((x, i) => {
        const id = espnOf.get(x.gameId);
        const row = id && rows.get(id);
        if (!row) return;
        const prev = games[i - 1];
        const changed = prev ? 5 - x.top.filter((p) => prev.top.some((q) => q.id === p.id)).length : null;
        const side = row.home_team === team ? 0 : 1;
        const o = facts.ol[id] ?? [null, null];
        o[side] = changed;
        facts.ol[id] = o;
        if (i === games.length - 1 && season === current) facts.olLast[team] = x.top.map((p) => p.name);
      });
    }
    if (season < current) for (const g of finals) if (g.season === season && !facts.ol[g.id]) facts.ol[g.id] = null;
  }

  // (the fields: each outdoor stadium's bearing, asked of OpenStreetMap once, near the home team's place;
  // a stadium the map hasn't (an old one, a name it doesn't know) is no crosswind)
  const homePlace = new Map();
  for (const g of history) if (g.venue && !g.neutral) homePlace.set(g.home, facts.places?.[g.venue]);
  const stadiums = new Map();
  for (const r of rows.values()) if (['outdoors', 'open', ''].includes(r.roof) && r.stadium_id) stadiums.set(r.stadium_id, r);
  const wanted = part === 'fields' ? [...stadiums.entries()].filter(([id]) => !(id in facts.fields)) : [];
  // (the map's server is busy at times: a minute a run at most, the rest asked next run)
  const until = Date.now() + 60e3;
  await pool(wanted, 1, async ([id, r]) => {
    if (Date.now() > until) return;
    const g = byId.get(r.espn);
    const near = g ? (facts.places?.[g.venue] ?? homePlace.get(g.home)) : null;
    if (!near) return;
    const found = await fieldBearing(r.stadium, near);
    if (found !== undefined) facts.fields[id] = found;
    await new Promise((res) => setTimeout(res, 1500));
  });

  // (where the wind blew from at each outdoor final's kickoff: one ask of the archive per stadium)
  const need = new Map();
  for (const g of finals) {
    const r = rows.get(g.id);
    if (part !== 'fields' || g.id in facts.wdir || !['outdoors', 'open'].includes(r.roof) || !facts.fields[r.stadium_id]?.at) continue;
    need.set(r.stadium_id, [...(need.get(r.stadium_id) ?? []), g]);
  }
  await pool([...need], 2, async ([id, games]) => {
    const days = games.map((g) => g.date.slice(0, 10)).sort();
    const at = await weatherHistory(facts.fields[id].at, days[0], days.at(-1));
    if (!at) return;
    for (const g of games) {
      const w = at(g.date);
      if (w) facts.wdir[g.id] = [Math.round(w.from), Math.round(w.wind)];
    }
  });
  for (const { game } of upcoming) {
    const r = rows.get(game.id);
    if (r && facts.fields[r.stadium_id]) live.get(game.id).field = facts.fields[r.stadium_id];
  }
}

// The NFL's second-round terms for each game, in date order
export function footballOf(facts, live) {
  const eff = new Map();
  const value = (team, season) => {
    const e = eff.get(team);
    if (!e) return { net: 0, off: 0, def: 0 };
    const w = e.season === season ? 1 : 0.5;
    const off = (w * e.off) / (w * e.offN + 200);
    const def = (w * e.def) / (w * e.defN + 200);
    return { net: off - def, off, def };
  };
  return (g) => {
    const rows = facts.nfl;
    const r = rows?.get(g.id);
    const l = live.get(g.id);
    const h = value(g.home, g.season);
    const a = value(g.away, g.season);
    // (the line: the starters changed; a coming game's, its last five listed out)
    let ol = g.final ? facts.ol?.[g.id] : null;
    const flags = [];
    if (!g.final && r && l?.injuries) {
      const out = (team, abbr) => (facts.olLast?.[abbr] ?? []).filter((name) => (l.injuries.get(String(team)) ?? []).some((p) => p.name === name && /^out|doubtful|injured reserve/i.test(p.status))).length;
      ol = [out(g.home, r.home_team), out(g.away, r.away_team)];
    }
    // (the wind across the field: its speed times how square it blows to the field's length)
    let cross = 0;
    const field = facts.fields?.[r?.stadium_id] ?? l?.field;
    const dir = g.final ? facts.wdir?.[g.id] : l?.weather ? [l.weather.from, l.weather.wind] : null;
    const speed = g.final && r && r.wind !== '' && r.wind !== 'NA' ? Number(r.wind) : dir?.[1];
    if (field && dir && Number.isFinite(speed) && ['outdoors', 'open'].includes(r?.roof ?? '')) {
      cross = Math.abs(speed * Math.sin(((dir[0] - field.bearing) * Math.PI) / 180));
    }
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      terms: {
        nsEpa: (h.net - a.net) * 10,
        nsEpaT: (h.off + a.off + h.def + a.def) * 10,
        olChanges: ol ? (ol[1] ?? 0) - (ol[0] ?? 0) : 0,
        crosswind: Math.max(0, cross - 10) / 10,
      },
      info: { epa: [r3(h.net), r3(a.net)], olChanged: ol ?? null, crosswind: r3(cross) },
      flags,
      learn: () => {
        const p = facts.plays?.[g.id];
        if (!p) return;
        for (const [team, off, offN, def, defN] of [
          [g.home, p[0], p[1], p[2], p[3]],
          [g.away, p[2], p[3], p[0], p[1]],
        ]) {
          const e = eff.get(team);
          const keep = !e ? 0 : e.season === g.season ? 1 : 0.5;
          eff.set(team, { season: g.season, off: (e?.off ?? 0) * keep + off, offN: (e?.offN ?? 0) * keep + offN, def: (e?.def ?? 0) * keep + def, defN: (e?.defN ?? 0) * keep + defN });
        }
      },
    };
  };
}
