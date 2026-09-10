import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  booleanAttribute,
  forwardRef,
  inject,
  numberAttribute,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

import { ScrollPickerComponent } from '../scroll-picker/scroll-picker.component';


/** One entry in a scroll picker column. */
interface Item {
  name: any;
  value: any;
}

/**
 * Largest number of decimal places a single column can represent. Past six the
 * column holds a million rows and a double no longer carries the precision for
 * a value that also has a whole part.
 */
const MAX_DECIMAL_PLACES = 6;


/**
 * A numeric scroll picker built from two or three `fs-scroll-picker` drums: the
 * whole number, an optional fraction, and an optional unit.
 *
 * The model value is a plain number. A scrollable prefix or suffix reports
 * through its own two-way binding, so the numeric case stays a bare number.
 */
@Component({
  selector: 'fs-scroll-picker-numeric',
  templateUrl: './scroll-picker-numeric.component.html',
  styleUrls: ['./scroll-picker-numeric.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ScrollPickerNumericComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ScrollPickerComponent, FormsModule],
})
export class ScrollPickerNumericComponent implements OnChanges, ControlValueAccessor {

  @Input({ transform: numberAttribute }) public min = 0;
  @Input({ transform: numberAttribute }) public max = 100;

  /**
   * Digits after the decimal point. 0 hides the fraction column entirely; any
   * higher value renders one column of zero-padded fractions, so two places
   * scroll 00-99 rather than turning into two separate digit drums.
   */
  @Input({ transform: numberAttribute }) public decimalPlaces = 0;

  /** Distance between adjacent whole numbers. */
  @Input({ transform: numberAttribute }) public step = 1;

  /** Text pinned before the number, e.g. a currency symbol. */
  @Input() public prefix: any;

  /** Text pinned after the number, e.g. a unit that does not change. */
  @Input() public suffix: any;

  /**
   * Turns the prefix into its own drum. Accepts bare strings, or
   * `{ name, value }` pairs when the label and the model value differ.
   */
  @Input() public prefixValues: (string | Item)[];

  /** Same as `prefixValues`, for a scrollable suffix. */
  @Input() public suffixValues: (string | Item)[];

  /** Wraps the whole-number column past its ends instead of rubber-banding. */
  @Input({ transform: booleanAttribute }) public infinite = false;

  @Input()
  @HostBinding('style.width') public width;

  /** Emits when a scrollable prefix column settles on a new value. */
  @Output() public prefixChange = new EventEmitter<any>();

  /** Emits when a scrollable suffix column settles on a new value. */
  @Output() public suffixChange = new EventEmitter<any>();

  public wholeValues: Item[] = [];
  public fractionValues: Item[] = [];
  public prefixItems: Item[] = [];
  public suffixItems: Item[] = [];

  public whole = 0;
  public fraction = 0;

  private _value: number = null;

  /**
   * Sign of the current value, tracked separately because the whole column
   * cannot carry it on its own: everything between -1 and 0 truncates to a
   * whole part of 0, which would strip the minus from -0.25.
   */
  private _negative = false;

  private _cdRef = inject(ChangeDetectorRef);

  private _onTouched = () => {};
  private _onChange = (value: number) => {};

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes.min || changes.max || changes.step || changes.decimalPlaces) {
      this._buildColumns();

      // The grid the value sits on just moved, so re-seat it on the new one.
      this._split(this._value);
    }

    if (changes.prefixValues) {
      this.prefixItems = this._toItems(this.prefixValues);
    }

    if (changes.suffixValues) {
      this.suffixItems = this._toItems(this.suffixValues);
    }
  }

  /** Digits after the point, clamped to what a double can carry. */
  public get places(): number {
    return Math.min(Math.max(Math.trunc(this.decimalPlaces) || 0, 0), MAX_DECIMAL_PLACES);
  }

  public get hasFraction(): boolean {
    return this.places > 0;
  }

  public get hasPrefixColumn(): boolean {
    return this.prefixItems.length > 0;
  }

  public get hasSuffixColumn(): boolean {
    return this.suffixItems.length > 0;
  }

  public writeValue(value: number): void {
    this._value = this._normalize(value);
    this._split(this._value);
    this._cdRef.markForCheck();
  }

  public registerOnChange(fn: (value: number) => void): void {
    this._onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  public wholeChanged(whole: number): void {
    this.whole = whole;

    // Scrolling the whole column off zero re-establishes the sign. At exactly
    // zero the existing sign stands, so a value already at -0.25 keeps its
    // minus while only the fraction is being adjusted.
    if (whole !== 0) {
      this._negative = whole < 0;
    }

    this._emit();
  }

  public fractionChanged(fraction: number): void {
    this.fraction = fraction;
    this._emit();
  }

  public prefixChanged(value: any): void {
    this.prefix = value;
    this.prefixChange.emit(value);
    this._onTouched();
  }

  public suffixChanged(value: any): void {
    this.suffix = value;
    this.suffixChange.emit(value);
    this._onTouched();
  }

  /** Rebuilds the whole and fraction columns from the current bounds. */
  private _buildColumns(): void {
    const step = Math.abs(this.step) || 1;
    const min = Math.min(this.min, this.max);
    const max = Math.max(this.min, this.max);

    // Stop at the last whole number inside the bounds, so a max that is not a
    // whole multiple of the step never yields a value past it.
    const last = Math.floor(max);
    const values: Item[] = [];

    for (let value = Math.ceil(min); value <= last; value += step) {
      values.push({ name: value, value });
    }

    this.wholeValues = values;

    if (!this.hasFraction) {
      this.fractionValues = [];

      return;
    }

    const places = this.places;
    const count = Math.pow(10, places);
    const fractions: Item[] = [];

    for (let index = 0; index < count; index++) {
      fractions.push({
        // Padded so 5 at two places reads ".05" - the way the number is
        // written, not the way the column is indexed.
        name: String(index).padStart(places, '0'),
        value: index,
      });
    }

    this.fractionValues = fractions;
  }

  /** Seats a number onto the whole and fraction columns. */
  private _split(value: number): void {
    const first = this.wholeValues[0]?.value ?? 0;

    if (value === null || value === undefined || Number.isNaN(value)) {
      this.whole = first;
      this.fraction = 0;
      this._negative = first < 0;

      return;
    }

    this._negative = value < 0;

    // Truncated toward zero rather than floored, so -12.5 reads as "-12" and
    // ".5" on the drums. Flooring would show it as -13 and .5, which is the
    // same number but not how anyone writes it.
    const whole = Math.trunc(value);

    this.whole = this._nearestWhole(whole);

    if (!this.hasFraction) {
      this.fraction = 0;

      return;
    }

    // Rounded rather than truncated, so a value carrying float dust such as
    // 0.30000000000000004 still lands on the right detent.
    this.fraction = Math.round(Math.abs(value - whole) * Math.pow(10, this.places));
  }

  /** The nearest column entry, for a value that sits off the step grid. */
  private _nearestWhole(whole: number): number {
    if (!this.wholeValues.length) {
      return whole;
    }

    return this.wholeValues
      .reduce((closest, item) => {
        return Math.abs(item.value - whole) < Math.abs(closest - whole) ? item.value : closest;
      }, this.wholeValues[0].value);
  }

  /** Recombines the columns and emits, clamped to the configured bounds. */
  private _emit(): void {
    // The fraction is a magnitude, so below zero it moves away from zero with
    // the whole part rather than back toward it.
    const magnitude = this.fraction / Math.pow(10, this.places);
    const value = this._normalize(this._negative
      ? this.whole - magnitude
      : this.whole + magnitude);

    if (value === this._value) {
      return;
    }

    this._value = value;
    this._onChange(value);
    this._onTouched();
  }

  /** Clamps to the bounds and strips the float error the recombination adds. */
  private _normalize(value: number): number {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return null;
    }

    const min = Math.min(this.min, this.max);
    const max = Math.max(this.min, this.max);
    const clamped = Math.min(Math.max(Number(value), min), max);

    return Number(clamped.toFixed(this.places));
  }

  /** Accepts a column of bare strings or of explicit name/value pairs. */
  private _toItems(values: (string | Item)[]): Item[] {
    return (values ?? [])
      .map((value) => {
        return typeof value === 'object' && value !== null
          ? value
          : { name: value, value };
      });
  }
}
