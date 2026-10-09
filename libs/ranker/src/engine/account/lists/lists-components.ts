import { CommunityPageComponent } from '../community/community-page.component';
import { PresetBarComponent } from '../presets/preset-bar.component';
import { ListModalComponent } from './list-modal.component';
import { ListViewComponent } from './list-view.component';
import { ListsPageComponent } from './lists-page.component';
import { SaveListDialogComponent } from './save-list-dialog.component';

// Saved lists, presets and the Community's components, declared in app.module.ts
export const LISTS_COMPONENTS = [
  CommunityPageComponent,
  ListModalComponent,
  ListViewComponent,
  ListsPageComponent,
  PresetBarComponent,
  SaveListDialogComponent,
];
