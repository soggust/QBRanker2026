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
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { LetterGradePipe } from './pipes/letter-grade.pipe';
import { FormatRecentGamesPipe } from './pipes/format-recent-games.pipe';
import { RankingsComponent } from './rankings/rankings.component';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { MatMenuModule } from '@angular/material/menu';
import { MatExpansionModule } from '@angular/material/expansion';

const firebaseConfig = {
  apiKey: 'AIzaSyD5sj0mL45M2p_MB3ZUSFE6Ve9nMiLm8Nc',
  authDomain: 'qbranker2026.firebaseapp.com',
  projectId: 'qbranker2026',
  storageBucket: 'qbranker2026.firebasestorage.app',
  messagingSenderId: '1027982765642',
  appId: '1:1027982765642:web:05ea3880c08454b4b680b3',
  measurementId: 'G-HKT8MVPT8V',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

@NgModule({
  declarations: [
    AppComponent,
    SidebarComponent,
    LetterGradePipe,
    FormatRecentGamesPipe,
    RankingsComponent,
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
    MatExpansionModule,
  ],
  providers: [provideHttpClient(withInterceptorsFromDi())],
})
export class AppModule {}
