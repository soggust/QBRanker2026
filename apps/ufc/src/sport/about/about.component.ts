import { Component, EventEmitter, Output } from '@angular/core';
import { AboutSection } from '@ranker/engine/about/about-frame.component';

// UFC Ranker's About / FAQ, opened from the info button in every table's footer (the shared frame:
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
    { id: 'grades', title: 'Fighter Card' },
    { id: 'tips', title: 'Tips' },
    { id: 'glossary', title: 'Stats' },
    { id: 'faq', title: 'FAQ' },
    { id: 'data', title: 'Credits' },
  ];

  // Glossary entries: stat, what it means
  readonly glossary: [string, string][] = [
    ["Record", "His UFC record, wins-losses-draws (draws include no contests)."],
    ["Recent", "His last five UFC fights as dots, newest first."],
    ["UFC Rank", "UFC.com's official rank in his division (context only: the ranking here is yours)."],
    ["Title Defenses / Title Wins", "Successful UFC title defenses across every reign, and title fight wins (winning a belt, interim ones too, and each defense), from Wikipedia's list of UFC champions. These two, Elo and Recent count double behind their sliders, and these two are scored in proportion (0 to 10: one defense is a tenth of ten, not the same as ten just because most fighters have none): every slider still starts at 50% and 0% still turns them off, but each step moves the ranking twice as much."],
    ["Elo / Peak Elo", "A rating built from every UFC fight since 2001 (everyone starts at 1500): each result moves it by how surprising it was, so beating a highly rated opponent is worth far more than beating a low one. Now, and his best ever. Elo counts double behind its slider."],
    ["UFC Rank", "UFC.com's official rank in the division: the champion (the belt in the column) is #0, above #1, and an unranked fighter counts as #16. On the P4P tabs it's the pound-for-pound rank. It counts 15x behind its slider among current fighters, so the UFC's own order leads, and 3x in the all-time lists, where retired fighters (no rank) count as average."],
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
}
