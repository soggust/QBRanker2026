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
    { id: 'about', title: 'Guide', icon: 'sports_mma' },
    { id: 'ranking', title: 'Rankings', icon: 'tune' },
    { id: 'grades', title: 'Fighter Card', icon: 'groups' },
    { id: 'tips', title: 'Tips', icon: 'lightbulb' },
    { id: 'glossary', title: 'Stats', icon: 'menu_book' },
    { id: 'faq', title: 'FAQ', icon: 'help_outline' },
    { id: 'data', title: 'Credits', icon: 'dataset' },
  ];
  active: SectionId = 'about';

  // Glossary entries: stat, what it means
  glossary: [string, string][] = [
    ["Record", "His UFC record, wins-losses-draws (draws include no contests)."],
    ["Recent", "His last five UFC fights as dots, newest first."],
    ["UFC Rank", "UFC.com's official rank in his division (context only: the ranking here is yours)."],
    ["Elo / Peak Elo", "A rating built from every UFC fight since 2001 (everyone starts at 1500): each result moves it by how surprising it was, so beating a highly rated opponent is worth far more than beating a low one. Now, and his best ever."],
    ["Quality Wins", "Wins over opponents rated in the top fifth of UFC fighters (by Elo) going into the fight."],
    ["5-Rd Wins", "Wins in five-round fights: title fights and main events."],
    ["Streak", "His current run: +3 is three straight wins, -2 two straight losses."],
    ["Finish % / Finishes / Finished", "The share of his UFC wins that ended early (knockout or submission), how many, and how many of his losses did (lower is better)."],
    ["Strikes / Min / Strike Acc", "Significant strikes landed per minute of fight time, and landed per attempt (50+ attempts)."],
    ["Absorbed / Min / Strike Def", "Significant strikes landed on him per minute (lower is better), and the share of his opponents' he avoided."],
    ["KD / 15 / KD Against", "Knockdowns he scored per 15 minutes (power), and times he was knocked down (his chin; lower is better)."],
    ["Strike Diff", "Significant strikes landed minus absorbed, per minute: who wins the striking."],
    ["TD / 15 / TD Acc / TD Def", "Takedowns landed per 15 minutes, landed per attempt (5+), and the share of opponents' takedowns he stopped (5+ tried on him)."],
    ["Sub Att / 15", "Submission attempts per 15 minutes."],
    ["Adv / 15", "Ground advances per 15 minutes: moving to the back, mount, side control or half guard. Control on the mat."],
    ["Schedule", "His UFC opponents' UFC win percentage (3+ fights each; others count as .500)."],
    ["Avg Time / Age / Reach", "Context only: his average fight length in minutes, his age and his reach in inches."],
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
