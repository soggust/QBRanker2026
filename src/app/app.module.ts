import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSliderModule } from '@angular/material/slider';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LetterGradePipe } from './pipes/letter-grade.pipe';
import { FormatRecentGamesPipe } from './pipes/format-recent-games.pipe';
import { RankingsComponent } from './rankings/rankings.component';
import { SkillRankingsComponent } from './skill-rankings/skill-rankings.component';
import { ColumnHighlightDirective } from './utils/column-highlight.directive';
import { ColumnDragDirective } from './utils/column-drag.directive';
import { MatMenuModule } from '@angular/material/menu';
import { AboutComponent } from './about/about.component';

@NgModule({
  declarations: [
    AppComponent,
    SidebarComponent,
    LetterGradePipe,
    FormatRecentGamesPipe,
    RankingsComponent,
    SkillRankingsComponent,
    ColumnHighlightDirective,
    ColumnDragDirective,
    AboutComponent,
  ],
  bootstrap: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    MatSliderModule,
    MatSelectModule,
    MatIconModule,
    FormsModule,
    DragDropModule,
    MatButtonModule,
    MatMenuModule,
    MatSlideToggleModule,
  ],
})
export class AppModule {}
