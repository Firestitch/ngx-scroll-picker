import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ContentChild, ElementRef, booleanAttribute, forwardRef, HostBinding, Input, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges, TemplateRef, ViewChild, inject } from '@angular/core';
import { AbstractControl, ControlValueAccessor, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validators } from '@angular/forms';
import { NgClass, NgTemplateOutlet } from '@angular/common';

import { ScrollPickerTemplateComponent } from '../../directives/scroll-picker-template.directive';

import { ScrollPickerFeedback } from './scroll-picker.feedback';
import {
  Deceleration,
  FlingHandoffDistance,
  ItemAngle,
  MaxVelocity,
  MaxVisibleAngle,
  MinVelocity,
  RubberBandLimit,
  SnapDamping,
  SnapEpsilon,
  SnapStiffness,
  Sample,
  TapSlop,
  VelocitySampleWindow,
  VisibleRadius,
  WheelGestureMaxDuration,
  WheelIdleTimeout,
  WheelMomentumDecay,
  WheelMomentumMaxGap,
  WheelMomentumRun,
  WheelNotchThreshold,
  decayFor,
  projectFling,
  pruneSamples,
  rubberBand,
  velocityFrom,
} from './scroll-picker.physics';


export interface ScrollPickerSlot {
  /** Stable key so Angular recycles DOM nodes as the drum turns. */
  key: number;
  /** Unwrapped position on the drum. Can be negative or past the end. */
  offset: number;
  item: { name: any, value: any } | null;
  angle: number;
  opacity: number;
  scale: number;
  hidden: boolean;
  disabled: boolean;
  selected: boolean;
}

type Mode = 'idle' | 'drag' | 'fling' | 'snap';

const slotCount = VisibleRadius * 2 + 1;

/** Placeholder for the form callbacks until Angular registers real ones. */
function noop(): void { /* intentionally empty */ }


@Component({
  selector: 'fs-scroll-picker',
  templateUrl: './scroll-picker.component.html',
  styleUrls: ['./scroll-picker.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ScrollPickerComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => ScrollPickerComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [NgClass, NgTemplateOutlet],
})
export class ScrollPickerComponent implements OnInit, OnDestroy, OnChanges, ControlValueAccessor, Validators {

  @ContentChild(ScrollPickerTemplateComponent, { read: TemplateRef })
  public template: TemplateRef<ScrollPickerTemplateComponent>;

  @ViewChild('scrollContainer', { static: true })
  public scrollContainer: ElementRef<HTMLElement>;

  @Input() public values: { name: any, value: any }[] = [];
  @Input() public valuesMin;
  @Input() public valuesMax;
  @Input() public disabledMin;
  @Input() public disabledMax;

  /**
   * When true the drum loops endlessly; when false it rubber-bands at both ends.
   * Coerced so it can be set as a bare attribute, not just `[infinite]="true"`.
   */
  @Input({ transform: booleanAttribute }) public infinite = false;

  /**
   * Vibrates once per value the drum passes, the way a native picker does.
   *
   * Reaches the iOS Taptic Engine through Capacitor's Haptics plugin when the
   * app runs in a native shell, and falls back to the Vibration API on Android
   * web. A plain web page on iOS has neither, so this is silently inert there
   * and `sound` is what carries the feel.
   *
   * Set `[haptics]="false"` to silence it.
   */
  @Input({ transform: booleanAttribute }) public haptics = true;

  /**
   * Clicks once per value the drum passes, the way a native picker does.
   *
   * Set `[sound]="false"` to silence it. Deliberately not gated on
   * `prefers-reduced-motion`: that setting is about vestibular safety - motion
   * that makes people dizzy - and a detent click is neither motion nor a
   * trigger for it. Honouring it here only silenced the picker for everyone who
   * turns Windows animation effects off, which is a lot of people who very much
   * still want to hear their clicks.
   */
  @Input({ transform: booleanAttribute }) public sound = true;

  /**
   * Whether the tick obeys the iPhone's physical ringer switch.
   *
   * Defaults to false, so the tick is heard regardless of the switch. The
   * tidier choice is true - that declares the audio ambient, which is what
   * native iOS UI sounds do, mixing with the user's music and going quiet on a
   * muted phone. It is not the default because it makes the picker silent on
   * any iPhone whose switch happens to be off, which is most of them, and a
   * feature nobody can hear is worse than one that is slightly impolite.
   *
   * Set `[respectMute]="true"` for an app that would rather be well-behaved
   * than audible.
   *
   * Only iOS Safari 16.4+ implements the API behind this; elsewhere it has no
   * effect either way.
   */
  @Input({ transform: booleanAttribute }) public respectMute = false;

  @Input()
  @HostBinding('style.width') public width;

  public slots: ScrollPickerSlot[] = [];
  public value;
  public disabled = {};

  /** Continuous position of the drum in items. Fractional between detents. */
  private _offset = 0;

  /** Un-resisted position, kept separately so overscroll stays reversible. */
  private _rawOffset = 0;

  private _velocity = 0;

  /** Per-ms decay for the fling in progress, rescaled to land on its detent. */
  private _flingDecay = Deceleration;
  private _mode: Mode = 'idle';

  /** Handle for the physics loop's animation frame. */
  private _frame: number = null;

  /**
   * Handle for the render-only frame. Kept apart from `_frame` because the two
   * schedulers cancel and clear their handles independently - sharing one field
   * let a render callback null out a live physics frame, after which the loop
   * scheduled a second concurrent chain. Every extra chain advanced the physics
   * by its own delta and emitted its own value, so a single touch drag on iOS
   * spun the drum without stopping and fired change events every frame per
   * chain.
   */
  private _renderFrame: number = null;

  /**
   * Bumped every time the physics loop is cancelled or restarted. A frame that
   * was already dispatched when the loop was cancelled still runs its callback,
   * so `_step` compares the generation it was scheduled under against this and
   * retires if it no longer matches. Without it a pointerdown landing on a
   * moving drum let the in-flight callback re-schedule itself, leaving a
   * physics loop running underneath the drag and fighting the pointer.
   */
  private _generation = 0;

  private _lastFrameTime = 0;

  private _snapTarget = 0;
  private _snapVelocity = 0;

  private _pointerId: number = null;
  private _pointerStartY = 0;
  private _pointerStartOffset = 0;
  private _pointerMoved = false;
  private _samples: Sample[] = [];
  private _pointerListeners: (() => void)[] = [];

  private _wheelTimer: any = null;

  /**
   * Wheel gesture state. A trackpad has no equivalent of pointerup, so the end
   * of the gesture has to be inferred - see `_onWheel`.
   */
  private _wheelActive = false;
  private _wheelStartTime = 0;
  private _wheelLastDelta = 0;
  private _wheelPeakDelta = 0;
  private _wheelDecayRun = 0;
  private _wheelRunStart = 0;

  /** True while the OS momentum tail of a handed-off gesture is being ignored. */
  private _wheelMomentum = false;
  private _wheelSamples: Sample[] = [];

  /** Height of one item in px, measured from the rendered element. */
  private _itemHeight = 34;

  private _listeners: (() => void)[] = [];

  // Replaced by registerOnTouched/registerOnChange once a form binds to us.
  private _onTouched: () => void = noop;
  private _onChange: (value: any) => void = noop;

  private _feedback = new ScrollPickerFeedback();

  private _cdRef = inject(ChangeDetectorRef);
  private _zone = inject(NgZone);

  public ngOnInit(): void {
    this._syncFeedback();
    this.updateValues();
    this.updateDisabled();

    this._offset = this._rawOffset = this._startOffset();
    this._render();
    this._measure();

    // Pointer and animation work runs outside Angular. Change detection is
    // scheduled once per rendered frame instead of once per input event.
    this._zone.runOutsideAngular(() => this._bindEvents());
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes.haptics || changes.sound || changes.respectMute) {
      this._syncFeedback();
    }

    if (changes.valuesMin && !changes.valuesMin.firstChange || changes.valuesMax && !changes.valuesMax.firstChange) {
      if (this.valuesMin !== undefined && this.valuesMax !== undefined) {
        this.updateValues();
        this.updateDisabled();
        this._jumpTo(this._startOffset());
      }
    }

    if (changes.values && !changes.values.firstChange) {
      this.updateDisabled();
      this._jumpTo(this._startOffset());
    }

    if (changes.disabledMin && !changes.disabledMin.firstChange || changes.disabledMax && !changes.disabledMax.firstChange) {
      this.updateDisabled();
      this._render();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public validate(_control: AbstractControl): { [key: string]: any } | null {
    if (this.valueDisabled) {
      return {
        disabled: 'Value is disabled',
      };
    }

    return null;
  }

  public get valueDisabled(): boolean {
    return !!this.disabled[this.value];
  }

  public updateDisabled(): void {
    this.disabled = {};
    this.values
      .forEach((item) => {
        if (
          (this.disabledMin !== undefined && item.value <= this.disabledMin) ||
          (this.disabledMax !== undefined && item.value >= this.disabledMax)
        ) {
          this.disabled[item.value] = true;
        }
      });
  }

  public updateValues(): void {
    if (this.valuesMin !== undefined && this.valuesMax !== undefined) {
      this.values = [];
      for (let i = this.valuesMin; i <= this.valuesMax; i++) {
        this.values.push({ name: i, value: i });
      }
    }
  }

  public writeValue(value: any): void {
    this.value = value;
    this._jumpTo(this._startOffset());
  }

  public registerOnChange(fn: (value: any) => any): void {
    this._onChange = fn;
  }

  public registerOnTouched(fn: () => any): void {
    this._onTouched = fn;
  }

  public getValueIndex(): number {
    return this.values.findIndex((item) => this.value === item.value);
  }

  /** Tapping a row brings it to the centre, the way iOS does. */
  public slotClick(slot: ScrollPickerSlot): void {
    if (this._pointerMoved || !slot.item) {
      return;
    }

    this._onTouched();
    this._settleTo(slot.offset);
  }

  public ngOnDestroy(): void {
    this._feedback.destroy();
    this._cancelFrames();
    this._clearWheelTimer();
    this._endWheelGesture();
    this._releaseCapture(this._pointerId);
    this._pointerId = null;
    this._detachPointerListeners();
    this._listeners.forEach((off) => off());
    this._listeners = [];
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  private _bindEvents(): void {
    const el = this.scrollContainer.nativeElement;

    this._listeners.push(
      this._on(el, 'wheel', this._onWheel, { passive: false }),
      this._on(el, 'pointerdown', this._onPointerDown),
      this._on(el, 'keydown', this._onKeyDown),
    );
  }

  private _on(target: EventTarget, type: string, handler: any, options?: AddEventListenerOptions): () => void {
    const bound = handler.bind(this);

    target.addEventListener(type, bound, options);

    return () => target.removeEventListener(type, bound, options);
  }

  // ---------------------------------------------------------------------------
  // Wheel and trackpad
  // ---------------------------------------------------------------------------

  private _onWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.values.length) {
      return;
    }

    // A wheel is NOT user activation - the HTML spec excludes it, and Chrome
    // refuses to resume an AudioContext from one. Arming here still builds the
    // context and starts the feedback's own wait for the next real press, which
    // is what eventually makes a wheel-driven picker audible.
    this._feedback.arm();

    if (Math.abs(event.deltaY) >= WheelNotchThreshold) {
      // A notched mouse wheel. One notch moves exactly one item and settles
      // there, so a wheel click always lands on a value.
      this._endWheelGesture();
      this._clearWheelTimer();
      this._settleTo(this._snapBase() + Math.sign(event.deltaY));

      return;
    }

    // A trackpad. There is no wheel equivalent of pointerup, so the end of the
    // gesture is inferred rather than reported - see `_isWheelMomentum`.
    const delta = this._normalizeWheelDelta(event);

    // The tail of a stream already handed off to the fling. macOS keeps sending
    // these for up to a second or so after the fling has started; letting them
    // open a fresh gesture would drop the drum back into `drag` and cancel the
    // fling, which is the drift this whole path exists to prevent. They are
    // swallowed until the stream goes quiet - `_armWheelIdle` reopens for the
    // next real gesture, and a pointerdown or a notch clears it immediately.
    if (this._wheelMomentum) {
      this._armWheelIdle();

      return;
    }

    if (!this._wheelActive) {
      this._startWheelGesture(event.timeStamp);
    }

    // Once the OS is driving, its deltas are discarded and our own fling takes
    // over with the velocity the fingers actually left behind. Continuing to
    // integrate them instead is what let the drum drift for the whole momentum
    // phase - macOS emits those events for a second or more, every one of them
    // resetting the idle timer, so the snap that ends the gesture never ran and
    // the drum never came to rest on a value.
    if (this._isWheelMomentum(delta, event.timeStamp)) {
      // Set after the fling: `_flingFromWheel` clears the gesture, which resets
      // this flag, so raising it first would be undone immediately.
      this._flingFromWheel();
      this._wheelMomentum = true;
      this._armWheelIdle();

      return;
    }

    this._trackWheelDelta(delta, event.timeStamp);
    this._armWheelIdle();
  }

  /** Moves the drum by one trackpad delta and records it for the release velocity. */
  private _trackWheelDelta(delta: number, time: number): void {
    this._cancelFrame();
    this._mode = 'drag';
    this._velocity = 0;

    this._rawOffset += delta;
    this._offset = this._applyBounds(this._rawOffset);

    this._wheelSamples = pruneSamples(
      [...this._wheelSamples, { time, position: this._offset }],
      time,
    );

    this._commitFromOffset();
    this._scheduleRender();
  }

  /**
   * (Re)arms the quiet-stream timer. While a gesture is live this is what ends
   * it; while its momentum tail is being swallowed this is what decides the
   * tail is over, so the next scroll starts a gesture of its own.
   */
  private _armWheelIdle(): void {
    this._clearWheelTimer();
    this._wheelTimer = setTimeout(() => {
      this._wheelTimer = null;

      if (this._wheelMomentum) {
        this._wheelMomentum = false;

        return;
      }

      this._flingFromWheel();
    }, WheelIdleTimeout);
  }

  private _startWheelGesture(time: number): void {
    this._wheelActive = true;
    this._wheelStartTime = time;
    this._wheelLastDelta = 0;
    this._wheelPeakDelta = 0;
    this._wheelDecayRun = 0;
    this._wheelRunStart = 0;
    this._wheelSamples = [];
  }

  private _endWheelGesture(): void {
    this._wheelActive = false;
    this._wheelMomentum = false;
    this._wheelLastDelta = 0;
    this._wheelPeakDelta = 0;
    this._wheelDecayRun = 0;
    this._wheelRunStart = 0;
    this._wheelSamples = [];
  }

  /**
   * Whether the OS has taken over the gesture and is now synthesizing events.
   *
   * macOS keeps emitting wheel events after the fingers lift, with deltas that
   * decay smoothly towards zero. A finger on glass never decays that cleanly,
   * so a run of consecutive shrinking deltas arriving at display rate means the
   * hand is off - at which point the gesture is over as far as the drum is
   * concerned. Both halves are needed: a deliberate slow scroll can look
   * monotonic for a long stretch, and only its sparser timing gives it away.
   *
   * The elapsed-time test is the backstop for anything whose momentum does not
   * decay in that shape, so no wheel gesture can hold the drum in `drag`
   * indefinitely however unusual the device.
   */
  private _isWheelMomentum(delta: number, time: number): boolean {
    const magnitude = Math.abs(delta);

    // Direction reversals are always fresh intent, never OS momentum.
    const reversed = this._wheelLastDelta && Math.sign(delta) !== Math.sign(this._wheelLastDelta);

    // Measured against the peak of the current run rather than the previous
    // event. Momentum decays gently enough that consecutive deltas are nearly
    // equal, so a per-event comparison cannot separate the OS curve from noise;
    // against the running peak, a decaying stream stays under the bar for as
    // long as it decays, while a finger re-accelerating clears it at once.
    if (reversed || magnitude > this._wheelPeakDelta * WheelMomentumDecay) {
      this._wheelDecayRun = 0;
      this._wheelPeakDelta = magnitude;
    } else {
      this._wheelDecayRun++;

      // The peak is the true maximum of the run and never decays. Letting it
      // sink towards the current delta would lower the bar under a jittery
      // finger until ordinary scrolling looked monotonic and tripped the
      // handoff mid-gesture.
      this._wheelPeakDelta = Math.max(magnitude, this._wheelPeakDelta);
    }

    // Mean gap across the run so far. Momentum is display-driven and dense; a
    // hand on the glass is sparser and more irregular.
    const gap = this._wheelDecayRun
      ? (time - this._wheelRunStart) / this._wheelDecayRun
      : 0;

    if (this._wheelDecayRun === 1) {
      this._wheelRunStart = time;
    }

    this._wheelLastDelta = delta;

    return (this._wheelDecayRun >= WheelMomentumRun && gap <= WheelMomentumMaxGap) ||
      time - this._wheelStartTime >= WheelGestureMaxDuration;
  }

  /**
   * Ends a trackpad gesture the way a finger lifting ends a drag: fling with
   * the velocity measured over the last few events, or settle where it stands.
   */
  private _flingFromWheel(): void {
    const samples = this._wheelSamples;
    const velocity = velocityFrom(samples);

    this._endWheelGesture();
    this._clearWheelTimer();

    if (this._isOverscrolled() || Math.abs(velocity) < MinVelocity) {
      this._settleTo(Math.round(this._offset));
    } else {
      this._startFling(velocity);
    }
  }

  /** Converts a wheel delta into items, accounting for the event's unit mode. */
  private _normalizeWheelDelta(event: WheelEvent): number {
    let pixels = event.deltaY;

    if (event.deltaMode === 1) {
      pixels *= this._itemHeight;                  // DOM_DELTA_LINE
    } else if (event.deltaMode === 2) {
      pixels *= this._itemHeight * slotCount;     // DOM_DELTA_PAGE
    }

    return pixels / this._itemHeight;
  }

  private _clearWheelTimer(): void {
    if (this._wheelTimer !== null) {
      clearTimeout(this._wheelTimer);
      this._wheelTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer drag - mouse, touch and pen through one path
  // ---------------------------------------------------------------------------

  private _onPointerDown(event: PointerEvent): void {
    if (!this.values.length) {
      return;
    }

    // A second finger landing mid-drag is a normal thing to do on a touch
    // screen, and the drum can only follow one. Ignore it and keep tracking the
    // pointer that started the gesture.
    //
    // Retiring the open gesture here instead would strand it: `_endGesture`
    // detaches the window listeners and clears `_pointerId`, so the original
    // finger's pointerup no longer matches and is dropped. Lift the second
    // finger before the first and the drum is left following a pointer whose
    // terminating event it has already thrown away - it then spins for as long
    // as that finger stays down and never settles.
    if (this._pointerId !== null) {
      return;
    }

    const el = this.scrollContainer.nativeElement;

    // The one reliable user gesture in the picker's life. An AudioContext built
    // anywhere else starts suspended and the first clicks are silent, so the
    // audio channel is opened here, before the drag it will play under.
    this._feedback.arm();

    // Grabbing a moving drum stops it dead, like catching a spinning wheel.
    this._cancelFrame();
    this._clearWheelTimer();
    this._endWheelGesture();

    this._beginGesture(event);

    // Capture routes every later event for this pointer to this element, so the
    // gesture still terminates when the finger leaves the drum or the browser
    // retargets the touch. iOS Safari captures touch pointers implicitly, but
    // only taking it explicitly makes `lostpointercapture` meaningful - without
    // the call that listener can never fire, since the element never held the
    // capture it would be losing.
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Safari throws for a pointer that is already gone. The window listeners
      // below still end the gesture, so there is nothing to recover from.
    }

    this._pointerListeners = [
      this._on(window, 'pointermove', this._onPointerMove),
      this._on(window, 'pointerup', this._onPointerUp),
      this._on(window, 'pointercancel', this._onPointerUp),
      // Fires when the browser takes the pointer away mid-gesture (a system
      // edge-swipe, a context menu). Without it that capture loss would leave
      // the gesture open with no further events coming.
      this._on(el, 'lostpointercapture', this._onPointerUp),
    ];

    // Deliberately not preventDefault()ed for touch. Suppressing the default on
    // a touch-derived pointerdown stops iOS Safari from emitting the pointerup
    // that ends the gesture, which strands `_pointerId` set and the window
    // listeners attached - the drum then keeps tracking every later touch and
    // never stops. Native panning is suppressed by `touch-action: none` in the
    // stylesheet instead, which is the mechanism designed for this and costs no
    // events. Mouse still needs the default suppressed, or the drag turns into
    // a text/image selection.
    if (event.pointerType === 'mouse') {
      event.preventDefault();
    }
  }

  /** Seats the drag state on the pointer that just went down. */
  private _beginGesture(event: PointerEvent): void {
    this._pointerId = event.pointerId;
    this._pointerStartY = event.clientY;
    this._pointerStartOffset = this._rawOffset;
    this._pointerMoved = false;
    this._mode = 'drag';
    this._velocity = 0;
    this._samples = [{ time: event.timeStamp, position: this._offset }];
  }

  private _onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    // Positive as the pointer moves down the screen. Later values render below
    // the centre, so dragging down has to lower the offset for the drum surface
    // to travel with the pointer rather than against it.
    const travel = event.clientY - this._pointerStartY;

    if (!this._pointerMoved && Math.abs(travel) < TapSlop) {
      return;
    }

    this._pointerMoved = true;

    this._rawOffset = this._pointerStartOffset - travel / this._itemHeight;
    this._offset = this._applyBounds(this._rawOffset);

    this._samples = pruneSamples(
      [...this._samples, { time: event.timeStamp, position: this._offset }],
      event.timeStamp,
    );

    this._commitFromOffset();
    this._scheduleRender();
  }

  /** Clears gesture state and the window listeners, leaving the drum where it is. */
  private _endGesture(): void {
    this._releaseCapture(this._pointerId);
    this._pointerId = null;
    this._pointerMoved = false;
    this._samples = [];
    this._mode = 'idle';
    this._detachPointerListeners();
  }

  private _onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this._pointerId) {
      return;
    }

    this._releaseCapture(this._pointerId);
    this._pointerId = null;
    this._detachPointerListeners();
    this._zone.run(() => this._onTouched());

    if (!this._pointerMoved) {
      this._mode = 'idle';

      return;
    }

    // Samples are only recorded while the pointer moves, so pausing before the
    // release leaves nothing but stale ones behind. Treat a release that lands
    // outside the sample window as a standstill, otherwise holding still and
    // letting go flings at whatever speed the pointer had before the pause.
    const newest = this._samples[this._samples.length - 1];
    const stale = !newest || event.timeStamp - newest.time >= VelocitySampleWindow;
    const velocity = stale ? 0 : velocityFrom(this._samples);

    this._samples = [];

    if (this._isOverscrolled() || Math.abs(velocity) < MinVelocity) {
      this._settleTo(Math.round(this._offset));
    } else {
      this._startFling(velocity);
    }
  }

  private _detachPointerListeners(): void {
    this._pointerListeners.forEach((off) => off());
    this._pointerListeners = [];
  }

  /**
   * Drops the capture taken at pointerdown. Safe to call for a pointer that has
   * already gone away - the browser reports it as not captured and we stop.
   */
  private _releaseCapture(pointerId: number): void {
    if (pointerId === null) {
      return;
    }

    const el = this.scrollContainer.nativeElement;

    try {
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      // Nothing to release. The gesture is over either way.
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private _onKeyDown(event: KeyboardEvent): void {
    const steps = {
      ArrowUp: -1,
      ArrowDown: 1,
      PageUp: -VisibleRadius,
      PageDown: VisibleRadius,
    };

    const step = steps[event.key];
    const isEdge = event.key === 'Home' || event.key === 'End';

    if (step === undefined && !isEdge) {
      return;
    }

    event.preventDefault();
    this._feedback.arm();
    this._zone.run(() => this._onTouched());

    const target = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? this.values.length - 1
        : this._snapBase() + step;

    this._settleTo(target);
  }

  // ---------------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------------

  private _startFling(velocity: number): void {
    // Choose the landing detent up front, then decelerate into it. Picking the
    // target now is what stops the drum coasting past a value and being yanked
    // back - it aims at a detent from the first frame.
    const clamped = Math.max(-MaxVelocity, Math.min(MaxVelocity, velocity));
    const projected = this._clampProjection(this._offset + projectFling(clamped));

    this._velocity = clamped;
    this._snapTarget = this._nearestEnabled(Math.round(projected));

    // Rounding to a detent moves the landing point off where the free coast
    // would have ended, so the decay is rescaled to cover the real distance in
    // the same span. Without this the drum decays towards the wrong place and
    // the spring has to haul it the rest of the way, which reads as the drum
    // settling and then jumping a value or two.
    this._flingDecay = decayFor(this._snapTarget - this._offset, clamped);

    this._mode = 'fling';
    this._lastFrameTime = 0;
    this._startLoop();
  }

  /**
   * Springs to a detent. Every target is clamped into range and moved off a
   * disabled value here, so no caller can land the drum somewhere unselectable.
   */
  private _settleTo(target: number): void {
    this._cancelFrame();

    const bounded = this.infinite ? target : this._clampIndex(target);

    this._snapTarget = this._nearestEnabled(bounded);
    this._snapVelocity = this._velocity;
    this._mode = 'snap';
    this._lastFrameTime = 0;
    this._startLoop();
  }

  /** Moves to a position with no animation - used by writeValue and input changes. */
  private _jumpTo(offset: number): void {
    this._cancelFrames();
    this._clearWheelTimer();
    this._endWheelGesture();

    this._mode = 'idle';
    this._velocity = 0;
    this._snapVelocity = 0;
    this._offset = this._rawOffset = offset;

    // Nobody scrolled here - a value was written or a column was rebuilt - so
    // the render below re-seats the tracker rather than ticking for the jump.
    this._feedback.reset();
    this._render();
  }

  private _startLoop(): void {
    // A pending render frame would otherwise fire mid-loop and clear its own
    // handle while the physics frames keep running.
    this._cancelRenderFrame();
    this._cancelFrame();

    const generation = this._generation;

    this._frame = requestAnimationFrame((now) => this._step(now, generation));
  }

  private _step(now: number, generation: number): void {
    // The loop was cancelled after this frame was dispatched - a drag started,
    // or the component was torn down. Retiring here is what stops the callback
    // re-scheduling itself into a loop nothing owns any more.
    if (generation !== this._generation) {
      return;
    }

    // Only momentum drives the loop. A gesture that took over mid-flight leaves
    // the mode as 'drag', and stepping the spring then would move the drum out
    // from under the pointer.
    if (this._mode !== 'fling' && this._mode !== 'snap') {
      this._frame = null;

      return;
    }

    const delta = this._lastFrameTime ? Math.min(now - this._lastFrameTime, 48) : 16;
    this._lastFrameTime = now;

    const running = this._mode === 'fling' ? this._stepFling(delta) : this._stepSnap(delta);

    this._commitFromOffset();
    this._render();

    if (running) {
      this._frame = requestAnimationFrame((next) => this._step(next, generation));
    } else {
      this._frame = null;
      this._mode = 'idle';
      this._finish();
    }
  }

  private _stepFling(delta: number): boolean {
    // Exponential decay sampled per frame, so the curve is frame-rate
    // independent. The rate is the one chosen at release, which aims this curve
    // at the detent rather than at wherever a free coast would have stopped.
    this._velocity *= Math.pow(this._flingDecay, delta);
    this._rawOffset += this._velocity * delta / 1000;
    this._offset = this._applyBounds(this._rawOffset);

    // Hand over for the last fraction of an item. The fling is already aimed at
    // the detent, so the spring is only removing the tail of the exponential
    // rather than hauling the drum somewhere new - that is what keeps the
    // transition invisible instead of jumping a value or two.
    const remaining = Math.abs(this._snapTarget - this._offset);

    // The second test is the backstop: an exponential approaches its target
    // without ever arriving, so on a long fling the remaining distance can stay
    // above the handoff threshold while the drum crawls. Without it the fling
    // never finishes and the drum rests between two values.
    if (this._isOverscrolled() || remaining <= FlingHandoffDistance || Math.abs(this._velocity) < MinVelocity) {
      this._snapVelocity = this._velocity;
      this._mode = 'snap';
    }

    return true;
  }

  private _stepSnap(delta: number): boolean {
    const seconds = delta / 1000;

    // While overscrolled the spring pulls back to the edge, not to wherever the
    // fling was originally aimed. The edge itself may be disabled, so it goes
    // through the same enabled-value search every other target does.
    const target = this._isOverscrolled()
      ? this._nearestEnabled(this._clampIndex(Math.round(this._offset)))
      : this._snapTarget;

    const displacement = this._offset - target;
    const acceleration = -SnapStiffness * displacement - SnapDamping * this._snapVelocity;

    this._snapVelocity += acceleration * seconds;
    this._offset += this._snapVelocity * seconds;
    this._rawOffset = this._offset;

    if (Math.abs(this._offset - target) < SnapEpsilon && Math.abs(this._snapVelocity) < SnapEpsilon * 100) {
      this._offset = this._rawOffset = target;
      this._snapVelocity = 0;
      this._velocity = 0;

      return false;
    }

    return true;
  }

  private _cancelFrame(): void {
    // Bumped unconditionally: a frame already dispatched for this generation
    // runs its callback even after cancelAnimationFrame, and the handle is
    // null in exactly that case.
    this._generation++;

    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
  }

  private _cancelFrames(): void {
    this._cancelFrame();
    this._cancelRenderFrame();
  }

  /** Emits the settled value inside Angular once motion has stopped. */
  private _finish(): void {
    const index = this._resolveIndex(Math.round(this._offset));

    // The drum has come to rest, so the native selection gesture opened at
    // pointerdown is closed here rather than left hanging.
    this._feedback.settle();

    this._zone.run(() => {
      this._commitIndex(index);
      this._cdRef.markForCheck();
    });
  }

  // ---------------------------------------------------------------------------
  // Bounds
  // ---------------------------------------------------------------------------

  /** Applies rubber-band resistance past the ends of a finite list. */
  private _applyBounds(raw: number): number {
    if (this.infinite || !this.values.length) {
      return raw;
    }

    const max = this.values.length - 1;

    if (raw < 0) {
      return rubberBand(raw, RubberBandLimit);
    }

    if (raw > max) {
      return max + rubberBand(raw - max, RubberBandLimit);
    }

    return raw;
  }

  private _isOverscrolled(): boolean {
    return !this.infinite && (this._offset < 0 || this._offset > this.values.length - 1);
  }

  /** Where a fling is allowed to land. */
  private _clampProjection(projected: number): number {
    return this.infinite ? projected : this._clampIndex(projected);
  }

  private _clampIndex(offset: number): number {
    if (!this.values.length) {
      return 0;
    }

    return Math.max(0, Math.min(this.values.length - 1, offset));
  }

  /** Pushes the current input values onto the feedback emitter. */
  private _syncFeedback(): void {
    this._feedback.haptics = this.haptics;
    this._feedback.sound = this.sound;
    this._feedback.respectMute = this.respectMute;
  }

  /** The detent a relative step counts from. */
  private _snapBase(): number {
    return this._mode === 'idle' ? Math.round(this._offset) : this._snapTarget;
  }

  /** Offset for the current value, falling back to the first item. */
  private _startOffset(): number {
    const index = this.getValueIndex();

    return index === -1 ? 0 : index;
  }

  /** Wraps an unbounded offset into a real array index. */
  private _resolveIndex(offset: number): number {
    const length = this.values.length;

    if (!length) {
      return 0;
    }

    if (!this.infinite) {
      return this._clampIndex(offset);
    }

    return ((offset % length) + length) % length;
  }

  /**
   * Nudges a snap target off a disabled value. Disabled items stay reachable by
   * dragging - this only stops momentum parking on one, the way iOS skips
   * unselectable rows.
   */
  private _nearestEnabled(target: number): number {
    if (!this.values.length) {
      return target;
    }

    const item = this.values[this._resolveIndex(target)];

    if (!item || !this.disabled[item.value]) {
      return target;
    }

    for (let distance = 1; distance <= this.values.length; distance++) {
      for (const candidate of [target - distance, target + distance]) {
        if (!this.infinite && (candidate < 0 || candidate > this.values.length - 1)) {
          continue;
        }

        const found = this.values[this._resolveIndex(candidate)];

        if (found && !this.disabled[found.value]) {
          return candidate;
        }
      }
    }

    return target;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private _measure(): void {
    const probe = this.scrollContainer.nativeElement.querySelector<HTMLElement>('.value');
    const height = probe?.offsetHeight;

    if (height) {
      this._itemHeight = height;
    }
  }

  /**
   * Coalesces renders during a gesture to one per frame. Skipped entirely while
   * the physics loop runs, since that already renders every frame.
   */
  private _scheduleRender(): void {
    if (this._frame !== null || this._renderFrame !== null) {
      return;
    }

    this._renderFrame = requestAnimationFrame(() => {
      this._renderFrame = null;
      this._render();
    });
  }

  private _cancelRenderFrame(): void {
    if (this._renderFrame !== null) {
      cancelAnimationFrame(this._renderFrame);
      this._renderFrame = null;
    }
  }

  /** Rebuilds the visible slots from the current offset. */
  private _render(): void {
    const centre = this._offset;
    const base = Math.round(centre);
    const max = this.values.length - 1;
    const slots: ScrollPickerSlot[] = [];

    // Every path that moves the drum renders, so one detent watcher here covers
    // drag, fling, snap, wheel and keyboard alike. Deliberately not hung off
    // `_commitIndex`, which skips disabled values and only fires on a real model
    // change - feedback would then go silent while the drum visibly spins
    // through a disabled stretch.
    this._feedback.detent(base);

    for (let i = -VisibleRadius; i <= VisibleRadius; i++) {
      const offset = base + i;
      const distance = offset - centre;

      // Negated because a positive rotateX carries an item up and over the top
      // of the drum. Later values belong below the centre, so that dragging
      // down turns the surface with the pointer instead of against it.
      const angle = -distance * ItemAngle;
      const inRange = this.infinite || (offset >= 0 && offset <= max);
      const item = inRange ? this.values[this._resolveIndex(offset)] ?? null : null;
      const magnitude = Math.abs(distance);

      slots.push({
        // Keyed by wrapped position so the same nine nodes are reused as the
        // drum turns, instead of being destroyed and recreated every frame.
        key: ((offset % slotCount) + slotCount) % slotCount,
        offset,
        item,
        angle,
        // Fade and shrink with distance so the drum reads as a curved surface.
        opacity: item ? Math.max(0, 1 - magnitude * 0.24) : 0,
        scale: Math.max(0.74, 1 - magnitude * 0.05),
        hidden: !item || Math.abs(angle) >= MaxVisibleAngle,
        disabled: !!(item && this.disabled[item.value]),
        selected: !!item && magnitude < 0.5,
      });
    }

    this.slots = slots;
    this._cdRef.markForCheck();
  }

  /** Tracks the model to the drum mid-gesture, so bound values update live. */
  private _commitFromOffset(): void {
    const index = this._resolveIndex(Math.round(this._offset));
    const item = this.values[index];

    if (item && item.value !== this.value) {
      this._commitIndex(index);
    }
  }

  private _commitIndex(index: number, emit = true): void {
    const item = this.values[index];
    const value = item ? item.value : null;

    if (value === this.value) {
      return;
    }

    this.value = value;

    if (emit) {
      this._zone.run(() => this._onChange(value));
    }
  }

  /**
   * Candidates for the widest label, stacked into the hidden sizer so the
   * browser settles which is actually widest.
   *
   * Character count alone gets this wrong: in a proportional font "kgs" is
   * wider than "lbs" despite both being three characters, and a column sized
   * to the wrong one clips the other. So every label of the longest character
   * length is measured, not just the first one found at that length.
   *
   * Long columns are the common case and are pure digits, which are
   * same-width in almost every font - so the shortcut below keeps a
   * thousand-row column from stacking a thousand sizer rows.
   */
  public get sizerItems(): { name: any, value: any }[] {
    if (!this.values.length) {
      return [];
    }

    const longest = this.values
      .reduce((width, item) => Math.max(width, String(item.name).length), 0);

    const candidates = this.values
      .filter((item) => String(item.name).length === longest);

    // Same-width glyphs mean the first candidate is as good as any other.
    const uniform = candidates
      .every((item) => /^[\d\s.,:-]*$/.test(String(item.name)));

    return uniform ? candidates.slice(0, 1) : candidates;
  }

  /** Drum radius that spaces adjacent items exactly one item-height apart. */
  public get radius(): number {
    return (this._itemHeight / 2) / Math.tan((ItemAngle / 2) * Math.PI / 180);
  }
}
