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
    ["Record", "His whole pro record, wins-losses-draws: every pro fight, the regional ones before the big promotions too (ranked on win percentage; 3x behind its slider in the all-time lists)."],
    ["Recent / Streak", "His last five fights as dots, newest first, and his current run (+3: three straight wins). Current form: Recent counts double behind its slider in the current lists, and neither counts all-time."],
    ["Rating", "The MMA rating: every pro fight since 1997 across those promotions, in order, each moving both fighters by how surprising the result was (beating a highly rated opponent is worth far more than beating a low one; a finish counts fully, a split decision for less). Shown cautiously: less half its uncertainty, which is wide for a newcomer and grows while a fighter sits out. On the P4P tabs, measured against his own division's best. It leads the current lists (12x behind its slider) and doesn't count all-time."],
    ["Career Pts", "Every month since 1997, each division's fighters (3+ fights, one in the last 450 days) are ranked by the rating across every promotion, and the top 15 earn points: the most for #1, fewer down the list, full points only when the division was deep, and only while he fought in the premier competition of the day (the UFC, PRIDE, Strikeforce, the WEC), half elsewhere. His career's total. It counts 6x behind its slider in the all-time lists, behind Peak (8x), scored in proportion from 0 to 12 points: most fighters have next to none, so measured against the list every great career would score alike."],
    ["Peak / Best Win / Opp Rating", "His best rating at any point (8x behind its slider all-time, scored in proportion from 1600 to 2400: how good he was at his best, the all-time lists' lead), the rating of the best opponent he beat going into the fight, and his opponents' average rating going in (strength of schedule)."],
    ["Title Defenses / Title Wins", "Successful title defenses across every reign, and title fight wins (winning a belt and each defense), in the UFC, PRIDE, Strikeforce, the WEC, Bellator and the PFL, from Wikipedia's lists of champions (the PFL's season tournaments were its titles until 2025). A Bellator or PFL title counts half in the ranking, as career points earned there do, and an interim title half again; the columns show the plain counts. Both count double behind their sliders in the all-time lists and aren't shown in the current ones, scored in proportion (0 to 10: one defense is a tenth of ten, not the same as ten just because most fighters have none)."],
    ["Org Rank", "His promotion's official rank in the division: UFC.com's top 15 for a UFC fighter, the PFL's top 10 for a PFL one (counting five places below the UFC's, its field being shallower: the PFL's champion counts as the UFC's #5, its #1 as #6, its #10 as #15). The champion (the belt in the column, for the UFC's) is #0, above #1, and an unranked fighter counts as #16; one fighting elsewhere, with no rankings to read, or retired, counts as average. On the P4P tabs it's the pound-for-pound rank. With UFC Fighters Only on it reads UFC Rank, and with Meta Rankings on, a UFC fighter's rank is UFC.com's Meta Rankings instead of its media panel's (marked (Meta)). It counts 6x behind its slider among current fighters and 1x all-time."],
    ["Peak Rank", "All-time lists only, in Org Rank's place (UFC.com keeps no ranking history): the best he ranked in his division in any month of his career, by the rating across every promotion (the monthly rankings career points come from): the top spot shown as the belt, the next as #1 and so on (#16 if never that high). It counts 1x behind its slider. Not on the pound-for-pound tabs. The all-time lists also leave out Rating, Recent and Streak (today's form), and the current lists leave out the career totals: Career Pts, Title Defenses, Title Wins and Quality Wins."],
    ["Quality Wins", "Wins over opponents rated in the top tenth of every rated fighter going into the fight."],
    ["Finish %", "The share of his wins that ended early (knockout or submission)."],
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
