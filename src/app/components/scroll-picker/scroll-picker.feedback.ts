/**
 * Tactile and audible feedback for the scroll picker.
 *
 * Fires once per detent the drum passes, which is what a native picker does -
 * a tick per value, not a tick per settle. The two channels are independent
 * because their platform support is not the same:
 *
 * - Vibration is the Vibration API, which Android Chrome implements and iOS
 *   Safari never has. Every iOS browser is WebKit underneath, so iOS Chrome
 *   does not have it either. There is no polyfill - a page cannot reach the
 *   Taptic Engine - so on iOS this channel is simply absent and the sound is
 *   what carries the feel.
 *
 * - Sound is Web Audio, which works everywhere, and is synthesized here rather
 *   than loaded so the library ships no binary asset.
 */

/**
 * Vibration length in ms. Short enough to read as a tick rather than a buzz -
 * past about 15ms an Android motor has spun up far enough to feel like a
 * rumble, which is the wrong sensation for passing a detent.
 */
const vibrateDuration = 8;

/** Oscillator frequency (Hz) for the click. Close to the iOS picker's pitch. */
const clickFrequency = 1100;

/**
 * Length of the click envelope in seconds. A detent tick is a transient, not a
 * tone: long enough to be audible, short enough that a fast fling produces a
 * run of distinct ticks instead of a continuous drone.
 */
const clickDuration = 0.028;

/**
 * Peak gain of the click. Deliberately quiet - this plays on every value the
 * drum passes, and a fling can pass dozens in a second.
 */
const clickGain = 0.05;

/**
 * Shortest gap (ms) between two ticks. A hard fling crosses detents faster than
 * either channel can usefully reproduce: the vibration motor cannot restart
 * that quickly and the clicks smear into a buzz. Dropping the ticks in between
 * keeps a fast spin sounding like a fast spin rather than a tone.
 */
const minInterval = 18;


/**
 * Emits a tick per detent crossed. One instance per picker, owned by the
 * component and disposed with it.
 */
export class ScrollPickerFeedback {

  public haptics = false;
  public sound = false;

  /**
   * Last detent a tick was fired for. Null until the first render seats it, so
   * that seating the drum on its initial value does not tick.
   */
  private _detent: number = null;

  private _lastTick = 0;

  private _context: AudioContext = null;

  /**
   * Cached rather than re-queried per tick: matchMedia is a layout-adjacent
   * read, and this runs inside the render path.
   */
  private _reduced = false;

  private _reducedQuery: MediaQueryList = null;
  private _onReducedChange: () => void = null;

  constructor() {
    if (typeof matchMedia !== 'function') {
      return;
    }

    this._reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this._reduced = this._reducedQuery.matches;

    this._onReducedChange = () => this._reduced = this._reducedQuery.matches;
    this._reducedQuery.addEventListener('change', this._onReducedChange);
  }

  private get _enabled(): boolean {
    return (this.haptics || this.sound) && !this._reduced;
  }

  /**
   * Prepares the audio channel from inside a user gesture.
   *
   * An AudioContext created outside one starts suspended, and the first click
   * would then be silent - browsers only let audio begin in response to a real
   * interaction. Calling this from pointerdown is what makes the tick during
   * the drag that follows actually audible.
   */
  public arm(): void {
    if (!this.sound || this._reduced) {
      return;
    }

    if (!this._context) {
      const context = (window as any).AudioContext ?? (window as any).webkitAudioContext;

      if (!context) {
        return;
      }

      this._context = new context();
    }

    // Suspended is the normal state for a context built before a gesture, and
    // also what iOS drops it to after the page has been backgrounded.
    if (this._context.state === 'suspended') {
      this._context.resume().catch(() => { /* left suspended; ticks stay silent */ });
    }
  }

  /**
   * Reports where the drum is centred, in items. Ticks when that crosses into a
   * new detent.
   *
   * Takes the rounded detent rather than the raw offset so it is insensitive to
   * how far past centre a gesture has travelled - a drum rocking either side of
   * one value produces one tick, not a burst.
   */
  public detent(detent: number): void {
    if (this._detent === detent) {
      return;
    }

    // The first report seats the tracker without firing: the drum is being
    // placed on its starting value, which the user did not scroll to.
    const seated = this._detent !== null;

    this._detent = detent;

    if (seated && this._enabled) {
      this._tick();
    }
  }

  /**
   * Forgets the tracked detent, so the next report seats instead of ticking.
   * Used when the drum is moved with no gesture behind it - a written value or
   * a rebuilt column - which would otherwise tick for a jump nobody scrolled.
   */
  public reset(): void {
    this._detent = null;
  }

  public destroy(): void {
    if (this._reducedQuery && this._onReducedChange) {
      this._reducedQuery.removeEventListener('change', this._onReducedChange);
      this._reducedQuery = null;
      this._onReducedChange = null;
    }

    if (this._context) {
      this._context.close().catch(() => { /* already closed by teardown */ });
      this._context = null;
    }
  }

  private _tick(): void {
    const now = performance.now();

    if (now - this._lastTick < minInterval) {
      return;
    }

    this._lastTick = now;

    if (this.haptics) {
      this._vibrate();
    }

    if (this.sound) {
      this._click();
    }
  }

  private _vibrate(): void {
    // Absent on iOS at any version, and present but a no-op on desktop Chrome
    // where there is no motor. Both cases are silent by design.
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }

    try {
      navigator.vibrate(vibrateDuration);
    } catch {
      // Some browsers throw rather than no-op when vibration is blocked by a
      // permissions policy. A tick is not worth propagating an exception into
      // the render path for.
    }
  }

  private _click(): void {
    if (!this._context || this._context.state !== 'running') {
      return;
    }

    const context = this._context;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.value = clickFrequency;

    // A square wave gives the click its edge - a sine at this length reads as a
    // soft blip rather than a detent snapping past.
    oscillator.type = 'square';

    // Ramped to near-silence rather than stopped flat. Cutting a waveform off
    // mid-cycle puts a step in the signal, which is audible as a pop on top of
    // the click. Exponential ramps cannot reach zero, hence the small floor.
    gain.gain.setValueAtTime(clickGain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + clickDuration);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(start);
    oscillator.stop(start + clickDuration);

    // Nodes are single-use and pile up until collected otherwise; a long fling
    // creates one pair per detent.
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
