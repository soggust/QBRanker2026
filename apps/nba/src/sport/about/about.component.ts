import { Component, EventEmitter, Output } from '@angular/core';
import { AboutSection } from '@ranker/engine/about/about-frame.component';

// NBA Ranker's About / FAQ, opened from the info button in every table's footer (the shared frame:
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
    ["PTS / REB / AST / STL / BLK","Points, rebounds, assists, steals and blocks: per game to start, or season totals or an 82-game pace (Stat Defs in the settings)."],
    ["3PM","3-pointers made."],
    ["FG % / 3P % / FT %","Shots made per attempt: all field goals, 3-pointers (25+ attempts to show) and free throws (20+)."],
    ["TS %","True shooting: points per shooting possession, counting 3s as worth more and free throws too. About 57% is league average now."],
    ["PER","Player Efficiency Rating: per-minute production rolled into one number, with 15 as league average."],
    ["USG %","Usage rate: the share of his team's possessions he used (a shot, free throws or a turnover) while on the floor."],
    ["BPM / DBPM","Box Plus/Minus: points per 100 possessions he added over an average player, estimated from the box score. DBPM is its defensive half. +5 is an All-Star, +10 an MVP."],
    ["Win Shares / WS / 48","A team's wins split among its players by their offense and defense, and the same per 48 minutes (.100 is about average, .200 elite)."],
    ["VORP","Value Over Replacement Player: BPM and minutes turned into value over a freely available fill-in."],
    ["On-Off","His team's net rating (points scored minus allowed per 100 possessions) with him on the floor, minus with him off. Catches what the box score misses, but noisy: it depends on who he plays with."],
    ["AST % / TOV %","Assist rate: teammates' baskets he assisted while on the floor. Turnover rate: turnovers per 100 of his plays (lower is better)."],
    ["REB % / STL % / BLK %","The share of available rebounds he grabbed, of opponents' possessions he ended with a steal, and of their 2-point shots he blocked, while on the floor."],
    ["Record","His team's win-loss record (a traded player: his last team's)."],
    ["Teammates / Coaching","Support grades, F to A+: how good the rest of his team was (their minutes-weighted BPM, without him) and his team's coaching lift. Better support counts slightly against a player. Early in a season a few games barely measure a team, so each grade starts from the team's grade last season and gives way to this season's: about half this season by 5 games, all of it from game 20 of 82 on (a past season is all its own results)."],
    ["Net Rtg / Off Rank / Def Rank","A team's points scored minus allowed per 100 possessions, and where its offense (points scored per 100) and defense (points allowed per 100) ranked in the league (Head Coaches tab)."],
    ["Coaching Lift","Net rating over what the roster's talent predicted (last season's BPM of the players he used, by their minutes): how much more a coach got from his roster."],
    ["W vs Pt Diff","Wins beyond (or short of) what the point differential implies: mostly close games."],
  ];
}
