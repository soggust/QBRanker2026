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
import { SkillRankingsComponent } from './skill-rankings/skill-rankings.component';
import { SettingsMenuComponent } from './skill-rankings/settings-menu.component';
import { PlayerCardComponent } from './player-card/player-card.component';
import { ColumnHighlightDirective } from '@ranker/core/column-highlight.directive';
import { COLUMN_MOVER, ColumnDragDirective } from '@ranker/core/column-drag.directive';
import { MatMenuModule } from '@angular/material/menu';
import { AboutComponent } from '@sport/about/about.component';
import { AboutFrameComponent } from './about/about-frame.component';
import { PositionService } from './position.service';
import { BetsPageComponent } from './bets/bets-page.component';

@NgModule({
  declarations: [
    AppComponent,
    SidebarComponent,
    SkillRankingsComponent,
    SettingsMenuComponent,
    PlayerCardComponent,
    ColumnHighlightDirective,
    ColumnDragDirective,
    AboutComponent,
    AboutFrameComponent,
    BetsPageComponent,
  ],
  bootstrap: [AppComponent],
  // (the column headers' drag and drop reorders columns through the position service)
  providers: [{ provide: COLUMN_MOVER, useExisting: PositionService }],
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
