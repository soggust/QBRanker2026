import { Component, EventEmitter, Output } from '@angular/core';
import { AboutSection } from '@ranker/engine/about/about-frame.component';

// MLB Ranker's About / FAQ, opened from the info button in every table's footer (the shared frame:
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
    { id: 'compare', title: 'Compare' },
    { id: 'tips', title: 'Tips' },
    { id: 'glossary', title: 'Stats' },
    { id: 'faq', title: 'FAQ' },
    { id: 'data', title: 'Credits' },
  ];

  // Glossary entries: stat, what it means
  readonly glossary: [string, string][] = [
    ["WAR", "Wins Above Replacement: wins a player added over a freely available fill-in, rolling everything he did into one number. 2 is a solid regular, 5 an All-Star, 8+ an MVP season."],
    ["AVG / OBP / SLG", "Batting average (hits per at-bat), on-base percentage (how often he reaches base) and slugging (total bases per at-bat, so power counts more)."],
    ["BB % / K %", "Walks and strikeouts per plate appearance (for pitchers, per batter faced). A hitter wants more walks and fewer strikeouts; a pitcher the reverse."],
    ["wRC+", "Weighted Runs Created Plus: runs created per plate appearance, adjusted for ballpark and league, with 100 as average (120 is 20% better)."],
    ["wOBA / xwOBA", "Weighted on-base average values each way of reaching base by how many runs it's worth. Expected wOBA (Statcast) is what the quality of his contact (exit velocity and launch angle), walks and strikeouts should have produced."],
    ["Barrel %", "Batted balls hit at the ideal mix of exit velocity and launch angle (the likeliest to become extra-base hits), per batted ball."],
    ["Hard-Hit %", "Batted balls hit 95 mph or harder. For pitchers, lower is better."],
    ["Sprint Speed", "Feet per second in his fastest one-second window on competitive runs (27 is average, 30 elite)."],
    ["Def Runs", "Fielding runs saved compared with an average fielder at his position."],
    ["FLD %", "Fielding percentage: plays made per chance (putouts and assists over chances), at every position he played. It only counts errors, so it can't see the balls a slow fielder never gets to."],
    ["RF/9", "Range factor: plays made (putouts and assists) per 9 innings in the field, at every position he played. It sees the balls a fielder gets to that fielding percentage misses, but it also leans on his pitchers (strikeouts leave fewer balls in play) and, on the outfield tab, on which field he played."],
    ["OAA", "Outs Above Average (Statcast, 2016 on): the plays a fielder made beyond what an average one would, weighing how hard each one was. Catchers aren't measured."],
    ["BsR", "Baserunning runs above average: stolen bases, caught stealing and taking extra bases."],
    ["ERA / WHIP", "Earned runs per 9 innings, and walks plus hits per inning."],
    ["FIP / xFIP", "Fielding Independent Pitching: an ERA built only from what the pitcher controls (strikeouts, walks, home runs). xFIP swaps in a league-average home run rate."],
    ["xERA", "Expected ERA from the quality of contact allowed (Statcast)."],
    ["K-BB %", "Strikeout rate minus walk rate: one of the best single measures of a pitcher."],
    ["Whiff %", "Swings that miss, per swing (Statcast)."],
    ["HR / 9", "Home runs allowed per 9 innings."],
    ["Lineup / Defense / Stadium", "Support grades, F to A+: the rest of a hitter's lineup, the fielding behind a pitcher, and how his home park plays (for hitters or for pitchers). Better support counts slightly against a player. Early in a season a few games barely measure a team, so each grade starts from the team's grade last season and gives way to this season's: about half this season by 10 games, all of it from game 40 of 162 on (a past season is all its own results)."],
    ["IP", "Innings pitched, in baseball notation: 175.1 is 175 and a third."],
  ];
}
