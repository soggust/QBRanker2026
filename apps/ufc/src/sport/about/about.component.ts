import { Component, EventEmitter, Output } from '@angular/core';
import { AboutSection } from '@ranker/engine/about/about-frame.component';

// MMA Ranker's About / FAQ, opened from the info button in every table's footer (the shared frame:
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
    ["Record", "His record in the promotions covered (the UFC, PFL, Bellator, Rizin, PRIDE, Strikeforce, WEC, KSW, Cage Warriors and LFA), wins-losses-draws (draws include no contests)."],
    ["Recent", "His last five fights as dots, newest first. Counts double behind its slider in the current lists, not at all all-time."],
    ["Rating", "The MMA rating: every pro fight since 1997 across those promotions, in order, each moving both fighters by how surprising the result was (beating a highly rated opponent is worth far more than beating a low one; a finish counts fully, a split decision for less). Shown cautiously: less half its uncertainty, which is wide for a newcomer and grows while a fighter sits out. On the P4P tabs, measured against his own division's best. It leads the current lists (12x behind its slider) and doesn't count all-time."],
    ["Career Pts", "Every month since 1997, each division's fighters (3+ fights, one in the last 450 days) are ranked by the rating across every promotion, and the top 15 earn points: the most for #1, fewer down the list, full points only when the division was deep. His career's total. It leads the all-time lists (12x behind its slider)."],
    ["Peak / Best Win / Opp Rating", "His best rating at any point (3x behind its slider all-time), the rating of the best opponent he beat going into the fight, and his opponents' average rating going in (strength of schedule)."],
    ["Title Defenses / Title Wins", "Successful UFC title defenses across every reign, and UFC title fight wins (winning a belt, interim ones too, and each defense), from Wikipedia's list of UFC champions. Both count double behind their sliders in the all-time lists and not at all in the current ones (like every career total: quality wins, five-round wins, finishes and times finished too), scored in proportion (0 to 10: one defense is a tenth of ten, not the same as ten just because most fighters have none)."],
    ["UFC Rank", "UFC.com's official rank in the division: the champion (the belt in the column) is #0, above #1, and an unranked UFC fighter counts as #16. On the P4P tabs it's the pound-for-pound rank. It counts 6x behind its slider among current fighters and 1x all-time; a fighter outside the UFC, or retired, counts as average."],
    ["Quality Wins", "Wins over opponents rated in the top tenth of every rated fighter going into the fight."],
    ["5-Rd Wins", "Wins in five-round fights: title fights and main events."],
    ["Streak", "His current run: +3 is three straight wins, -2 two straight losses."],
    ["Finish % / Finishes / Finished", "The share of his wins that ended early (knockout or submission), how many, and how many of his losses did (lower is better)."],
    ["Strikes / Min / Strike Acc", "Significant strikes landed per minute of fight time, and landed per attempt (50+ attempts)."],
    ["Absorbed / Min / Strike Def", "Significant strikes landed on him per minute (lower is better), and the share of his opponents' he avoided."],
    ["KD / 15 / KD Against", "Knockdowns he scored per 15 minutes (power), and times he was knocked down (his chin; lower is better)."],
    ["Strike Diff", "Significant strikes landed minus absorbed, per minute: who wins the striking."],
    ["TD / 15 / TD Acc / TD Def", "Takedowns landed per 15 minutes, landed per attempt (5+), and the share of opponents' takedowns he stopped (5+ tried on him)."],
    ["Sub Att / 15", "Submission attempts per 15 minutes."],
    ["Adv / 15", "Ground advances per 15 minutes: moving to the back, mount, side control or half guard. Control on the mat."],
    ["Avg Time / Age / Reach", "Context only: his average fight length in minutes, his age and his reach in inches."],
  ];
}
