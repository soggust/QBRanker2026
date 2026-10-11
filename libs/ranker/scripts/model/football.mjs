// The NFL's second round of context, all from nflverse unless said: each team's efficiency when the game was
// still a game (EPA a play on runs and passes with the win chance between 10% and 90%, the last two minutes of
// each half left out: no garbage time, no kneel-downs, no trailing-late heaves), season to date with last
// season's at half weight; each game's flags (for the officials); its offensive line's continuity (how many of
// the five who started its last game don't start this one: snap counts, and for a coming game the injury
// report); and the wind across the field (which way each field runs, from OpenStreetMap, and where the wind
// blew from at kickoff, Open-Meteo's archive; the forecast for a coming game); the rain and snow over each
// outdoor final's window (Open-Meteo's archive: context.mjs's weather terms and the props' context); and the
// schedule's own facts, all nflverse's: a division game, the kickoff by each team's own clock (a West Coast
// team's 1 p.m. Eastern start is 10 a.m. to it), a field of the other kind (grass or turf) from a team's own,
// and a team's first games under a new head coach.
//
// Kept in the context's facts (.cache/model/context-<sport>.json): plays (each game's [home EPA, home plays, away
// EPA, away plays, flags, home passes, home runs, away passes, away runs, home over, home xn, away over, away xn]:
// over and xn the pass funnel's, matchups.mjs passFunnel: in neutral situations (win chance 20-80%, outside the
// last two minutes of a half) where nflverse has xpass, the side's passes less xpass summed, and how many), ol (each
// game's [home, away] starters changed), olLast (each team's last five), fields (each stadium's bearing and
// place), wdir (each outdoor game's wind direction), wx (each outdoor final's [precip, snow], inches over its
// window: sources.mjs gameWindow; null where the archive had none).

import { term } from './terms.mjs';
import { passFunnel, sideOfPlays } from './matchups.mjs';
import { DAY, fieldBearing, isoDay, nflverseRows, pool, precipHistory, weatherHistory } from './sources.mjs';


export const FOOTBALL_TERMS = [
  term('nsEpa', 'strength', 'm', 'Neutral-script EPA', 'per 0.1 EPA a play better (offense less defense allowed) this season, garbage time left out'),
  term('nsEpaT', 'strength', 't', 'Neutral-script EPA (total)', "to the total per 0.1 EPA a play of both offenses and both defenses' allowed"),
  term('olChanges', 'starters', 'm', 'Line continuity', "per offensive-line starter the other side changed since its last game, less its own"),
  term('crosswind', 'weather', 't', 'Crosswind', 'to the total per 10 mph of wind across the field over 10 (outdoors)'),
  term('funnelT', 'matchups', 't', 'Pass funnels (total)', "to the total per 10 points of both defenses' pass funnel (their opponents' pass rate over expected against them, in neutral situations, over their own)"),
  term('paceT', 'matchups', 't', 'Defenses\' pace (total)', "to the total per 10% more plays both defenses' opponents run against them than they usually do"),
  term('divHome', 'matchups', 'm', 'Division game', 'to the home edge in a division game (the teams know each other)'),
  term('divT', 'matchups', 't', 'Division game (total)', 'to the total in a division game'),
  term('bodyClock', 'travel', 'm', 'Body clock', 'when the other side kicks off before 11 a.m. by its own home clock, less its own'),
  term('surface', 'travel', 'm', 'Surface', "when the other side plays on a field of the other kind (grass or turf) from its home field's, less its own"),
  term('newCoach', 'starters', 'm', 'New head coach', 'when the other side is in its first four games under a new head coach, less its own'),
];

// (the share of the outdoor finals whose rain must be known before the rain and snow are fit: gatherFootball's
// facts.wxCover)
export const WX_COVER = 0.95;

// (each team's home clock, by nflverse's team codes, old ones too (Arizona keeps standard time all year); the
// rest Eastern)
const CLOCK = {
  SEA: 'America/Los_Angeles', SF: 'America/Los_Angeles', LA: 'America/Los_Angeles', LAC: 'America/Los_Angeles', LV: 'America/Los_Angeles', OAK: 'America/Los_Angeles', SD: 'America/Los_Angeles',
  ARI: 'America/Phoenix', DEN: 'America/Denver',
  CHI: 'America/Chicago', DAL: 'America/Chicago', HOU: 'America/Chicago', KC: 'America/Chicago', MIN: 'America/Chicago', NO: 'America/Chicago', GB: 'America/Chicago', TEN: 'America/Chicago', STL: 'America/Chicago',
};
const clocks = new Map();
// (the hour a time falls on by a team's home clock)
export function hourAt(team, when) {
  const zone = CLOCK[team] ?? 'America/New_York';
  if (!clocks.has(zone)) clocks.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }));
  return Number(clocks.get(zone).format(new Date(when)));
}
// (a field's kind: grass, or turf (every artificial one); null when nflverse hasn't it)
export function fieldKind(surface) {
  const s = String(surface ?? '').trim().toLowerCase();
  return !s ? null : /grass/.test(s) ? 'grass' : 'turf';
}

// (where each outdoor stadium is, for the archive's rain and snow: OpenStreetMap's field where the crosswind
// found it (facts.fields), else a game's place there, else these: the ones neither has)
const STADIUMS = {
  KAN00: [39.0489, -94.4839], IND00: [39.7601, -86.1639], SFO01: [37.403, -121.97], OAK00: [37.7516, -122.2005], SDG00: [32.7831, -117.1196],
  LON01: [51.456, -0.3415], LAX97: [33.8644, -118.2611], ATL97: [33.7554, -84.4008], HOU00: [29.6847, -95.4107], GER00: [48.2188, 11.6247],
  FRA00: [50.0686, 8.6455], SAO00: [-23.5453, -46.4742], RIO00: [-22.9122, -43.2302], MAD01: [40.4531, -3.6883],
};

const NEUTRAL = (p) => (p.play_type === 'pass' || p.play_type === 'run') && p.epa !== '' && p.epa !== 'NA' && Number(p.wp) >= 0.1 && Number(p.wp) <= 0.9 && Number(p.half_seconds_remaining) > 120;
// (the funnel's neutral plays: win chance 20-80%, outside the last two minutes of a half, with nflverse's xpass)
const FUNNEL = (p) => (p.play_type === 'pass' || p.play_type === 'run') && p.xpass !== '' && p.xpass !== 'NA' && Number(p.wp) >= 0.2 && Number(p.wp) <= 0.8 && Number(p.half_seconds_remaining) > 120;
const OL = new Set(['T', 'G', 'C', 'OL', 'OT', 'OG']);

// The facts above, for every final that doesn't have them yet (the seasons it needs, read once)
// (part: plays, snaps, fields or precip)
export async function gatherFootball(cfg, history, upcoming, facts, live, part) {
  facts.plays ??= {};
  facts.ol ??= {};
  facts.olLast ??= {};
  facts.fields ??= {};
  facts.wdir ??= {};
  facts.wx ??= {};
  const rows = facts.nfl;
  if (!rows?.size) return;
  const espnOf = new Map([...rows.values()].map((r) => [r.game_id, r.espn]));
  const byId = new Map(history.map((g) => [g.id, g]));
  const finals = history.filter((g) => g.final && rows.has(g.id));
  const current = Math.max(...history.map((g) => g.season));

  // (the plays: a season's file only when one of its finals is missing them; a past season's final the file
  // hasn't is tried once: null)
  const missing = (kept, g) => !kept[g.id] && !(g.season < current && g.id in kept);
  // (a game's plays kept before its passes and runs, or its pass funnel's, were: asked again once)
  const noCounts = (g) => facts.plays[g.id] && facts.plays[g.id].length < 13;
  const playSeasons = part === 'plays' ? [...new Set(finals.filter((g) => missing(facts.plays, g) || noCounts(g)).map((g) => g.season))].sort() : [];
  for (const season of playSeasons) {
    const plays = await nflverseRows('pbp', `play_by_play_${season}.csv.gz`, ['game_id', 'posteam', 'home_team', 'play_type', 'pass', 'xpass', 'epa', 'wp', 'half_seconds_remaining', 'penalty'], season === current ? 12 : 24 * 365);
    if (!plays) continue;
    const per = new Map();
    for (const p of plays) {
      const id = espnOf.get(p.game_id);
      if (!id) continue;
      const a = per.get(id) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      if (p.penalty === '1') a[4]++;
      // (every run and pass, by side: [home passes, home runs, away passes, away runs] after the flags)
      if (p.play_type === 'pass' || p.play_type === 'run') a[5 + (p.posteam === p.home_team ? 0 : 2) + (p.play_type === 'pass' ? 0 : 1)]++;
      if (FUNNEL(p)) {
        const at = p.posteam === p.home_team ? 9 : 11;
        a[at] += (p.pass === '1' ? 1 : 0) - Number(p.xpass);
        a[at + 1]++;
      }
      if (NEUTRAL(p)) {
        const at = p.posteam === p.home_team ? 0 : 2;
        a[at] += Number(p.epa);
        a[at + 1]++;
      }
      per.set(id, a);
    }
    let n = 0;
    for (const [id, a] of per) if (a[1] + a[3] > 20 && byId.get(id)?.final) (facts.plays[id] = [Math.round(a[0] * 100) / 100, a[1], Math.round(a[2] * 100) / 100, a[3], a[4], a[5], a[6], a[7], a[8], Math.round(a[9] * 100) / 100, a[10], Math.round(a[11] * 100) / 100, a[12]]), n++;
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

  // (the rain and snow over each outdoor final's window: one ask of the archive per stadium and season, for
  // its finals not asked yet, the newest seasons first. The archive runs a few days behind, so a final is
  // asked once it's 6 days old (till then its rain is unknown: 0, no effect). The archive counts a long range
  // as many calls: 40 asks and a minute a run at most, the rest next run, so the first fill takes a few runs.
  // A final the archive answered without its hours is null, not asked again, once it's 14 days old (well past
  // the archive's delay; a newer one is asked again next run). Then how much of it is filled: facts.wxCover,
  // the share of the outdoor finals 14 days old or more with their rain known (context.mjs WEATHER.nfl keeps
  // the rain and snow out of every fit, the props' too, till it's 95%: a final not filled yet is unknown, not
  // dry, and a fit on a partly filled history would take its rain games for dry ones)
  if (part === 'precip') {
    const placeOf = new Map(Object.entries(STADIUMS));
    for (const g of history) {
      const r = rows.get(g.id);
      if (r?.stadium_id && g.venue && facts.places?.[g.venue] && !g.neutral) placeOf.set(r.stadium_id, facts.places[g.venue]);
    }
    for (const [id, f] of Object.entries(facts.fields)) if (f?.at) placeOf.set(id, f.at);
    const ripe = Date.now() - 6 * DAY;
    const settled = Date.now() - 14 * DAY;
    const wet = new Map();
    for (const g of finals) {
      const r = rows.get(g.id);
      if (g.id in facts.wx || !['outdoors', 'open'].includes(r.roof) || Date.parse(g.date) > ripe || !placeOf.has(r.stadium_id)) continue;
      const key = `${r.stadium_id}|${g.season}`;
      wet.set(key, [...(wet.get(key) ?? []), g]);
    }
    const asks = [...wet].sort((a, b) => b[1][0].season - a[1][0].season).slice(0, 40);
    const stop = Date.now() + 60e3;
    let n = 0;
    await pool(asks, 2, async ([key, games]) => {
      if (Date.now() > stop) return;
      const days = games.map((g) => g.date.slice(0, 10)).sort();
      const at = await precipHistory(placeOf.get(key.split('|')[0]), days[0], isoDay(Date.parse(days.at(-1)) + DAY));
      if (!at) return;
      for (const g of games) {
        const w = at(g.date);
        if (w) (facts.wx[g.id] = [w.precip, w.snow]), n++;
        else if (Date.parse(g.date) <= settled) facts.wx[g.id] = null;
      }
    });
    let known = 0;
    let of = 0;
    for (const g of finals) {
      const r = rows.get(g.id);
      if (!['outdoors', 'open'].includes(r.roof) || Date.parse(g.date) > settled || !placeOf.has(r.stadium_id)) continue;
      of++;
      if (facts.wx[g.id]) known++;
    }
    facts.wxCover = { share: of ? Math.round((known / of) * 1000) / 1000 : 0, of };
    if (asks.length || facts.wxCover.share < WX_COVER) console.log(`nfl: rain and snow for ${n} finals (${asks.length} of ${wet.size} stadium seasons asked); ${known} of ${of} outdoor finals known${facts.wxCover.share < WX_COVER ? `, under ${WX_COVER * 100}%: the rain and snow left out of the fits till then` : ''}`);
  }
}

// The NFL's second-round terms for each game, in date order
export function footballOf(facts, live) {
  const eff = new Map();
  // (each defense's pass funnel: the props' own measure, matchups.mjs passFunnel, from the plays; and each
  // offense's plays so far, each defense's pace against them)
  const funnel = passFunnel();
  const off = new Map();
  const def = new Map();
  const lg = { plays: 62 };
  const decay = (x, season) => (!x ? null : x.season === season ? x : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'season' ? season : x.season === season - 1 ? v * 0.5 : 0])));
  const defense = (id, season) => {
    const d = decay(def.get(id), season);
    return { funnel: funnel.of(id, season), pace: d ? d.pace / (d.n + 4) : 0 };
  };
  // (each team's home field's kind (its home finals so far), and its head coaches: the one now, the one
  // before him, and his games so far; by nflverse's team codes)
  const homeField = new Map();
  const coaches = new Map();
  // (a team's first four games under a new head coach (a hire or an interim's, not its first season in the
  // history): this game's coach by the schedule, else the one now)
  const newCoach = (code, named) => {
    const c = coaches.get(code);
    if (!c) return 0;
    if (named && named !== c.coach) return 1;
    return c.before && c.games < 4 ? 1 : 0;
  };
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
    // (each side's defense: its funnel and pace so far)
    const dh = defense(g.home, g.season);
    const da = defense(g.away, g.season);
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
    // (the schedule's facts, known before the game: a division game; each side's kickoff by its own home
    // clock, early before 11; a field of the other kind from its home's (a side whose home field isn't known
    // yet, none); its first games under a new coach)
    const div = r?.div_game === '1' ? 1 : 0;
    const homeGame = !g.neutral && r?.location !== 'Neutral';
    const early = (code) => (code && hourAt(code, g.date) < 11 ? 1 : 0);
    const kind = fieldKind(r?.surface);
    const foreign = (code) => (kind && homeField.get(code) && homeField.get(code) !== kind ? 1 : 0);
    const clock = r ? [early(r.home_team), early(r.away_team)] : [0, 0];
    const other = r ? [foreign(r.home_team), foreign(r.away_team)] : [0, 0];
    const coach = r ? [newCoach(r.home_team, r.home_coach), newCoach(r.away_team, r.away_coach)] : [0, 0];
    return {
      terms: {
        nsEpa: (h.net - a.net) * 10,
        nsEpaT: (h.off + a.off + h.def + a.def) * 10,
        olChanges: ol ? (ol[1] ?? 0) - (ol[0] ?? 0) : 0,
        crosswind: Math.max(0, cross - 10) / 10,
        funnelT: (dh.funnel + da.funnel) * 10,
        paceT: (dh.pace + da.pace) * 10,
        divHome: div && homeGame ? 1 : 0,
        divT: div,
        bodyClock: clock[1] - clock[0],
        surface: other[1] - other[0],
        newCoach: coach[1] - coach[0],
      },
      info: { epa: [r3(h.net), r3(a.net)], olChanged: ol ?? null, crosswind: r3(cross), funnel: [r3(dh.funnel), r3(da.funnel)], pace: [r3(dh.pace), r3(da.pace)], division: !!div, earlyClock: clock, otherField: other, newCoach: coach },
      flags,
      learn: () => {
        // (the home field's kind and the coaches, from the schedule's row)
        if (r) {
          if (homeGame && kind) homeField.set(r.home_team, kind);
          for (const [code, name] of [
            [r.home_team, r.home_coach],
            [r.away_team, r.away_coach],
          ]) {
            if (!code || !name) continue;
            const c = coaches.get(code);
            if (!c) coaches.set(code, { coach: name, before: null, games: 1 });
            else if (c.coach !== name) coaches.set(code, { coach: name, before: c.coach, games: 1 });
            else c.games++;
          }
        }
        const p = facts.plays?.[g.id];
        if (!p) return;
        if (p.length >= 9) {
          for (const [team, opp, home] of [
            [g.home, g.away, true],
            [g.away, g.home, false],
          ]) {
            const side = sideOfPlays(p, home);
            const plays = side.plays;
            if (plays < 20) continue;
            funnel.learn(team, opp, g.season, side);
            const o = decay(off.get(team), g.season) ?? { season: g.season, plays: 0, n: 0 };
            const normPlays = (o.plays + 3 * lg.plays) / (o.n + 3);
            const d = decay(def.get(opp), g.season) ?? { season: g.season, pace: 0, n: 0 };
            d.pace += plays / normPlays - 1;
            d.n++;
            def.set(opp, d);
            o.plays += plays;
            o.n++;
            off.set(team, o);
            lg.plays += (plays - lg.plays) / 500;
          }
        }
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
