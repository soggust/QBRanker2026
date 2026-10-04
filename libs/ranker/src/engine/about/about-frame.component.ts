import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, ViewChild } from '@angular/core';

export interface AboutSection {
  id: string;
  title: string;
}

// The About / FAQ panel's frame (each sport's About fills it: apps/<sport>/src/sport/about): a
// scoreboard panel over the dimmed page, the title and a close button, the sections down the left and
// the one showing on the chalkboard. Keyboard users land on the close button; Escape closes it.
@Component({
  selector: 'about-frame',
  templateUrl: './about-frame.component.html',
  styleUrls: ['../../styles/components/about.component.scss'],
  standalone: false,
})
export class AboutFrameComponent implements OnInit, AfterViewInit {
  @Input({ required: true }) heading!: string;
  @Input({ required: true }) sections!: AboutSection[];
  @Output() closed = new EventEmitter<void>();

  @ViewChild('closeButton') closeButton!: ElementRef<HTMLButtonElement>;
  @ViewChild('body') body!: ElementRef<HTMLElement>;

  // The section showing (the first to start)
  active = '';

  ngOnInit(): void {
    this.active = this.sections[0]?.id ?? '';
  }

  ngAfterViewInit(): void {
    this.closeButton.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }

  show(id: string): void {
    this.active = id;
    this.body.nativeElement.scrollTop = 0;
  }
}
