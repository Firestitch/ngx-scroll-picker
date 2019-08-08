import { Component, ElementRef, OnDestroy, OnInit, Input, ViewChild, AfterViewInit, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { throttle } from 'lodash-es';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';


@Component({
  selector: 'fs-scroll-picker',
  templateUrl: './scroll-picker.component.html',
  styleUrls: ['./scroll-picker.component.scss']
})
export class ScrollPickerComponent implements OnInit, OnDestroy, AfterViewInit {

  @ViewChild('viewport') virtualScrollViewport: CdkVirtualScrollViewport;

  public scrollDispatcher;
  public targetI = 0;
  public index = 50;
  private _destroy$ = new Subject();

  @Input() values = [];
  public selectedIndex = 0;

  constructor(
    private _element: ElementRef,
    private _ngZone: NgZone
  ) {}

  public ngOnInit() {

    this.virtualScrollViewport.scrollToIndex(this.index, 'smooth');

    this.virtualScrollViewport.elementRef.nativeElement
    .addEventListener('wheel', this._wheel.bind(this));
  }

  private _wheel(event) {

    if (this.index > 0 && event.deltaY < 0) {
      this.index--;
      throttle(this._throttle.bind(this), 80)(event);

    }

    if (this.index < (this.values.length) && event.deltaY > 0) {
      this.index++;
      throttle(this._throttle.bind(this), 50)(event);
    }

  }

  private _throttle(event) {
    console.log(this.index, this.values.length, event.deltaY);

    this.virtualScrollViewport.scrollToIndex(this.index, 'smooth');
  }

  ngAfterViewInit() {}

  public addSelectedValue(value) {

    const newSelectedIndex = this.selectedIndex + value;
    if (newSelectedIndex >= 0 && newSelectedIndex < this.values.length) {
      this.selectedIndex += value;
    }
  }

  public setSelectedIndex(index) {
    this.selectedIndex = index;
  }

  public scrollll(ev) {
    this.targetI = ev;
  }

  public calcTranslate(itemIndex) {
    const index = itemIndex - this.targetI;
    const rotate = 67.5 - (index * 22.5);
    const translate =  7 * (index - 3);

    const res = {
      'transform': `rotateX(${rotate}deg)`,
    };

    // console.log(res);
    return res;
  }

  public ngOnDestroy() {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
