import { Component, EventEmitter, Output } from '@angular/core';
import { AboutSection } from '@ranker/engine/about/about-frame.component';

// NFL Ranker's About / FAQ, opened from the info button in every table's footer (the shared frame:
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
    { id: 'grades', title: 'Grades' },
    { id: 'tips', title: 'Tips' },
    { id: 'glossary', title: 'Stats' },
    { id: 'faq', title: 'FAQ' },
    { id: 'data', title: 'Credits' },
  ];

  // Glossary entries: stat, what it means
  readonly glossary: [string, string][] = [
    ['EPA / Play', "Expected Points Added: how much each play changed the offense's expected points, based on down, distance and field position. The best single measure of efficiency."],
    ['Success %', 'Share of plays that gained positive EPA, i.e. kept the offense on schedule.'],
    ['CPOE', 'Completion % over expected: completions above what an average QB would hit on the same throws (depth, coverage, pressure).'],
    ['Rating', 'The classic NFL passer rating (0 to 158.3).'],
    ['Per Attempt', 'Passing yards per attempt.'],
    ['Pressure → Sack', 'Share of pressures that turn into sacks. Lower is better: good QBs escape or get rid of the ball.'],
    ['Bad Throw %', 'Share of attempts charted as inaccurate. Lower is better.'],
    ['Time to Throw', 'Average seconds from snap to throw.'],
    ['aDOT', 'Average depth of target: how far downfield the passes (or targets) travel.'],
    ['Aggressive %', 'Share of throws into tight coverage (a defender within a yard).'],
    ['RYOE / Carry', 'Rush yards over expected per carry, based on where the defenders were at the handoff.'],
    ['YAC / Carry', 'Yards after first contact per carry (rushing).'],
    ['Broken Tkl', 'Tackles broken as a runner or receiver.'],
    ['Target Share', "Share of the team's targets that went to the player."],
    ['Air Yds Share', "Share of the team's air yards (how far passes travel in the air) aimed at the player."],
    ['Separation', 'Average yards between the receiver and the nearest defender when the ball arrives.'],
    ['YAC Over Exp', 'Yards after catch above what was expected for the catch.'],
    ['Drops / Drop %', 'Catchable passes dropped, as charted by Pro Football Reference: the count, and drops per target.'],
    ['Snap %', "Share of the team's offensive snaps the player was on the field for."],
    ['Pass Pro', "For running backs: the QB's pressure rate on dropbacks with him on the field minus with him off, in percentage points (when he sat for at least 40 dropbacks). Lower is better. A rough read on pass protection (he may be running a route rather than blocking); finished seasons only, with a small weight."],
    ['Run Block EPA', "The team's rushing EPA per carry with him on the field minus with him off (when he sat for at least 40 runs). A rough read on run blocking for WRs and TEs: who's on the field each play is only published after a season ends, so it shows for finished seasons only, and it starts with a small weight."],
    ['Stuff %', 'Share of designed runs stopped at or behind the line. Lower is better for an O-line.'],
    ['YBC / Carry', 'Yards before first contact per carry: the room the blocking created.'],
    ['Short Yd %', 'Conversion rate on 3rd and 4th and 1-2 runs.'],
    ['Pressure % / Sack %', 'Pressures or sacks per dropback: allowed (O-lines) or created (defenses).'],
    ['Off / Def Rank', "Where a head coach's offense and defense rank in the league (1 = best), by points or yards per game (Rank Base setting)."],
    ['ST EPA / Game', 'Expected Points Added per game on kicks, punts and returns, net of what opponents gain on them.'],
    ['Wins Over Exp', 'Wins minus the wins the betting lines expected before each game.'],
    ['ATS %', 'Share of games covering the point spread.'],
    ['1-Score Win %', 'Win % in games decided by 8 points or fewer.'],
    ['4th Down Go %', 'How often a team goes for it on 4th and 1-2 at midfield or beyond (outside blowouts).'],
    ['FG % Over Exp', 'Field goal % above what was expected for those kick distances.'],
    ['Net Avg', 'Punt distance minus the return (and touchback) yards.'],
  ];
}
