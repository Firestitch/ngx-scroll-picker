import { Component, ElementRef, OnDestroy, OnInit, Input, forwardRef, ViewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { throttle } from 'lodash-es';


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

  @ViewChild('scrollContainer') scrollContainer: ElementRef;

  private _destroy$ = new Subject();
  public degreeIncrement = 22.5;
  public currentDegree = 0;
  public selectorDegree = 0;
  public segments = [];

  @Input('values') set setValues(values) {
    this.values = values;
    this._showSegment(0);
  }

  public selectedIndex = 0;
  public values = [];
  private _onTouched = () => {};
  private _onChange = (value: any) => {};
  private _currentTouchY = null;

  constructor(
    public element: ElementRef,
  ) {}

  public ngOnInit() {
    this.scrollContainer.nativeElement
    .addEventListener('wheel', throttle(this.scroll.bind(this), 20));

    this.scrollContainer.nativeElement
    .addEventListener('touchstart', this.touchStart.bind(this));

    this.scrollContainer.nativeElement
    .addEventListener('touchend', this.touchEnd.bind(this));

    this.scrollContainer.nativeElement
    .addEventListener('touchmove', throttle(this.touchMove.bind(this), 80));
  }

  public writeValue(value: any) {
    const index = this.values.indexOf(value) || 0;
    this.setIndex(index);
  }

  public registerOnChange(fn: (value: any) => any): void {
    this._onChange = fn
  }

  public registerOnTouched(fn: () => any): void {
    this._onTouched = fn
  }

  public addSelectedValue(value) {

  }

  public setSelectedIndex(index) {
    this.selectedIndex = index;
  }

  public touchStart(event: WheelEvent) {
    //console.log('touchStart', event);
    this._currentTouchY = null;
  }

  trackByFn(index, item) {
    return index;
  }

  public touchMove(event: any) {
    event.preventDefault();
    event.stopPropagation();
    const y = event.changedTouches[0].clientY;

    //console.log('touchMove', event);

    if (this._currentTouchY === null) {
      this._currentTouchY = y;
    }

    if (this._currentTouchY > y) {
      console.log('down', y)

      const diff = this._currentTouchY - y;
      if (diff > 10) {
        this._currentTouchY = y;
        this.setIndex(this.selectedIndex + Math.round(diff / 10));
      }

    } else {

      console.log('up', y)
      const diff = y - this._currentTouchY;
      if (diff > 10) {
        this._currentTouchY = y;
        this.setIndex(this.selectedIndex - Math.round(diff / 10));
      }
    }
  }

  public touchEnd(event: WheelEvent) {
    //console.log('touchEnd', event);
    this._currentTouchY = null;
  }

  public scroll(event: WheelEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.deltaY > 0) {

      if (this.selectedIndex > this.values.length) {
        return event.preventDefault();
      }
      this.setIndex(this.selectedIndex + 1);

    } else {

      if (!this.selectedIndex) {
        return event.preventDefault();
      }

      this.setIndex(this.selectedIndex - 1);
    }

    this._onChange(this.values[this.selectedIndex]);
  }

  public setIndex(index) {

    if ((index >= this.values.length) || index < 0) {
      return;
    }

    this.selectedIndex = index;

    this.currentDegree = this.selectedIndex * this.degreeIncrement;

    this.selectorDegree = this.degreeIncrement * 5;
    //if (this.selectedIndex <= 5) {
      this.selectorDegree = this.degreeIncrement * this.selectedIndex;
    //}

    //this._showSegment(this.selectedIndex);
  }

  public ngOnDestroy() {
    this._destroy$.next();
    this._destroy$.complete();
  }

  public _showSegment(degree) {
    const size = 200;
    const start = degree < size ? 0 : degree - size;
    this.segments = this.values.slice(start, degree + size);
  }
}
