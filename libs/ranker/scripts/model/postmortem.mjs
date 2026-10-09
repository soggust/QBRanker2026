// A graded bet's post-mortem: why it won or lost, from the game's ESPN summary (kept under
// .cache/model/summaries, its box score, header and story only). Code only, no AI:
//
//   recap      the story's headline, its first sentence or two, the link to it
//   disrupted  what happened in the game that broke the bet's premise, each against the player's usual role
//              in the games before this one: an NFL quarterback replaced, or a regular's snaps far under his
//              usual (nflverse's snap counts, once posted); an NBA top-minutes player well under his minutes
//              (not in a blowout: that's rest), or ejected; an NHL starting goalie pulled; an MLB starter gone
//              before the 3rd inning or 40 pitches; and the story's own lines about someone hurt or thrown
//              out. Overtime (extra innings) and a blowout are noted too, but they don't break a premise.
//   miss       how far off the call was: the expected margin and total against the final, and the line
//   why        all of it in a line: "Lost: Joe Burrow left at QB (13 att; Jake Browning 32); CIN by 4 vs our JAX by 2"
//
// A bet whose premise broke (any of the first kind) counts less in what the desk learns from its graded
// bets (DISRUPTED_WEIGHT, in run.mjs): an in-game injury is noise, not evidence against the model.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { summary } from './espn.mjs';
import { CACHE, nflverseRows, pool } from './sources.mjs';
import { intentOf } from './desk.mjs';

const REGULATION = { nfl: 4, nba: 4, nhl: 3, mlb: 9 };
const BLOWOUT = { nfl: 24, nba: 25, nhl: 4, mlb: 8 };
const HURT = /injur|left the game|exited|did not return|didn't return|helped off|carted|concussion|ejected|tossed/i;
// (a story line that says a player went out during the game; a manager's or coach's ejection, or a player
// rested or out before it, is only noted)
const EXIT = /left the game|left in the|exited|did not return|didn't return|helped off|carted off|(was|were) ejected|tossed/i;
const NOT_PLAYER = /manager|coach|bench boss|rested|was out with|missed the game|sat out|did not play|didn't play/i;

// (a bet with no edge, placed for the data, says so: its result is no verdict on the model's judgement)
export { intentOf };
const actionTag = (bet) => (intentOf(bet) === 'action' ? ' (action bet: no edge, placed for the data)' : '');

// A final's summary, kept (only the parts the post-mortem reads)
export async function finalSummary(sport, league, id) {
  const file = path.join(CACHE, 'summaries', `${sport}-${id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const body = await summary(league, id);
  if (!body?.boxscore) return null;
  const kept = { header: body.header, boxscore: body.boxscore, article: body.article ? { headline: body.article.headline, story: body.article.story, links: body.article.links } : null };
  if (body.header?.competitions?.[0]?.status?.type?.completed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(kept));
  }
  return kept;
}

// The story's headline, first sentence or two, and link
export function recapOf(body) {
  const text = (body.article?.story ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[A-Z .,'-]+ -- —?\s*/, '')
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) ?? [];
  const link = body.article?.links?.web?.href ?? body.header?.links?.find((l) => /recap/.test(l.href))?.href ?? body.header?.links?.[0]?.href ?? null;
  return { headline: body.article?.headline ?? null, lede: sentences.slice(0, 2).join(' ') || null, link, sentences };
}

// (a box score's side by ESPN team id: 'h' or 'a')
const sideOf = (game, team) => (String(team?.id) === String(game.home) ? 'h' : String(team?.id) === String(game.away) ? 'a' : null);
const abbrOf = (game, where) => (where === 'h' ? game.homeAbbr : game.awayAbbr);

// What broke the premise, and what's only worth noting, for a final (usual: the players' roles before it)
export function eventsOf(sport, game, body, usual) {
  const events = [];
  const add = (severe, kind, text) => events.push({ severe, kind, text });
  const margin = game.hs - game.as;
  const blowout = Math.abs(margin) >= BLOWOUT[sport];
  const periods = Math.max(...(body.header?.competitions?.[0]?.competitors ?? []).map((c) => c.linescores?.length ?? 0), 0);
  if (periods > REGULATION[sport]) add(false, 'overtime', sport === 'mlb' ? `${periods} innings` : periods - REGULATION[sport] > 1 ? `${periods - REGULATION[sport]} overtimes` : 'overtime');
  if (blowout) add(false, 'blowout', `a blowout (by ${Math.abs(margin)})`);
  for (const p of body.boxscore?.players ?? []) {
    const where = sideOf(game, p.team);
    if (!where) continue;
    const team = abbrOf(game, where);
    if (sport === 'nfl') {
      const s = p.statistics?.find((x) => x.name === 'passing');
      const qbs = (s?.athletes ?? []).map((a) => ({ name: a.athlete.displayName, att: Number(String(a.stats[0]).split('/')[1]) || 0 })).filter((q) => q.att > 0);
      const total = qbs.reduce((x, q) => x + q.att, 0);
      const starter = usual?.qb?.(where) ?? qbs[0]?.name;
      const start = qbs.find((q) => q.name === starter);
      const other = qbs.filter((q) => q.name !== starter).sort((a, b) => b.att - a.att)[0];
      if (start && other && other.att >= 5 && start.att < 0.6 * total) add(true, 'qb', `${start.name} left at QB (${start.att} att; ${other.name} ${other.att})`);
    }
    if (sport === 'nba') {
      const s = p.statistics?.[0];
      const at = (s?.labels ?? []).indexOf('MIN');
      for (const a of s?.athletes ?? []) {
        if (a.ejected) add(true, 'ejection', `${a.athlete.displayName} ejected (${team})`);
        const min = Number(a.stats?.[at]) || 0;
        const was = usual?.minutes?.(String(a.athlete.id));
        if (!was || was < 28 || a.didNotPlay || min >= 0.6 * was || a.ejected) continue;
        if (blowout) add(false, 'rest', `${a.athlete.displayName} rested in the blowout (${min} min, usual ${Math.round(was)})`);
        else add(true, 'minutes', `${a.athlete.displayName} played ${min} min (usual ${Math.round(was)}, ${team})`);
      }
    }
    if (sport === 'nhl') {
      const s = p.statistics?.find((x) => x.name === 'goalies');
      const toi = (s?.labels ?? []).indexOf('TOI');
      const list = (s?.athletes ?? []).map((a) => ({ name: a.athlete.displayName, min: Number(String(a.stats[toi]).split(':')[0]) || 0, ga: a.stats[0], sa: a.stats[1] }));
      if (list.length > 1 && list[1].min >= 5) add(true, 'goalie', `${list[0].name} pulled (${list[0].ga} goal${list[0].ga === 1 ? '' : 's'} on ${list[0].sa} shots, ${team})`);
    }
    if (sport === 'mlb') {
      const s = p.statistics?.find((x) => x.type === 'pitching' || x.name === 'pitching');
      if (!s) continue;
      const ip = (s.labels ?? []).indexOf('IP');
      const pc = (s.labels ?? []).indexOf('PC-ST');
      const first = s.athletes?.[0];
      if (!first) continue;
      const [whole, part] = String(first.stats[ip] ?? '0').split('.').map(Number);
      const outs = whole * 3 + (part || 0);
      const pitches = Number(String(first.stats[pc] ?? '').split('-')[0]) || null;
      if (outs < 6 || (pitches !== null && pitches < 40)) {
        // (an opener, a reliever starting by design: his appearances before averaged under 3 innings)
        const usualOuts = usual?.outs?.(first.athlete.displayName);
        const opener = usualOuts !== null && usualOuts !== undefined && usualOuts < 9;
        add(!opener, opener ? 'opener' : 'starter', `${first.athlete.displayName} ${opener ? 'opened' : 'out early'} (${first.stats[ip]} IP${pitches ? `, ${pitches} pitches` : ''}, ${team})`);
      }
    }
  }
  // (an NFL regular whose snaps fell far under his usual: a mid-game exit, from nflverse's snap counts)
  // (a quarterback's or skill player's breaks the premise, outside a blowout; a lineman's or defender's is
  // noted: every NFL game loses a few)
  for (const x of usual?.snaps?.() ?? []) add(!blowout && ['QB', 'RB', 'WR', 'TE'].includes(x.pos), 'snaps', `${x.name} played ${x.snaps} snaps (usual ${x.usual}, ${x.team})`);
  // (the story's own lines about someone hurt or thrown out: noted; the box score's measures above decide
  // whether the premise broke, the story only says it when it names a quarterback or goalie going out)
  const recap = recapOf(body);
  for (const s of recap.sentences.filter((s) => HURT.test(s)).slice(0, 2)) {
    const key = /quarterback|QB|goalie|goaltender|starter|starting pitcher/i.test(s) && EXIT.test(s) && !NOT_PLAYER.test(s);
    if (!events.some((e) => e.severe && s.includes(e.text.split(' ')[1] ?? '@@'))) add(key, 'story', s.length > 160 ? `${s.slice(0, 157)}...` : s);
  }
  return { events, recap };
}

// A bet's post-mortem from its game's summary
export function postmortem(sport, bet, game, body, usual) {
  const { events, recap } = eventsOf(sport, game, body, usual);
  const margin = game.hs - game.as;
  const total = game.hs + game.as;
  const miss = { expMargin: bet.expMargin ?? null, margin, expTotal: bet.expTotal ?? null, total, line: bet.line ?? null };
  const by = (m) => (m === 0 ? 'even' : `${m > 0 ? game.homeAbbr : game.awayAbbr} by ${Math.abs(Math.round(m * 10) / 10)}`);
  const call =
    bet.market === 'total'
      ? `${total} total vs our ${Math.round((bet.expTotal ?? 0) * 10) / 10} (line ${bet.line})`
      : `${by(margin)} vs our ${by(bet.expMargin ?? 0)}`;
  const severe = events.filter((e) => e.severe);
  const said = [...severe, ...events.filter((e) => ['overtime', 'blowout', 'rest'].includes(e.kind))].slice(0, 3).map((e) => e.text);
  const status = bet.status === 'won' ? 'Won' : bet.status === 'lost' ? 'Lost' : 'Push';
  return {
    recap: { headline: recap.headline, lede: recap.lede, link: recap.link },
    disrupted: events,
    miss,
    why: `${status}${actionTag(bet)}: ${[...said, call].join('; ')}`,
    broken: severe.length > 0,
  };
}

// The players' usual roles before a game, for the post-mortem: an NBA player's minutes this season (the kept
// box scores), an NFL team's starting quarterback (nflverse) and its regulars' snaps (snap counts, the
// three games before against this one)
export async function usualRoles(sport, game, facts, history) {
  if (sport === 'nba') {
    const mins = new Map();
    for (const g of history) {
      if (g.season !== game.season || g.date >= game.date) continue;
      const box = facts.games?.[g.id];
      for (const where of ['h', 'a']) for (const [id, min] of box?.[where] ?? []) mins.set(id, [...(mins.get(id) ?? []), min]);
    }
    return { minutes: (id) => (mins.get(id)?.length >= 5 ? mins.get(id).reduce((s, x) => s + x, 0) / mins.get(id).length : null) };
  }
  if (sport === 'mlb') {
    // (a pitcher's outs an appearance this season before the game, by name: StatsAPI's game logs)
    const day = Number(game.date.slice(0, 10).replace(/-/g, ''));
    const byName = new Map(Object.values(facts.pitchers ?? {}).map((p) => [p.n, p]));
    return {
      outs: (name) => {
        const rows = (byName.get(name)?.logs?.[game.season] ?? []).filter((r) => r[0] < day);
        return rows.length >= 3 ? rows.reduce((x, r) => x + r[1], 0) / rows.length : null;
      },
    };
  }
  if (sport !== 'nfl') return null;
  const row = facts.nfl?.get(game.id);
  const out = { qb: (where) => row?.[`${where === 'h' ? 'home' : 'away'}_qb_name`] || null, snaps: () => [] };
  if (!row) return out;
  const snaps = await nflverseRows('snap_counts', `snap_counts_${row.season}.csv.gz`, ['game_id', 'week', 'player', 'position', 'team', 'offense_snaps', 'offense_pct', 'defense_snaps', 'defense_pct'], 12);
  if (!snaps) return out;
  const week = Number(row.week);
  const mine = snaps.filter((s) => s.team === row.home_team || s.team === row.away_team);
  const now = mine.filter((s) => s.game_id === row.game_id);
  if (!now.length) return out;
  out.snaps = () => {
    const list = [];
    for (const s of now) {
      const before = mine.filter((x) => x.player === s.player && Number(x.week) < week && Number(x.week) >= week - 3);
      if (before.length < 2) continue;
      for (const side of ['offense', 'defense']) {
        const usualPct = before.reduce((x, b) => x + Number(b[`${side}_pct`] || 0), 0) / before.length;
        const pct = Number(s[`${side}_pct`] || 0);
        if (usualPct >= 0.7 && pct > 0 && pct < 0.35) {
          const usualSnaps = Math.round(before.reduce((x, b) => x + Number(b[`${side}_snaps`] || 0), 0) / before.length);
          list.push({ pos: s.position, name: s.player, snaps: Number(s[`${side}_snaps`]), usual: usualSnaps, team: s.team, drop: usualPct - pct });
        }
      }
    }
    return list.sort((a, b) => b.drop - a.drop).slice(0, 3);
  };
  return out;
}

// Post-mortems for graded bets (each game's summary asked once, a few at a time); bets without one get none.
// weight: what a bet whose premise broke counts for in the learning (the rest count 1)
export async function postmortems(sport, league, bets, games, facts, history, weight) {
  const ids = [...new Set(bets.map((b) => b.event))];
  const bodies = new Map();
  await pool(ids, 4, async (id) => bodies.set(id, await finalSummary(sport, league, id)));
  let done = 0;
  for (const bet of bets) {
    const game = games.get(bet.event);
    const body = bodies.get(bet.event);
    if (!game?.final || !body) continue;
    const usual = await usualRoles(sport, game, facts, history).catch(() => null);
    const { broken, ...pm } = postmortem(sport, bet, game, body, usual);
    Object.assign(bet, pm, { weight: broken ? weight : 1 });
    done++;
  }
  return done;
}

// A prop's post-mortem: what he did against the line and his projection, and whether he left the game early
// (his minutes, time on ice or plate appearances far under his usual this season, a quarterback replaced, a
// goalie pulled, a starter knocked out early, the story saying he went out): his early exit breaks the premise
export function propPostmortem(sport, bet, game, body, rows, weight, usual = null) {
  const recap = recapOf(body);
  const base = { recap: { headline: recap.headline, lede: recap.lede, link: recap.link } };
  if (bet.void) return { ...base, disrupted: [], why: `Void: ${bet.player} didn't play`, weight: 1 };
  const { events } = eventsOf(sport, game, body, usual);
  const mine = events.filter((e) => e.severe && e.text.includes(bet.player));
  // (his time in this game against his usual: minutes, time on ice, plate appearances)
  const key = sport === 'nba' ? 'MIN' : sport === 'nhl' ? 'TOI' : sport === 'mlb' ? 'AB' : null;
  const field = { nba: 'min', nhl: 'toi', mlb: 'pa' }[sport];
  if (key && !(sport === 'mlb' && /^(k|outs)$/.test(bet.propType))) {
    let now = null;
    for (const p of body.boxscore?.players ?? []) {
      for (const s of p.statistics ?? []) {
        const a = (s.athletes ?? []).find((x) => String(x.athlete?.id) === String(bet.athlete));
        const at = (s.labels ?? []).indexOf(key);
        if (!a || at < 0) continue;
        const v = String(a.stats[at] ?? '0');
        now = sport === 'nhl' ? Number(v.split(':')[0]) + Number(v.split(':')[1] ?? 0) / 60 : Number(v) + (sport === 'mlb' ? Number(a.stats[(s.labels ?? []).indexOf('BB')]) || 0 : 0);
      }
    }
    const before = rows.filter((r) => (r.pid === String(bet.athlete) || r.name === bet.player) && r.season === game.season && r.date < game.date).map((r) => r.s[field]).filter(Number.isFinite);
    const usual = before.length >= 3 ? before.reduce((s, x) => s + x, 0) / before.length : null;
    const blowout = events.some((e) => e.kind === 'blowout');
    if (!mine.length && now !== null && usual && now < 0.6 * usual && !(blowout && sport === 'nba')) mine.push({ severe: true, kind: 'early', text: `${bet.player} played ${Math.round(now * 10) / 10} ${sport === 'mlb' ? 'PA' : 'min'} (usual ${Math.round(usual * 10) / 10})` });
  }
  const notes = events.filter((e) => ['overtime', 'blowout'].includes(e.kind)).map((e) => e.text);
  const status = bet.status === 'won' ? 'Won' : bet.status === 'lost' ? 'Lost' : 'Push';
  const said = [`${bet.player} ${bet.actual} ${bet.statLabel} vs ${bet.line} (projected ${bet.projection?.mean ?? '?'})`, ...mine.map((e) => e.text), ...notes];
  return { ...base, disrupted: [...mine, ...events.filter((e) => !e.severe)], why: `${status}${actionTag(bet)}: ${said.slice(0, 3).join('; ')}`, weight: mine.length ? weight : 1 };
}
