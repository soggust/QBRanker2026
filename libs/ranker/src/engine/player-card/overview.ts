// The Overview's words: the scouting report, the one-line take, the archetype, and the flags the
// profile's shape raises
import { SkillPlayer, SkillPosition, SkillStat } from '@sport/positions';
import { SPORT } from '@sport/sport';
import { ARCHETYPES, SKILLS, SKILL_DERIVED, SKILL_MINIMUMS, VOLUME_VS_EFFICIENCY, WINS_VS_PLAY, fallbackArchetype } from '@sport/skills';
import { CardFlag } from '@ranker/engine/sport';
import { CardSkill, derivedRate, qualifies, standing, tierWord } from '@ranker/engine/skills';
import { skillDefinition, skillPartLabel } from './hover-text';
import { StatReader } from '@ranker/engine/stat-reader';
import { CardOverview } from './card.model';

// Each skill as a percentile in the list: the weighted average of its stats' percentiles (volume stats
// per game; each part's weight 1 unless its definition says), each stat turned the skill's way. Stats a
// season didn't record are skipped, and so is a rate stat for a player without the volume it needs (the
// sport's SKILL_MINIMUMS), who is also left out of the others' pool on it; a skill with none of its stats
// is left out. A part can name a stat only skills read (the sport's SKILL_DERIVED: saves and holds as one). (The card's, and the compare view's: one way of reading a season.)
export function skillsOf(position: SkillPosition, stats: SkillStat[], reader: StatReader, player: SkillPlayer, list: SkillPlayer[]): CardSkill[] {
  const out: CardSkill[] = [];
  const minimums = SKILL_MINIMUMS[position] ?? {};
  // (the tab's columns, and the stats only skills read where the tab has no column for them)
  const derived = Object.values(SKILL_DERIVED).filter((d) => !stats.some((s) => s.key === d.key));
  const readable = [...stats, ...derived];
  for (const def of SKILLS[position]) {
    let sum = 0;
    let weights = 0;
    const evidence: CardSkill['evidence'] = [];
    for (const [key, dir, weight = 1] of def.parts) {
      const column = stats.find((s) => s.key === key);
      const extra = column ? undefined : derived.find((d) => d.key === key);
      if ((!column || reader.empty(key)) && !extra) continue;
      if (weight <= 0) continue;
      const rate = (p: SkillPlayer) => (extra ? derivedRate(extra, p) : reader.rate(p, column!));
      const minimum = minimums[key];
      if (!qualifies(minimum, player)) continue;
      const mine = rate(player);
      if (mine === null) continue;
      const values = list.flatMap((p) => {
        const v = qualifies(minimum, p) ? rate(p) : null;
        return v === null ? [] : [v];
      });
      if (values.length < 3) continue;
      const below = values.filter((v) => v < mine).length;
      const equal = values.filter((v) => v === mine).length - 1;
      const high = (below + equal / 2) / (values.length - 1);
      sum += weight * (dir > 0 ? high : 1 - high);
      weights += weight;
      const rank = 1 + values.filter((v) => (dir > 0 ? v > mine : v < mine)).length;
      const label = skillPartLabel(column ?? extra!);
      if (!evidence.some((e) => e.label === label)) evidence.push({ label, rank, of: values.length });
    }
    if (!weights) continue;
    const pct = sum / weights;
    out.push({
      id: def.id,
      name: def.name,
      short: def.short,
      pct,
      tier: tierWord(pct),
      standing: standing(pct),
      evidence: evidence.sort((a, b) => a.rank / a.of - b.rank / b.of),
      about: skillDefinition(def, readable, minimums),
    });
  }
  return out;
}

// The scouting report: every skill, best first, split into strengths, average and weaknesses
export function scoutingReport(skills: CardSkill[]) {
  const sorted = [...skills].sort((a, b) => b.pct - a.pct);
  const strengths = sorted.filter((s) => s.pct >= 0.65);
  const weaknesses = sorted.filter((s) => s.pct <= 0.35);
  const average = sorted.filter((s) => s.pct > 0.35 && s.pct < 0.65);
  const report: CardOverview['report'] = [
    { title: 'Strengths', tone: 'good', icon: 'trending_up', list: strengths },
    { title: 'Average', tone: 'mid', icon: 'trending_flat', list: average },
    { title: 'Weaknesses', tone: 'bad', icon: 'trending_down', list: weaknesses },
  ];
  return { strengths, weaknesses, report };
}

// "Elite accuracy and strong efficiency, held back by poor ball security." (weaknesses: worst first)
export function overviewBlurb(strengths: CardSkill[], weaknesses: CardSkill[]): string {
  const say = (s: CardSkill) => `${s.tier.toLowerCase()} ${s.name.toLowerCase()}`;
  const [a, b] = strengths.filter((s) => s.pct >= 0.75);
  const weak = weaknesses[0];
  let text: string;
  if (a) {
    text = say(a) + (b ? ` and ${say(b)}` : '');
    if (weak) text += `, held back by ${say(weak)}`;
  } else if (weak) {
    text = `No standout skill, and ${say(weak)} drags on the rest`;
  } else {
    text = 'A balanced profile with no glaring strength or weakness';
  }
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

// Each of the position's skills' percentile (0.5 for a skill the season didn't have)
export function skillScores(position: SkillPosition, skills: CardSkill[]): Record<string, number> {
  const scores: Record<string, number> = Object.fromEntries(SKILLS[position].map((def) => [def.id, 0.5]));
  for (const skill of skills) scores[skill.id] = skill.pct;
  return scores;
}

// The first of the position's archetypes the skills fit (overall: where they rank, 0 to 1)
export function archetypeFor(position: SkillPosition, skills: CardSkill[], overall: number, player: SkillPlayer): string {
  const scores = skillScores(position, skills);
  return ARCHETYPES[position].find((a) => a.test(scores, overall, player))?.name ?? fallbackArchetype(position, overall, player);
}

// The shape of the profile (no holes, or one skill carrying the rest), and results against the play
// and volume against efficiency, where the position has those skills
export function profileFlags(position: SkillPosition, scores: Record<string, number>): CardFlag[] {
  const flags: CardFlag[] = [];
  const pcts = Object.values(scores);
  const elite = pcts.filter((p) => p >= 0.85).length;
  if (pcts.length >= 4 && pcts.every((p) => p >= 0.5) && pcts.filter((p) => p >= 0.7).length >= pcts.length / 2) {
    flags.push({ icon: SPORT.copy.noHolesIcon, tone: 'good', text: 'No holes: at least average in every skill' });
  } else if (elite === 1 && pcts.filter((p) => p >= 0.6).length === 1) {
    const star = SKILLS[position].find((def) => scores[def.id] >= 0.85)!;
    flags.push({ icon: 'looks_one', tone: 'info', text: `One-dimensional: ${star.name} carries the profile` });
  }
  // Winning more (or less) than the play says
  const results = WINS_VS_PLAY[position];
  if (results) {
    const [win, play] = results.map((id) => scores[id]);
    if (win >= 0.7 && play <= 0.35) {
      flags.push({ icon: 'casino', tone: 'info', text: SPORT.copy.winsOverPlay });
    } else if (play >= 0.7 && win <= 0.3) {
      flags.push({ icon: 'sentiment_dissatisfied', tone: 'info', text: SPORT.copy.playOverWins });
    }
  }
  const split = VOLUME_VS_EFFICIENCY[position];
  if (split) {
    const [volume, efficiency] = split.map((id) => scores[id]);
    if (volume >= 0.7 && efficiency <= 0.35) {
      flags.push({ icon: 'stacked_bar_chart', tone: 'bad', text: SPORT.copy.volumeOverEfficiency });
    } else if (efficiency >= 0.75 && volume <= 0.35) {
      flags.push({ icon: 'bolt', tone: 'good', text: SPORT.copy.efficiencyOverVolume });
    }
  }
  return flags;
}

// Good first, then neutral, then bad
export function sortFlags(flags: CardFlag[]): CardFlag[] {
  const order = { good: 0, info: 1, bad: 2 };
  return [...flags].sort((a, b) => order[a.tone] - order[b.tone]);
}
