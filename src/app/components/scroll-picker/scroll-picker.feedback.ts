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
 * so the library ships no binary asset. It models the iPhone picker tick - see
 * the constants below for what that sound actually is and why it is built the
 * way it is.
 *
 * On a real device the effect is overwhelmingly tactile; audio alone is an
 * imitation of it. Inside a native shell the Capacitor tier above is what makes
 * it the real thing.
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
 * The tick models what an iPhone picker actually emits, which is not an audio
 * file: a picker calls UISelectionFeedbackGenerator, which plays no audio at
 * all. Everything the user hears is the Taptic Engine - a linear resonant
 * actuator - physically moving, plus the phone's enclosure ringing in
 * response. So it is a mechanical transient with no single frequency, and it
 * has to be synthesized rather than sampled.
 *
 * Two superimposed components, summed and rendered once (see `renderTick`):
 *
 * - BODY, the actuator. A short pitched thump that falls as it settles. The
 *   downward sweep is what stops it reading as a beep.
 * - CLICK, the enclosure transient. Band-limited noise, much shorter than the
 *   body, and the part that makes it a "click" rather than a "thud".
 *
 * The figures below were tuned by ear against the Clock app's timer wheel, not
 * derived from a spectrogram.
 *
 * The trap worth recording: the LRA's resonance, widely measured near 230Hz, is
 * what the HAND feels. Building the audible part around that figure produces a
 * low thump, and the real picker is a bright "tk" - what the ear gets is the
 * enclosure ringing, which sits far higher. Two earlier attempts here were
 * pitched near the haptic resonance and both sounded wrong for that reason.
 * The tick is now noise alone, high and very short.
 *
 * One thing iOS does that is worth keeping: its tactile output holds a constant
 * frequency while the AUDIO pitch falls as the wheel slows (described in Apple's
 * haptic patents, which is also the only documented figure anywhere near this -
 * a 270Hz "MicroTap" on the tactile side). `_rateFor` reproduces that, and it is
 * a large part of why a fling sounds like a wheel winding down rather than a
 * rattle at one note.
 */

/**
 * Total rendered length of the tick, in seconds.
 *
 * Three milliseconds. That is short enough that the event has no duration the
 * ear can hold on to - it registers as an edge rather than a sound, which is
 * exactly what a detent passing is.
 */
const tickDuration = 0.003;

/**
 * Centre frequency (Hz) of the bandpass shaping the noise.
 *
 * Very high, and chosen by ear against the Clock app's timer wheel rather than
 * derived. Nobody has published the audible click's frequency - Apple's patents
 * document the haptic side (a 270Hz "MicroTap") and say nothing about what the
 * speaker emits - so this is the one number here that came from listening.
 */
const clickFrequency = 9000;

/**
 * Q of that bandpass. Deliberately broad: at this width the result is bright
 * noise rather than a pitched ping, which is what keeps it a "tk" and not a
 * beep.
 */
const clickQ = 0.3;

/** Seconds of noise the click is cut from. The whole tick, at this length. */
const clickNoise = 0.003;

/** Peak gain of the noise before the bus. */
const clickGain = 0.85;

/** Seconds by which the click has decayed to silence. */
const clickDecay = 0.003;

/**
 * Corner frequency (Hz) of the highpass on the bus.
 *
 * Sits just under the band itself, so everything below the click is gone. Left
 * in rather than folded into the bandpass because the two shape different
 * things: the bandpass picks the colour, this guarantees nothing low survives
 * to muddy it.
 */
const busHighpass = 6300;

/**
 * Playback gain. A UI sound belongs under everything else on the page.
 */
const tickGain = 0.32;

/**
 * Floor for exponential ramps. Web Audio cannot ramp to or from zero, so the
 * envelopes start and end at this instead.
 */
const rampFloor = 0.0001;

/**
 * Random spread applied to playbackRate per tick, as a fraction.
 *
 * One pre-rendered buffer replayed identically sounds machine-gun-like on a
 * fast scroll. A few percent is enough to break up the repetition without the
 * pitch wobble becoming audible on its own.
 */
const rateJitter = 0.03;

/**
 * Playback rate at the fastest and slowest ends of a scroll.
 *
 * The pitch falling as the drum slows is not a flourish - it is how the real
 * thing works. Apple's haptic patents describe the tactile output holding a
 * constant frequency while the AUDIO frequency is decreased as the picker slows,
 * specifically to avoid driving the actuator harder. It is also the part people
 * actually recognise: a fixed-pitch tick sounds like a machine, and a falling
 * one sounds like a wheel coming to rest.
 */
const rateFast = 1.18;
const rateSlow = 0.82;

/**
 * Tick gap (ms) treated as a fast scroll, and as a stopped one.
 *
 * The gap between detents is already a measure of scroll speed, so no velocity
 * has to be plumbed through from the physics: crossings 30ms apart are a flick,
 * and 260ms apart is a drum about to stop.
 */
const gapFast = 30;
const gapSlow = 260;

/**
 * Shortest gap (ms) between two ticks, and the highest-impact number here.
 *
 * A hard flick crosses sixty or more items per second. Unthrottled, the ticks
 * stop being separate events and become a continuous buzz - the illusion
 * collapses immediately. Anything arriving sooner than this is dropped.
 */
const minInterval = 29;


/**
 * One AudioContext and one noise buffer for every picker on the page.
 *
 * Deliberately module-level rather than per-instance. Safari on iOS caps a
 * document at a handful of AudioContexts - roughly four - and refuses or
 * permanently suspends the rest. A page with several pickers (a date picker
 * alone is three, and a numeric picker is up to four columns) blows past that
 * instantly: the first few drums click and every one after them is silent,
 * which is impossible to spot on desktop where the cap is far higher.
 *
 * Sharing also means the unlock only has to be won once: whichever picker is
 * touched first resumes the context, and every other drum on the page is
 * audible immediately rather than each waiting for its own gesture.
 */
const shared: {
  context: AudioContext;
  tick: AudioBuffer;
  unlock: (() => void)[];
} = {
  context: null,
  tick: null,
  unlock: [],
};

/** How many live feedback instances are sharing the context above. */
let instances = 0;


/**
 * Renders the tick once into a buffer, off the audio thread.
 *
 * Building the oscillator/filter graph per tick is audible: on a fast scroll it
 * crackles and the timing drifts, because each tick pays for node construction
 * before it can start. Rendering once and replaying the result is both cheaper
 * and exact.
 */
function renderTick(sampleRate: number): Promise<AudioBuffer> {
  const offlineCtor = (window as any).OfflineAudioContext
    ?? (window as any).webkitOfflineAudioContext;

  if (!offlineCtor) {
    return Promise.reject(new Error('no OfflineAudioContext'));
  }

  const frames = Math.ceil(sampleRate * tickDuration);
  const offline: OfflineAudioContext = new offlineCtor(1, frames, sampleRate);

  // Both components share one highpass into the destination.
  const bus = offline.createBiquadFilter();

  bus.type = 'highpass';
  bus.frequency.value = busHighpass;
  bus.connect(offline.destination);

  renderClick(offline, bus, sampleRate);

  return offline.startRendering();
}

/**
 * The whole tick: a very short burst of band-limited noise.
 *
 * There was a second, pitched component here modelling the actuator. It is
 * gone: at three milliseconds behind a 6.3kHz highpass it was filtered into
 * silence and only muddied what survived. What the ear gets from a real picker
 * is the enclosure, and the enclosure is noise.
 */
function renderClick(offline: OfflineAudioContext, bus: AudioNode, sampleRate: number): void {
  const samples = Math.ceil(sampleRate * clickNoise);
  const noise = offline.createBuffer(1, samples, sampleRate);
  const channel = noise.getChannelData(0);

  for (let i = 0; i < samples; i++) {
    channel[i] = Math.random() * 2 - 1;
  }

  const click = offline.createBufferSource();
  const band = offline.createBiquadFilter();
  const envelope = offline.createGain();

  click.buffer = noise;

  band.type = 'bandpass';
  band.frequency.value = clickFrequency;
  band.Q.value = clickQ;

  envelope.gain.setValueAtTime(clickGain, 0);
  envelope.gain.exponentialRampToValueAtTime(rampFloor, clickDecay);

  click.connect(band);
  band.connect(envelope);
  envelope.connect(bus);
  click.start(0);
}


/**
 * Emits a tick per detent crossed. One instance per picker, owned by the
 * component and disposed with it. The audio context itself is shared across
 * every instance - see `shared` above.
 */
export class ScrollPickerFeedback {

  // Mirrors of the component's inputs, pushed across on every change. The
  // component owns the real defaults; these are overwritten before first use.
  public haptics = true;
  public sound = true;
  public respectMute = false;

  /**
   * Last detent a tick was fired for. Null until the first render seats it, so
   * that seating the drum on its initial value does not tick.
   */
  private _detent: number = null;

  private _lastTick = 0;

  /**
   * Capacitor's Haptics plugin, or null when not running under one. Undefined
   * until first looked up - the lookup walks a global and this is consulted
   * from the render path, so it resolves once and is cached either way.
   */
  private _plugin: HapticsPlugin | null = undefined;

  /** True between selectionStart and selectionEnd, so they stay paired. */
  private _selecting = false;

  constructor() {
    instances++;
  }

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

    if (!shared.context) {
      const context = (window as any).AudioContext ?? (window as any).webkitAudioContext;

      if (!context) {
        return;
      }

      // 'interactive' asks for the smallest buffer the device will give, which
      // is what keeps the tick feeling attached to the drum rather than
      // trailing it.
      shared.context = new context({ latencyHint: 'interactive' });

      this._prerender();
    }

    // Re-applied on every arm rather than only at construction: the category is
    // driven by an input that can change after the context already exists, and
    // the context is shared, so the picker being touched should win.
    this._session();
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

  /**
   * Releases this instance's share of the audio. The context and noise buffer
   * outlive any single picker and are torn down only when the last one goes -
   * closing them while another drum is still on the page would silence it.
   */
  public destroy(): void {
    this.settle();

    instances = Math.max(0, instances - 1);

    if (instances > 0) {
      return;
    }

    this._releaseUnlock();

    shared.tick = null;

    if (shared.context) {
      shared.context.close().catch(() => { /* already closed by teardown */ });
      shared.context = null;
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
    if (!shared.context || shared.context.state !== 'suspended') {
      return;
    }

    shared.context.resume().catch(() => { /* refused; the listeners below retry */ });

    if (shared.unlock.length || typeof document === 'undefined') {
      return;
    }

    const unlock = (): void => {
      shared.context?.resume()
        .then(() => this._releaseUnlock())
        .catch(() => { /* still refused; the listeners stay for the next press */ });
    };

    // The events the HTML spec counts as activation triggers. Capture phase and
    // passive, so nothing here can interfere with the page's own handlers.
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchend']) {
      document.addEventListener(type, unlock, { capture: true, passive: true });
      shared.unlock.push(() => {
        document.removeEventListener(type, unlock, { capture: true });
      });
    }
  }

  private _releaseUnlock(): void {
    shared.unlock.forEach((off: () => void) => off());
    shared.unlock = [];
  }

  /**
   * Declares the audio session category, where the browser supports saying so.
   *
   * 'ambient' is the correct category for a UI sound: it mixes with whatever
   * the user is already playing rather than ducking it, and it obeys the iPhone
   * ringer switch the way every native iOS UI sound does. The cost is that a
   * muted phone is silent - which is the intent, but surprising if you are
   * trying to demo the tick with the switch flipped off.
   *
   * 'playback' ignores the switch. It is left to the app because the trade is
   * the app's to make: a kiosk or a demo may legitimately want to be heard, and
   * a consumer app almost never should.
   */
  private _session(): void {
    const session = (navigator as any).audioSession;

    if (session) {
      session.type = this.respectMute ? 'ambient' : 'playback';
    }
  }

  /** Kicks off the one-time offline render of the tick buffer. */
  private _prerender(): void {
    if (shared.tick || !shared.context) {
      return;
    }

    renderTick(shared.context.sampleRate)
      .then((buffer: AudioBuffer) => shared.tick = buffer)
      .catch(() => { /* no offline context; ticks stay silent */ });
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
    const gap = now - this._lastTick;

    if (gap < minInterval) {
      return;
    }

    // Captured before `_lastTick` moves: the gap since the previous tick is the
    // scroll speed the pitch is taken from.
    this._lastTick = now;

    if (this.haptics) {
      this._vibrate();
    }

    if (this.sound) {
      this._click(gap);
    }
  }

  /**
   * Playback rate for a tick that arrived `gap` ms after the last one.
   *
   * Fast scroll gives a higher pitch, a slowing one lower, which is what makes
   * a fling audibly wind down rather than rattling at one note. The first tick
   * of a gesture has no previous tick to measure against, so it starts at the
   * fast end - a gesture always begins with movement.
   */
  private _rateFor(gap: number): number {
    const span = gapSlow - gapFast;
    const clamped = Math.max(gapFast, Math.min(gapSlow, gap));
    const slowness = (clamped - gapFast) / span;
    const rate = rateFast + (rateSlow - rateFast) * slowness;

    return rate * (1 + (Math.random() * 2 - 1) * rateJitter);
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

  private _click(gap: number): void {
    if (!shared.context) {
      return;
    }

    const rate = this._rateFor(gap);

    // A context resumed inside this same gesture is often still 'suspended'
    // here: resume() is async and the first ticks of a drag arrive before it
    // settles. Nudging it again and playing anyway is what makes the opening
    // ticks audible - bailing on the state instead silently dropped every tick
    // of the first drag after load, which on iOS is every drag, since the
    // context there always starts suspended.
    if (shared.context.state === 'suspended') {
      this._resume();
    }

    // 'closed' is terminal - teardown has run and the nodes below would throw.
    // A missing buffer means the offline render has not landed yet; the next
    // tick will find it.
    if (shared.context.state === 'closed' || !shared.tick) {
      return;
    }

    this._play(shared.context, shared.tick, rate);
  }

  /** Replays the pre-rendered tick at `rate`. Two nodes, no synthesis. */
  private _play(context: AudioContext, buffer: AudioBuffer, rate: number): void {
    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;

    // Resampling the one buffer is what shifts the pitch - cheaper than
    // re-rendering per tick, and the shift is small enough that the artefacts
    // of doing it this way are inaudible on a 12ms transient.
    source.playbackRate.value = rate;

    gain.gain.value = tickGain;

    source.connect(gain);
    gain.connect(context.destination);
    source.start();

    // Nodes are single-use and pile up until collected otherwise; a long fling
    // creates one pair per detent.
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }
}
