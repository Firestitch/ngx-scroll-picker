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
import { fromEvent, merge, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
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
  public template: TemplateRef<ScrollPickerTemplateComponent>;

  @ViewChild('scrollContainer', { static: true }) 
  public scrollContainer: ElementRef;

  @Input() values = [];
  @Input() valuesMin;
  @Input() valuesMax;

  public displayValues = [];
  public value;
  public touchData: any = {};
  public valuesEl;

  private _touchDestroy$: Subject<void>;
  private _destroy$ = new Subject();
  private _onTouched = () => {};
  private _onChange = (value: any) => {};

  constructor(private _cdRef: ChangeDetectorRef) {}

  public ngOnInit() {
    this.valuesEl = this.scrollContainer.nativeElement.querySelector('.values');
    if(this.valuesMin !== undefined && this.valuesMax !== undefined) {
      for(let i = this.valuesMin; i <= this.valuesMax; i++) {
        this.values.push({ name: i, value: i });
      }
    }

    fromEvent(this.scrollContainer.nativeElement, 'wheel')
    .pipe(
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
      this.scroll(event);
    });

    merge(
      fromEvent(this.scrollContainer.nativeElement, 'touchstart'),
      fromEvent(this.scrollContainer.nativeElement, 'mousedown')
    )
    .pipe(
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
      this.touchStart(event);
    });      
  }

  public writeValue(value: any) {
    this.value = value;
    let index = this.getValueIndex();

    index = index === -1 ? 0 : index;
    this.updateIndex(index);
  }
  
  public registerOnChange(fn: (value: any) => any): void {
    this._onChange = fn
  }

  public registerOnTouched(fn: () => any): void {
    this._onTouched = fn
  }

  public touchStart(event) {
    event.preventDefault();
    this._touchDestroy$ = new Subject();

    merge(
      fromEvent(document, 'touchmove'),
      fromEvent(document, 'mousemove')
    )
    .pipe(
      takeUntil(this._touchDestroy$),
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
       this.touchMove(event);
    }); 

    merge(
      fromEvent(document, 'touchend'),
      fromEvent(document, 'touchcancel'),
      fromEvent(document, 'mouseup')
    )
    .pipe(
      takeUntil(this._touchDestroy$),
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
      this._touchDestroy$.next();
      this._touchDestroy$.complete();
      this._touchDestroy$ = null;
    });  
  }

  public touchMove(event) {
    const endY = event.changedTouches ? event.changedTouches[0].pageY : event.pageY;
    this.touchData.startY = this.touchData.startY || endY;
    const moveY = (this.touchData.moveY || 0) + (endY - (this.touchData.startY));

    if (Math.abs(moveY) >= 12) {
      if(moveY < 0) {
        this.next();
      } else {
        this.prev();
      }

      this.touchData.startY = endY;
      this.touchData.moveY = 0; 
    }
  }

  public scroll(event: any) {
    event.preventDefault();
    event.stopPropagation();

    if (event.deltaY > 0) {
      this.next();

    } else {
      this.prev();
    }        
  }

  public prev() {
    let index = this.getValueIndex();

    if(index === 0) {
      index = this.values.length;
    }

    index--;
    this.updateIndex(index);    
  }

  public next() {
    let index = this.getValueIndex();

    if(index === (this.values.length - 1)) {
      index = -1;
    }
    
    index++; 
    
    this.updateIndex(index);
  }

  public getValueIndex() {
    return this.values.findIndex((item) => {
      return this.value === item.value;
    }); 
  }

  public updateIndex(index) {
    this.value = this.values[index] ? this.values[index].value : null;

    this._onChange(this.value);

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

    this._cdRef.markForCheck();
  }

  public ngOnDestroy() {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
