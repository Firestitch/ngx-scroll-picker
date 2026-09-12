/**
 * Tactile and audible feedback for the scroll picker.
 *
 * Fires once per detent the drum passes, which is what a native picker does -
 * a tick per value, not a tick per settle.
 *
 * The haptic channel has three tiers, tried in order, because no single API
 * covers every platform:
 *
 * 1. Capacitor's Haptics plugin, when the picker is running inside a native
 *    shell that has it. This is the only way to reach the iOS Taptic Engine,
 *    and on Android it drives the platform haptic APIs rather than the raw
 *    motor - so it is the best tier on both, not an iOS workaround.
 *
 * 2. The Vibration API, which Android Chrome implements and iOS Safari never
 *    has. Every iOS browser is WebKit underneath, so iOS Chrome lacks it too.
 *
 * 3. Nothing. A plain web page on iOS cannot produce haptics at all, and the
 *    sound is what carries the feel there.
 *
 * Sound is Web Audio, works everywhere, and is synthesized rather than loaded
 * so the library ships no binary asset. The tick is a short burst of highpassed
 * white noise: a real detent is broadband, and any oscillator - however brief -
 * is heard as a beep before it is heard as a click.
 *
 * Capacitor is reached through the global it injects rather than imported, so
 * this library keeps its empty dependency list and plain web consumers install
 * nothing. That costs the plugin's own types, hence the local interfaces below
 * describing the small surface actually called.
 */

/** The part of Capacitor's Haptics plugin this uses. */
interface HapticsPlugin {
  /**
   * The detent tick. This is what UIPickerView itself calls on iOS, and it
   * feels materially more correct than a light impact - an impact reads as
   * hitting something, a selection change as passing a notch.
   */
  selectionChanged?: () => Promise<void>;

  /** Called once as a selection gesture begins, so the engine can warm up. */
  selectionStart?: () => Promise<void>;

  /** Called once when the gesture is over. */
  selectionEnd?: () => Promise<void>;
}

/** The part of the injected Capacitor global this uses. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: { Haptics?: HapticsPlugin };
}

/**
 * Vibration length in ms. Short enough to read as a tick rather than a buzz -
 * past about 15ms an Android motor has spun up far enough to feel like a
 * rumble, which is the wrong sensation for passing a detent.
 */
const vibrateDuration = 8;

/**
 * Corner frequency (Hz) of the highpass the click's noise runs through.
 *
 * The tick is a filtered noise burst rather than an oscillator because that is
 * what a real detent is: a broadband transient, not a pitch. An oscillator at
 * any frequency reads as a beep, however short it is - the ear hears the note
 * before it hears the click. Cutting everything below this leaves only the
 * bright edge of the noise, which is the part that sounds like something
 * mechanical passing a notch.
 */
const clickHighpass = 4000;

/**
 * Length of the click envelope in seconds. Extremely short by design - at this
 * duration the burst is heard as a single transient, and a fast fling stays a
 * run of distinct ticks instead of smearing into noise.
 */
const clickDuration = 0.006;

/**
 * Peak gain of the click. Louder than a tonal tick of the same perceived
 * volume needs to be: the burst is six milliseconds long, so there is very
 * little energy in it and the ear needs the amplitude to register the edge.
 */
const clickGain = 0.35;

/**
 * Length in seconds of the reusable white-noise buffer the clicks are cut from.
 *
 * Generated once and shared by every tick. Long enough that consecutive ticks
 * start at different offsets and do not sound like a repeating sample, short
 * enough to stay negligible in memory.
 */
const noiseDuration = 0.05;

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

  // Mirrors of the component's inputs, pushed across on every change. The
  // component owns the real defaults; these are overwritten before first use.
  public haptics = true;
  public sound = true;

  /**
   * Last detent a tick was fired for. Null until the first render seats it, so
   * that seating the drum on its initial value does not tick.
   */
  private _detent: number = null;

  private _lastTick = 0;

  private _context: AudioContext = null;

  /**
   * Capacitor's Haptics plugin, or null when not running under one. Undefined
   * until first looked up - the lookup walks a global and this is consulted
   * from the render path, so it resolves once and is cached either way.
   */
  private _plugin: HapticsPlugin | null = undefined;

  /** True between selectionStart and selectionEnd, so they stay paired. */
  private _selecting = false;

  /** Detaches the document-level unlock listeners, once they have fired. */
  private _unlockListeners: (() => void)[] = [];

  /**
   * White noise every click is cut from. Built once on the first tick, because
   * it needs the context's sample rate and the context does not exist until a
   * gesture has armed it.
   */
  private _noise: AudioBuffer = null;

  private get _enabled(): boolean {
    return this.haptics || this.sound;
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
    if (this.haptics) {
      this._startSelection();
    }

    if (!this.sound) {
      return;
    }

    if (!this._context) {
      const context = (window as any).AudioContext ?? (window as any).webkitAudioContext;

      if (!context) {
        return;
      }

      this._context = new context();
    }

    this._resume();
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

  /**
   * Closes the native selection gesture opened by `arm`. Called when the drum
   * comes to rest, so the engine is not left holding a gesture open.
   */
  public settle(): void {
    if (!this._selecting) {
      return;
    }

    this._selecting = false;

    this._resolvePlugin()?.selectionEnd?.()
      .catch(() => { /* bridge gone; nothing to close */ });
  }

  public destroy(): void {
    this.settle();
    this._releaseUnlock();

    this._noise = null;

    if (this._context) {
      this._context.close().catch(() => { /* already closed by teardown */ });
      this._context = null;
    }
  }

  /**
   * Resumes the context, and if that is refused, waits for an event the browser
   * will accept.
   *
   * A wheel is not user activation - the HTML spec excludes it and Chrome
   * refuses to resume from one - so a picker driven only by the wheel would
   * resume, be refused, and stay suspended forever while every tick scheduled
   * itself into a context that never runs. Listening for the next real press
   * anywhere on the page is what gets those pickers audible, rather than
   * requiring the user to happen to press on the drum itself.
   */
  private _resume(): void {
    if (!this._context || this._context.state !== 'suspended') {
      return;
    }

    this._context.resume().catch(() => { /* refused; the listeners below retry */ });

    if (this._unlockListeners.length || typeof document === 'undefined') {
      return;
    }

    const unlock = (): void => {
      this._context?.resume()
        .then(() => this._releaseUnlock())
        .catch(() => { /* still refused; the listeners stay for the next press */ });
    };

    // The events the HTML spec counts as activation triggers. Capture phase and
    // passive, so nothing here can interfere with the page's own handlers.
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchend']) {
      document.addEventListener(type, unlock, { capture: true, passive: true });
      this._unlockListeners.push(() => {
        document.removeEventListener(type, unlock, { capture: true });
      });
    }
  }

  private _releaseUnlock(): void {
    this._unlockListeners.forEach((off: () => void) => off());
    this._unlockListeners = [];
  }

  /**
   * Opens a native selection gesture, if the plugin supports the pairing.
   *
   * Optional because `selectionStart`/`selectionEnd` are a refinement: a plugin
   * exposing only `selectionChanged` still ticks correctly without them.
   */
  private _startSelection(): void {
    if (this._selecting) {
      return;
    }

    const start = this._resolvePlugin()?.selectionStart;

    if (!start) {
      return;
    }

    this._selecting = true;

    start.call(this._resolvePlugin())
      .catch(() => {
        // Opening failed, so there is no gesture to close. Clearing the flag
        // keeps `settle` honest and lets the next gesture try again rather
        // than being skipped as already-open. Ticks fire on their own either
        // way - the pairing is a refinement, not a prerequisite.
        this._selecting = false;
      });
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

  /**
   * Capacitor's Haptics plugin when one is reachable, else null.
   *
   * Guarded at every step rather than assumed: the global exists in a native
   * shell but the plugin is a separate install, and on the web the global is
   * absent entirely. `isNativePlatform` also returns false for a Capacitor app
   * served in a browser, where the plugin cannot do anything.
   */
  private _resolvePlugin(): HapticsPlugin | null {
    if (this._plugin !== undefined) {
      return this._plugin;
    }

    this._plugin = null;

    if (typeof window === 'undefined') {
      return this._plugin;
    }

    const capacitor: CapacitorGlobal = (window as any).Capacitor;

    if (!capacitor?.isNativePlatform?.()) {
      return this._plugin;
    }

    // Newer Capacitor registers plugins lazily, so the availability check is
    // the reliable test; the Plugins bag is the fallback for older versions.
    const available = capacitor.isPluginAvailable?.('Haptics') ?? true;
    const plugin = capacitor.Plugins?.Haptics;

    if (available && typeof plugin?.selectionChanged === 'function') {
      this._plugin = plugin;
    }

    return this._plugin;
  }

  private _vibrate(): void {
    const plugin = this._resolvePlugin();

    if (plugin) {
      // Fire and forget. These resolve on a round trip to the native layer,
      // and a tick that has already happened is not worth awaiting - nor worth
      // an unhandled rejection if the bridge is torn down mid-gesture.
      plugin.selectionChanged().catch(() => { /* bridge gone or plugin refused */ });

      return;
    }

    // No native bridge. Absent on iOS at any version, and present but a no-op
    // on desktop Chrome where there is no motor. Both cases are silent.
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

  /** The shared white-noise buffer, generated on first use. */
  private _noiseBuffer(context: AudioContext): AudioBuffer {
    if (this._noise) {
      return this._noise;
    }

    const samples = Math.floor(context.sampleRate * noiseDuration);

    this._noise = context.createBuffer(1, samples, context.sampleRate);

    const channel = this._noise.getChannelData(0);

    for (let i = 0; i < samples; i++) {
      channel[i] = Math.random() * 2 - 1;
    }

    return this._noise;
  }

  private _click(): void {
    if (!this._context) {
      return;
    }

    // A context resumed inside this same gesture is often still 'suspended'
    // here: resume() is async and the first ticks of a drag arrive before it
    // settles. Nudging it again and scheduling the click anyway is what makes
    // the opening ticks audible - bailing on the state instead silently
    // dropped every tick of the first drag after load, which on iOS is every
    // drag, since the context there always starts suspended.
    if (this._context.state === 'suspended') {
      this._resume();
    }

    // 'closed' is terminal - teardown has run and the nodes below would throw.
    if (this._context.state === 'closed') {
      return;
    }

    this._burst(this._context);
  }

  /** Schedules one highpassed noise burst on the context's own clock. */
  private _burst(context: AudioContext): void {
    const start = context.currentTime;
    const source = context.createBufferSource();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = this._noiseBuffer(context);
    highpass.type = 'highpass';
    highpass.frequency.value = clickHighpass;

    // Ramped to near-silence rather than stopped flat. Cutting the signal off
    // mid-burst puts a step in it, which is audible as a pop on top of the
    // click. Exponential ramps cannot reach zero, hence the small floor.
    gain.gain.setValueAtTime(clickGain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + clickDuration);

    source.connect(highpass);
    highpass.connect(gain);
    gain.connect(context.destination);

    // Each burst starts at a random offset in the buffer, so a run of ticks is
    // not the same few milliseconds of noise repeating - which the ear picks up
    // as a tone very quickly.
    source.start(start, Math.random() * (noiseDuration - clickDuration), clickDuration);

    // Nodes are single-use and pile up until collected otherwise; a long fling
    // creates one set per detent.
    source.onended = () => {
      source.disconnect();
      highpass.disconnect();
      gain.disconnect();
    };
  }
}
