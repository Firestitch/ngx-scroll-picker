import { Component, ElementRef, OnDestroy, OnInit, Input, forwardRef, ViewChild, ContentChild, AfterContentInit, ContentChildren, QueryList, TemplateRef, HostListener } from '@angular/core';
import { Subject } from 'rxjs';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { throttle, findIndex, isEqual } from 'lodash-es';
import { ScrollPickerTemplateComponent } from '../../directives/scroll-picker-template.directive';


@Component({
  selector: 'fs-scroll-picker',
  templateUrl: './scroll-picker.component.html',
  styleUrls: ['./scroll-picker.component.scss'],
  providers: [ {
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => ScrollPickerComponent),
    multi: true
  } ]
})
export class ScrollPickerComponent implements OnInit, OnDestroy, ControlValueAccessor {

  @ContentChild(ScrollPickerTemplateComponent, { read: TemplateRef })
  template: TemplateRef<ScrollPickerTemplateComponent>;

  @ViewChild('scrollContainer') scrollContainer: ElementRef;
  @Input() values = [];


  private _destroy$ = new Subject();
  public degreeIncrement = 22.5;
  public selectedDegree = 0;
  public segments = [];
  public selectedIndex = 0;

  private _onTouched = () => {};
  private _onChange = (value: any) => {};
  private _currentTouchY = null;

  public ngOnInit() {
    this.scrollContainer.nativeElement
    .addEventListener('wheel', throttle(this.scroll.bind(this), 40), { passive: false });

    this.scrollContainer.nativeElement
    .addEventListener('touchend', this.touchEnd.bind(this), { passive: true });

    this.scrollContainer.nativeElement
    .addEventListener('touchmove', throttle(this.touchMove.bind(this), 80), { passive: false });
  }

  public writeValue(value: any) {
    const index = findIndex(this.values, item => {
      return isEqual(value, item);
    });
    this.setIndex(index);
  }

  public registerOnChange(fn: (value: any) => any): void {
    this._onChange = fn
  }

  public registerOnTouched(fn: () => any): void {
    this._onTouched = fn
  }

  public setSelectedIndex(index) {
    this.selectedIndex = index;
  }

  trackByFn(index, item) {
    return index;
  }

  public touchMove(event: any) {
    event.preventDefault();
    event.stopPropagation();
    const y = event.changedTouches[0].clientY;

    if (this._currentTouchY === null) {
      this._currentTouchY = y;
    }

    if (this._currentTouchY > y) {

      const diff = this._currentTouchY - y;
      if (diff > 10) {
        this._currentTouchY = y;
        this.setIndex(this.selectedIndex + Math.round(diff / 10), true);
      }

    } else {
      const diff = y - this._currentTouchY;
      if (diff > 10) {
        this._currentTouchY = y;
        this.setIndex(this.selectedIndex - Math.round(diff / 10), true);
      }
    }
  }

  public touchEnd(event: WheelEvent) {
    this._currentTouchY = null;
  }

  public move(value) {
    this.setIndex(this.selectedIndex + value, true);
  }

  public scroll(event: any) {

    event.preventDefault();
    event.stopPropagation();

    if (event.deltaY > 0) {

      if (this.selectedIndex > this.values.length) {
        return event.preventDefault();
      }
      this.setIndex(this.selectedIndex + 1, true);

    } else {

      if (!this.selectedIndex) {
        return event.preventDefault();
      }

      this.setIndex(this.selectedIndex - 1, true);
    }


  }

  public setIndex(index, change = false) {

    if ((index >= this.values.length) || index < 0) {
      return;
    }

    this.selectedIndex = index;
    this.selectedDegree = this.degreeIncrement * this.selectedIndex;

    if (change) {
      this._onChange(this.values[this.selectedIndex]);
    }
  }

  public ngOnDestroy() {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
