import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Output, ViewChild } from '@angular/core';

type SectionId = 'about' | 'ranking' | 'grades' | 'tips' | 'glossary' | 'faq' | 'data';

// About / FAQ panel, opened from the info button in every table's footer
@Component({
  selector: 'about-panel',
  templateUrl: './about.component.html',
  styleUrls: ['../../../../../libs/ranker/src/styles/components/about.component.scss'],
  standalone: false,
})
export class AboutComponent implements AfterViewInit {
  @Output() closed = new EventEmitter<void>();
  @ViewChild('closeButton') closeButton!: ElementRef<HTMLButtonElement>;
  @ViewChild('body') body!: ElementRef<HTMLElement>;

  sections: { id: SectionId; title: string; icon: string }[] = [
    { id: 'about', title: 'Guide', icon: 'sports_baseball' },
    { id: 'ranking', title: 'Rankings', icon: 'tune' },
    { id: 'grades', title: 'Player Card', icon: 'groups' },
    { id: 'tips', title: 'Tips', icon: 'lightbulb' },
    { id: 'glossary', title: 'Stats', icon: 'menu_book' },
    { id: 'faq', title: 'FAQ', icon: 'help_outline' },
    { id: 'data', title: 'Credits', icon: 'dataset' },
  ];
  active: SectionId = 'about';

  // Glossary entries: stat, what it means
  glossary: [string, string][] = [
    ["PTS / REB / AST / STL / BLK","Points, rebounds, assists, steals and blocks: per game to start, or season totals or an 82-game pace (Stat Totals in the settings)."],
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

  ngAfterViewInit(): void {
    // Keyboard users land on the close button
    this.closeButton.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }

  show(id: SectionId): void {
    this.active = id;
    this.body.nativeElement.scrollTop = 0;
  }
}
