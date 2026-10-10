import { Component, Input } from '@angular/core';

// The address people write to about their data (a deletion request, a question): the owner's own for now, a
// site address later. (It must be set: the Privacy Policy and Data Deletion pages show it.)
export const LEGAL_CONTACT = 'soggust@gmail.com';
// (when these pages last changed in substance)
export const LEGAL_UPDATED = 'October 9, 2026';

// The site's Privacy Policy (#privacy) and Data deletion (#data-deletion) pages: plain prose on the app's
// sheet, open to anyone signed in or not (Meta's app settings link to both). Each links to the other.
@Component({
  selector: 'legal-page',
  templateUrl: './legal-page.component.html',
  styleUrls: ['../../../styles/components/account-legal.scss'],
  host: { role: 'main' },
  standalone: false,
})
export class LegalPageComponent {
  @Input() page: 'privacy' | 'data-deletion' = 'privacy';

  readonly contact = LEGAL_CONTACT;
  readonly updated = LEGAL_UPDATED;

  get mailto(): string {
    return 'mailto:' + this.contact + '?subject=' + encodeURIComponent('Season Ranker: delete my data');
  }

  // (back to the rankings: the hash cleared, without leaving a bare # in the address)
  back(event: Event): void {
    event.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}
