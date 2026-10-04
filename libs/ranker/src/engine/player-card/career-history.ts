// The Overview's career history: where they are in their career, how this season compares with their
// norm, streaks, their calling card and a long-running issue, and a change of profile. Career to date
// only (never later seasons, so a 2021 card reads like it did in 2021).
import { SkillPosition } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { CardFlag } from '@ranker/engine/sport';
import { standing } from '@ranker/engine/skills';
import { ordinal } from '@ranker/core/format';
import { CareerSeason } from './card.model';

const average = (values: number[]) => values.reduce((a, x) => a + x, 0) / values.length;

// played: every season they're in up to this one; entries: those they're ranked in (a season under
// Min Games, or hidden as injured, isn't)
export function careerHistory(
  position: SkillPosition,
  season: number,
  played: number[],
  entries: CareerSeason[],
  // (the archetype came from run blocking: last season's was worked out without it, so a change of
  // profile doesn't apply)
  blockingArchetype = false,
): CardFlag[] {
  const n = played.length;
  // (a player already in the data's first season wasn't necessarily a rookie)
  const known = played[0] > SPORT.firstSeason;
  const now = entries.find((e) => e.season === season)!;
  const prior = entries.filter((e) => e.season < season);
  const careerAvg = average(entries.map((e) => e.pct));
  const priorAvg = prior.length ? average(prior.map((e) => e.pct)) : null;
  const flags: CardFlag[] = [];

  // (the stage leans on recent form: the last three seasons count most)
  const recent = average(entries.slice(-3).map((e) => e.pct));
  // (a decline is two down years running, each well under the norm before it)
  const last = prior[prior.length - 1];
  const before = prior.slice(0, -1);
  const declining =
    !!last && before.length >= 2 && priorAvg !== null && now.pct <= priorAvg - 0.2 && last.pct <= average(before.map((e) => e.pct)) - 0.2;
  flags.push(careerStage(position, n, known, now.pct, 0.6 * recent + 0.4 * careerAvg, priorAvg, declining));

  if (priorAvg !== null) {
    // (a breakout or down year is against their recent norm, the last three seasons: a rough first
    // couple of years shouldn't make an established star's usual season read as a breakout)
    const recentNorm = average(prior.slice(-3).map((e) => e.pct));
    const delta = now.pct - recentNorm;
    if (prior.length >= 2 && prior.every((e) => e.pct < now.pct)) {
      flags.push({ icon: 'emoji_events', tone: 'good', text: 'Best season of the career so far' });
    } else if (delta >= 0.2 && now.pct >= 0.6) {
      flags.push({ icon: 'rocket_launch', tone: 'good', text: `Breakout year: up from ${normWords(recentNorm)} before this` });
    } else if (delta <= -0.2) {
      flags.push({ icon: 'south', tone: 'bad', text: `Down year by their standards (${normWords(recentNorm)} before this)` });
    }
  }

  // A run of top-20% seasons ending with this one (back-to-back years only)
  if (now.pct >= 0.8) {
    let streak = 1;
    for (let y = season - 1; entries.some((e) => e.season === y && e.pct >= 0.8); y--) streak++;
    if (streak >= 2) flags.push({ icon: 'local_fire_department', tone: 'good', text: `${ordinal(streak)} straight top-20% season` });
  }

  // Skills across the career so far (two seasons or more): their calling card and a long-running issue
  if (entries.length >= 2) {
    const series = now.skills.map((skill) => {
      const values = entries.map((e) => e.skills.find((s) => s.id === skill.id)?.pct).filter((v): v is number => v !== undefined);
      return { name: skill.name, values, avg: average(values) };
    });
    const seasonsWord = (counted: number) => (counted < entries.length ? 'tracked seasons' : 'seasons');
    const strength = series.filter((s) => s.values.length >= 2 && s.avg >= 0.7).sort((a, b) => b.avg - a.avg)[0];
    if (strength) {
      const years = strength.values.filter((v) => v >= 0.65).length;
      flags.push({
        icon: 'verified',
        tone: 'good',
        text: `Calling card: ${strength.name} (a strength in ${years} of ${strength.values.length} ${seasonsWord(strength.values.length)})`,
      });
    }
    const issue = series.filter((s) => s.values.length >= 2 && s.avg <= 0.3).sort((a, b) => a.avg - b.avg)[0];
    if (issue) {
      const years = issue.values.filter((v) => v <= 0.35).length;
      flags.push({
        icon: 'report',
        tone: 'bad',
        text: `Long-running issue: ${issue.name} (a weakness in ${years} of ${issue.values.length} ${seasonsWord(issue.values.length)})`,
      });
    }
  }

  if (last && last.archetype !== now.archetype && !blockingArchetype) {
    flags.push({ icon: 'swap_horiz', tone: 'info', text: `New profile: a ${last.archetype} in ${last.season}` });
  }
  return flags;
}

// 'bottom 34%' / 'top 12%' / 'the middle of the pack'
function normWords(pct: number): string {
  const s = standing(pct);
  return s === 'Middle of the pack' ? 'the middle of the pack' : s.toLowerCase();
}

// Where they are in their career: the stage (by seasons played) and how good they've been so far (the
// career average rank, with this season's weight in it)
function careerStage(
  position: SkillPosition,
  n: number,
  known: boolean,
  now: number,
  careerAvg: number,
  priorAvg: number | null,
  declining: boolean,
): CardFlag {
  const coach = position === SPORT.coachTab;
  const team = SPORT.roleWord(position);
  const who = coach ? 'head coach' : team;
  const tone = (p: number): CardFlag['tone'] => (p >= 0.6 ? 'good' : p <= 0.35 ? 'bad' : 'info');
  const seasons = known ? `${ordinal(n)} season` : `${n} seasons since ${SPORT.seasonText(SPORT.firstSeason)}`;
  const say = (text: string, p: number, icon = 'military_tech'): CardFlag => ({ icon, tone: tone(p), text: `${text} (${seasons})` });

  // First year: all about this season
  if (known && n === 1) {
    if (coach) return say(now >= 0.75 ? 'Instant-impact first-year coach' : now >= 0.45 ? 'Promising first-year coach' : 'First-year coach still finding their way', now, 'fiber_new');
    return say(now >= 0.75 ? 'Instant-impact rookie' : now >= 0.45 ? 'Promising rookie' : 'Rookie still finding their footing', now, 'fiber_new');
  }
  // Early career (years 2-3): what they're becoming
  if (known && n <= 3) {
    if (careerAvg >= 0.75) return say(coach ? 'Rising star coach' : 'Bright young star', careerAvg);
    if (priorAvg !== null && now - priorAvg >= 0.2) return say(coach ? 'Coach on the rise' : 'Ascending young player', now);
    if (careerAvg >= 0.45) return say(coach ? 'Promising young coach' : `Developing ${team}`, careerAvg);
    return say('Unproven so far', careerAvg);
  }
  // Late career (8+ seasons): a veteran, and whether it's holding up
  if (n >= 8) {
    if (declining) return say(`Veteran ${coach ? 'coach' : team} showing decline`, now);
    if (careerAvg >= 0.75) return say(coach ? 'Veteran elite coach' : 'Veteran star', careerAvg);
    if (careerAvg >= 0.5) return say(`Seasoned veteran ${who}`, careerAvg);
    return say(coach ? 'Long-tenured coach' : 'Veteran journeyman', careerAvg);
  }
  // Prime (years 4-7): established, or not
  if (careerAvg >= 0.75) return say(coach ? 'Established elite coach' : 'Established star', careerAvg);
  if (careerAvg >= 0.5) return say(`Established ${who}`, careerAvg);
  if (priorAvg !== null && now - priorAvg >= 0.25) return say('Late bloomer', now);
  return say(coach ? 'Middling coach so far' : 'Journeyman', careerAvg);
}
