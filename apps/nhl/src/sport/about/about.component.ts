import { Component, EventEmitter, Output } from '@angular/core';
import { AboutSection } from '@ranker/engine/about/about-frame.component';

// NHL Ranker's About / FAQ, opened from the info button in every table's footer (the shared frame:
// libs/ranker/src/engine/about)
@Component({
  selector: 'about-panel',
  templateUrl: './about.component.html',
  styleUrls: ['../../../../../libs/ranker/src/styles/components/about-content.scss'],
  standalone: false,
})
export class AboutComponent {
  @Output() closed = new EventEmitter<void>();

  readonly sections: AboutSection[] = [
    { id: 'about', title: 'Guide' },
    { id: 'ranking', title: 'Rankings' },
    { id: 'grades', title: 'Player Card' },
    { id: 'tips', title: 'Tips' },
    { id: 'glossary', title: 'Stats' },
    { id: 'faq', title: 'FAQ' },
    { id: 'data', title: 'Credits' },
  ];

  // Glossary entries: stat, what it means
  readonly glossary: [string, string][] = [
    ["Goals / Assists / Points", "Goals, assists and points: season totals to start, or per game or an 82-game pace (Stat Totals in the settings)."],
    ["+/-", "Plus/minus: goals for minus goals against while he is on the ice at even strength or shorthanded. Noisy: it depends on his linemates and his goalie."],
    ["PP Points", "Power-play points."],
    ["Shots / Shooting %", "Shots on goal, and goals per shot on goal (20+ shots to show)."],
    ["GWG", "Game-winning goals."],
    ["Hits / Blocks / Takeaways / Giveaways", "Hits, shots blocked, takeaways and giveaways (lower is better)."],
    ["PIM", "Penalty minutes (lower is better)."],
    ["Faceoff %", "Faceoffs won, for centers (50+ faceoffs to show)."],
    ["TOI", "Time on ice per game, in minutes: his role (for context; not part of the ranking)."],
    ["Game Score", "MoneyPuck's one-number season: goals, assists, shots, blocks, penalties, faceoffs and his line's shots and goals, each weighted by what it's worth."],
    ["xGF % / CF %", "His team's share of the expected goals (chance quality) and of all shot attempts (Corsi: who has the puck) while he's on the ice at 5-on-5. 50% is even."],
    ["Rel xGF %", "xGF % with him on the ice minus with him off, in points: how much better his team is with him out there."],
    ["ixG / G - xG", "Expected goals from his own shots (what his chances were worth), and goals beyond that: finishing skill, and over one season a lot of luck."],
    ["HD Shots", "High-danger shots: from the slot and in close, where most goals come from."],
    ["Record", "His team's record, wins-losses-overtime losses, ranked on points percentage (a goalie: his own decisions)."],
    ["Save % / GAA", "Save percentage (50+ shots) and goals against per 60 minutes (lower is better)."],
    ["GSAx / GSAx / 60", "Goals saved above expected: the goals an average goalie would have allowed on his shots, by their quality, minus the goals he allowed. Per 60 minutes too (300+ minutes)."],
    ["HD Save %", "Save percentage on high-danger shots (20+ of them)."],
    ["Coaching Lift", "A head coach's team's 5-on-5 expected-goal share over what its skaters predicted (their share last season, weighted by their ice time), in points. Every player's Coaching grade is his team's lift, F to A+."],
    ["Pts vs Goal Diff", "A coach's standings points beyond what his goals for and against imply: close games, overtime and shootouts."],
    ["Linemates / Defense / Coaching", "Support grades, F to A+: how good his team was without him (its expected-goals share with him on the bench), for goalies the defense in front of him (the quality of the shots he faced), and his team's coaching (its Coaching Lift). Better support counts slightly against a player. Early in a season a few games barely measure a team, so each grade starts from the team's grade last season and gives way to this season's: about half this season by 5 games, all of it from game 20 of 82 on (a past season is all its own results)."],
  ];
}
