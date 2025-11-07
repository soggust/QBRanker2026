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
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { MatMenuModule } from '@angular/material/menu';
import { MatExpansionModule } from '@angular/material/expansion';

const firebaseConfig = {
  apiKey: 'AIzaSyAJnhXlsdyalYitbz03v78x9Yrow1ZukvM',
  authDomain: 'qbranker.firebaseapp.com',
  projectId: 'qbranker',
  storageBucket: 'qbranker.appspot.com',
  messagingSenderId: '727904727710',
  appId: '1:727904727710:web:15a73b5fa4cd979c03418f',
  measurementId: 'G-SZVWE3DSY6',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

@NgModule({ declarations: [
        AppComponent,
        SidebarComponent,
        LetterGradePipe,
        FormatRecentGamesPipe,
        RankingsComponent,
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        BrowserAnimationsModule,
        MatSliderModule,
        MatSelectModule,
        MatIconModule,
        FormsModule,
        DragDropModule,
        MatButtonModule,
        MatMenuModule,
        MatSlideToggleModule,
        MatExpansionModule], providers: [provideHttpClient(withInterceptorsFromDi())] })
export class AppModule {}
