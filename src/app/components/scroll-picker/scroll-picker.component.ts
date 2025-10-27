import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ContentChild, ElementRef, forwardRef, HostBinding, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, TemplateRef, ViewChild, inject } from '@angular/core';
import { fromEvent, merge, Subject } from 'rxjs';
import { filter, takeUntil, tap } from 'rxjs/operators';
import { AbstractControl, ControlValueAccessor, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validators } from '@angular/forms';
import { ScrollPickerTemplateComponent } from '../../directives/scroll-picker-template.directive';
import { NgClass } from '@angular/common';


@Component({
    selector: 'fs-scroll-picker',
    templateUrl: './scroll-picker.component.html',
    styleUrls: ['./scroll-picker.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => ScrollPickerComponent),
            multi: true
        },
        {
            provide: NG_VALIDATORS,
            useExisting: forwardRef(() => ScrollPickerComponent),
            multi: true
        }
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [NgClass],
})
export class ScrollPickerComponent implements OnInit, OnDestroy, OnChanges, ControlValueAccessor, Validators {
  private _cdRef = inject(ChangeDetectorRef);


  @ContentChild(ScrollPickerTemplateComponent, { read: TemplateRef })
  public template: TemplateRef<ScrollPickerTemplateComponent>;

  @ViewChild('scrollContainer', { static: true }) 
  public scrollContainer: ElementRef;

  @Input() values: { name: string, value: any }[] = [];
  @Input() valuesMin;
  @Input() valuesMax;
  @Input() disabledMin;
  @Input() disabledMax;
  @Input() 
  @HostBinding('style.width') width;

  static readonly maxDelta = 13;

  public displayValues = [];
  public value;
  public valuesEl;
  public hideCursor = false;
  public disabled = {};

  private _wheelDelta = 0;
  private _touchDelta = 0;
  private _mouseDelta = 0;
  private _touchY = 0;
  private _mouseY = 0;
  private _touchDestroy$: Subject<void>;
  private _mouseDestroy$: Subject<void>;
  private _destroy$ = new Subject();
  private _onTouched = () => {};
  private _onChange = (value: any) => {};

  public ngOnInit(): void {
    this.valuesEl = this.scrollContainer.nativeElement.querySelector('.values');
    this.updateValues();
    this.updateDisabled();

    fromEvent(this.scrollContainer.nativeElement, 'wheel')
    .pipe(
      tap((event: any) => {
        event.preventDefault();
        event.stopPropagation(); 
      }),
      filter((event: any) => {
        this._wheelDelta += Math.abs(event.wheelDeltaY);
        return this._wheelDelta > ScrollPickerComponent.maxDelta;
      }), 
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
      this._wheelDelta = 0;
      this.scroll(event);
    });

    merge(
      fromEvent(this.scrollContainer.nativeElement, 'touchstart'),
    )
    .pipe(
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
      this.touchStart(event);
    });

    merge(
      fromEvent(this.scrollContainer.nativeElement, 'mousedown')
    )
    .pipe(
      takeUntil(this._destroy$),
    )
    .subscribe((event: UIEvent) => {
      this.mouseStart(event);
    });      
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if(changes.valuesMin?.firstChange === false || changes.valuesMax?.firstChange === false) {
      if(this.valuesMin !== undefined && this.valuesMax !== undefined) {
        this.updateValues();
        this.updateIndex(this.getValueIndex());
      }
    }

    if(changes.disabledMin?.firstChange === false || changes.disabledMax?.firstChange === false) {
      this.updateDisabled();
    }
  }

  public validate(control: AbstractControl): { [key: string]: any } | null { 
    if(this.valueDisabled) {
      return {
        disabled: 'Value is disabled',
      };
    }

    return null; 
  }

  public get valueDisabled(): boolean {
    return this.disabled[this.value];
  }

  public updateDisabled(): void {
    this.disabled = {};
    this.values
      .forEach((item) => {
        if(
          (this.disabledMin !== undefined && item.value <= this.disabledMin) ||
          (this.disabledMax !== undefined && item.value >= this.disabledMax)
        ) {
          this.disabled[item.value] = true;
        }
      });
  }

  public updateValues(): void {
    if(this.valuesMin !== undefined && this.valuesMax !== undefined) {
      this.values = [];
      for(let i = this.valuesMin; i <= this.valuesMax; i++) {
        this.values.push({ name: i, value: i });
      }
    }
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
    this._touchY = event.targetTouches[0].pageY;
    this._touchDestroy$ = new Subject();

    merge(
      fromEvent(document, 'touchmove'),
    )
    .pipe(
      filter((event: any) => {
        this._touchDelta += event.targetTouches[0].pageY - this._touchY;
        this._touchY = event.targetTouches[0].pageY;
        return Math.abs(this._touchDelta) > ScrollPickerComponent.maxDelta;
      }),       
      takeUntil(this._touchDestroy$),
      takeUntil(this._destroy$),
    )
    .subscribe((event: any) => {
      this.touchMove();
      this._touchDelta = 0;
    }); 

    merge(
      fromEvent(document, 'touchend'),
      fromEvent(document, 'touchcancel'),
    )
    .pipe(
      takeUntil(this._touchDestroy$),
      takeUntil(this._destroy$),
    )
    .subscribe(() => {
      this._touchDestroy$.next(null);
      this._touchDestroy$.complete();
      this._touchDestroy$ = null;
    });  
  }

  public mouseStart(event) {
    event.preventDefault();
    this._mouseY = event.pageY;
    this._mouseDestroy$ = new Subject();

    merge(
      fromEvent(document, 'mousemove')
    )
    .pipe(
      filter((event: MouseEvent) => {
        this._mouseDelta += event.pageY - this._mouseY;
        this._mouseY = event.pageY;
        return Math.abs(this._mouseDelta) > ScrollPickerComponent.maxDelta;          
      }),       
      takeUntil(this._mouseDestroy$),
      takeUntil(this._destroy$),
    )
    .subscribe(() => {
      this.mouseMove();
      this._mouseDelta = 0;
    }); 

    merge(
      fromEvent(document, 'mouseup')
    )
    .pipe(
      takeUntil(this._mouseDestroy$),
      takeUntil(this._destroy$),
    )
    .subscribe(() => {
      this._mouseDestroy$.next(null);
      this._mouseDestroy$.complete();
      this._mouseDestroy$ = null;
    });  
  }
  
  public mouseMove() {
    if(this._mouseDelta < 0) {
      this.next();
    } else {
      this.prev();
    }
  }

  public touchMove() {
    if(this._touchDelta < 0) {
      this.next();
    } else {
      this.prev();
    }
  }

  public scroll(event: any) {
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
    if(!this.values[index]) {
      index = 0;
    }

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

  public valueClick(index): void {
    if(index > 0) {
      for(let i=0; i < Math.abs(index);i++) {
        this.next();
      }
    } else {
      for(let i=0; i < Math.abs(index);i++) {
        this.prev();
      }
    }
  }

  public ngOnDestroy(): void {
    this._destroy$.next(null);
    this._destroy$.complete();
  }
}
