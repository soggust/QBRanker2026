import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Output, ViewChild } from '@angular/core';

type SectionId = 'about' | 'ranking' | 'grades' | 'tips' | 'glossary' | 'faq' | 'data';

// About / FAQ panel, opened from the info button in every table's footer
@Component({
  selector: 'about-panel',
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.scss'],
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
    ["WAR", "Wins Above Replacement: wins a player added over a freely available fill-in, rolling everything he did into one number. 2 is a solid regular, 5 an All-Star, 8+ an MVP season."],
    ["AVG / OBP / SLG", "Batting average (hits per at-bat), on-base percentage (how often he reaches base) and slugging (total bases per at-bat, so power counts more)."],
    ["BB % / K %", "Walks and strikeouts per plate appearance (for pitchers, per batter faced). A hitter wants more walks and fewer strikeouts; a pitcher the reverse."],
    ["wRC+", "Weighted Runs Created Plus: runs created per plate appearance, adjusted for ballpark and league, with 100 as average (120 is 20% better)."],
    ["wOBA / xwOBA", "Weighted on-base average values each way of reaching base by how many runs it's worth. Expected wOBA (Statcast) is what the quality of his contact (exit velocity and launch angle), walks and strikeouts should have produced."],
    ["Barrel %", "Batted balls hit at the ideal mix of exit velocity and launch angle (the likeliest to become extra-base hits), per batted ball."],
    ["Hard-Hit %", "Batted balls hit 95 mph or harder. For pitchers, lower is better."],
    ["Sprint Speed", "Feet per second in his fastest one-second window on competitive runs (27 is average, 30 elite)."],
    ["Def Runs", "Fielding runs saved compared with an average fielder at his position."],
    ["BsR", "Baserunning runs above average: stolen bases, caught stealing and taking extra bases."],
    ["ERA / WHIP", "Earned runs per 9 innings, and walks plus hits per inning."],
    ["FIP / xFIP", "Fielding Independent Pitching: an ERA built only from what the pitcher controls (strikeouts, walks, home runs). xFIP swaps in a league-average home run rate."],
    ["xERA", "Expected ERA from the quality of contact allowed (Statcast)."],
    ["K-BB %", "Strikeout rate minus walk rate: one of the best single measures of a pitcher."],
    ["Whiff %", "Swings that miss, per swing (Statcast)."],
    ["HR / 9", "Home runs allowed per 9 innings."],
    ["Lineup / Defense / Stadium", "Support grades, F to A+: the rest of a hitter's lineup, the fielding behind a pitcher, and how his home park plays (for hitters or for pitchers). Better support counts slightly against a player."],
    ["IP", "Innings pitched, in baseball notation: 175.1 is 175 and a third."],
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
