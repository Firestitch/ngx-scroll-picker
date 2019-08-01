import { Component, ElementRef, HostListener, Inject, OnDestroy, OnInit, Input } from '@angular/core';
import { Subject } from 'rxjs';


@Component({
  selector: 'fs-scroll-picker',
  templateUrl: './scroll-picker.component.html',
  styleUrls: ['./scroll-picker.component.scss']
})
export class ScrollPickerComponent implements OnInit, OnDestroy {

  private _destroy$ = new Subject();

  @Input() values = [];
  public selectedIndex = 0;

  constructor(
    public element: ElementRef,
  ) {}

  public ngOnInit() {

  }

  public addSelectedValue(value) {

    const newSelectedIndex = this.selectedIndex + value;
    if (newSelectedIndex >= 0 && newSelectedIndex < this.values.length) {
      this.selectedIndex += value;
    }
  }

  public setSelectedIndex(index) {
    this.selectedIndex = index;
  }

  public scroll(event: WheelEvent) {

    if (event.deltaY > 0) {

      if (this.selectedIndex >= (this.values.length - 1)) {
        return event.preventDefault();
      }
      this.selectedIndex++;
    } else {

      if (!this.selectedIndex) {
        return event.preventDefault();
      }

      this.selectedIndex--;
    }
  }

  public ngOnDestroy() {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
