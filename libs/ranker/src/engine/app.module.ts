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
import { PlayerCompareComponent } from './compare/player-compare.component';
import { CARD_TABS } from '@ranker/engine/player-card/tabs/card-tabs';
import { CardPanelComponent } from './player-card/card-panel.component';
import { GameViewComponent } from './game-view/game-view.component';
import { ColumnHighlightDirective } from '@ranker/core/column-highlight.directive';
import { ScrolledSidewaysDirective } from '@ranker/core/scrolled-sideways.directive';
import { COLUMN_MOVER, ColumnDragDirective } from '@ranker/core/column-drag.directive';
import { SelectOriginDirective } from '@ranker/core/select-origin.directive';
import { A11Y_DIRECTIVES } from '@ranker/core/a11y.directives';
import { MatMenuModule } from '@angular/material/menu';
import { AboutComponent } from '@sport/about/about.component';
import { AboutFrameComponent } from './about/about-frame.component';
import { PositionService } from './position.service';
import { BetsPageComponent } from './bets/bets-page.component';
import { ModelDeskComponent } from './bets/model-desk.component';

@NgModule({
  declarations: [
    AppComponent,
    SidebarComponent,
    SkillRankingsComponent,
    SettingsMenuComponent,
    PlayerCardComponent,
    PlayerCompareComponent,
    ...CARD_TABS,
    CardPanelComponent,
    GameViewComponent,
    ColumnHighlightDirective,
    ScrolledSidewaysDirective,
    ColumnDragDirective,
    SelectOriginDirective,
    ...A11Y_DIRECTIVES,
    AboutComponent,
    AboutFrameComponent,
    BetsPageComponent,
    ModelDeskComponent,
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
