import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  ContentChild,
  ElementRef,
  forwardRef,
  Input,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewChild
} from '@angular/core';
import { Subject } from 'rxjs';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ScrollPickerTemplateComponent } from '../../directives/scroll-picker-template.directive';


@Component({
  selector: 'fs-scroll-picker',
  templateUrl: './scroll-picker.component.html',
  styleUrls: ['./scroll-picker.component.scss'],
  providers: [ {
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => ScrollPickerComponent),
    multi: true
  } ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScrollPickerComponent implements OnInit, OnDestroy, ControlValueAccessor {

  @ContentChild(ScrollPickerTemplateComponent, { read: TemplateRef, static: false })
  template: TemplateRef<ScrollPickerTemplateComponent>;

  @ViewChild('scrollContainer', { static: true }) scrollContainer: ElementRef;
  @Input() values = [];


  private _destroy$ = new Subject();
  public degreeIncrement = 22.5;
  public selectedDegree = 0;
  public segments = [];
  public displayValues = [];
  public selectedIndex = 0;
  public value;
  public indexes = [];

  private _onTouched = () => {};
  private _onChange = (value: any) => {};
  private _currentTouchY = null;

  constructor(private _cdRef: ChangeDetectorRef) {}

  public ngOnInit() {
    this.scrollContainer.nativeElement
    .addEventListener('wheel', this.scroll.bind(this), { passive: false });

    // this.scrollContainer.nativeElement
    // .addEventListener('touchend', this.touchEnd.bind(this), { passive: true });

    // this.scrollContainer.nativeElement
    // .addEventListener('touchmove', throttle(this.touchMove.bind(this), 80), { passive: false });
  }

  public writeValue(value: any) {
    this.value = value;

    
    let index = this.values.findIndex((item) => {
      return this.value === item;
    });   

    index = index === -1 ? 0 : index;
    this.updateIndex(index);

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

  public scroll(event: any) {

    event.preventDefault();
    event.stopPropagation();

    let index = this.values.findIndex((item) => {
      return this.value === item;
    });

    if (event.deltaY > 0) {
      if(index === (this.values.length - 1)) {
        index = -1;
      }
      
      index++;
      this.value = this.values[index];

    } else {
      if(index === 0) {
        index = this.values.length;
      }
      index--;
    }    

    this.updateIndex(index);
  }

  public updateIndex(index) {
    this.value = this.values[index];

    let start = index - 3;
    let end = index + 4;
    
    this.displayValues = [];
    if(start < 0) {
      this.displayValues = [
        ...this.values.slice(start),
        ...this.values.slice(0, end),
      ];
    } else if(end > (this.values.length - 1)) {
      end = this.values.length - end;
      this.displayValues = [
        ...this.values.slice(start),
        ...this.values.slice(0, end),
      ];
      
    } else {
      this.displayValues = [
        ...this.values.slice(start, end),
      ];
    }

    console.log(index,this.indexes);
    
    this._cdRef.markForCheck();
  }

  public ngOnDestroy() {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
