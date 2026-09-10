/**
 * Physics constants and helpers for the scroll picker.
 *
 * The picker tracks a single continuous `offset` measured in items (not pixels),
 * where offset 0 means "item 0 is centred in the selection band". Everything
 * else — rendering, momentum, snapping — is derived from that one number.
 */

/** Angular spacing between adjacent items on the drum, in degrees. */
export const ItemAngle = 20;

/** Items rendered above/below centre. The drum shows 2 * VisibleRadius + 1 slots. */
export const VisibleRadius = 4;

/** Items beyond this angle from centre are on the back of the drum and hidden. */
export const MaxVisibleAngle = 90;

/**
 * Per-millisecond velocity decay during a momentum fling, matching the constant
 * UIScrollView uses. It gives a long, smooth glide; the spring handoff below is
 * what keeps that glide from taking too long to actually stop.
 */
export const Deceleration = 0.998;

/** Below this speed (items/sec) a fling is considered finished and we snap. */
export const MinVelocity = 0.08;

/** Velocity is clamped to this to stop a violent flick spinning the drum forever. */
export const MaxVelocity = 28;

/**
 * How far past the first/last item the drum can be dragged, in items. Matches
 * the feel of a UITableView bouncing against its content edge.
 */
export const RubberBandLimit = 2.5;

/** Stiffness of the spring that pulls the drum back from an overscroll. */
export const RubberBandStiffness = 0.55;

/**
 * Spring constant for the settle-into-detent animation. Tuned so a half-item
 * correction completes in about 320ms, which is the range a native picker
 * settles in.
 */
export const SnapStiffness = 900;

/**
 * Damping ratio of 0.9 — just under critical. Fastest settle that still shows
 * no overshoot, so the drum never visibly bounces past the value it picked.
 */
export const SnapDamping = 0.9 * 2 * Math.sqrt(SnapStiffness);

/** Distance (items) and speed under which the snap spring is declared done. */
export const SnapEpsilon = 0.0008;

/**
 * Remaining distance (items) at which a fling hands off to the snap spring.
 *
 * The fling is aimed at its detent and rescaled to land there, so this only
 * cuts the tail off the exponential - the spring finishes a journey that is
 * already almost over. It has to stay small: the spring covers any distance in
 * roughly the same time, so its speed scales with the gap it is handed. Hand
 * over with a large gap still open and it moves far faster than the fling was
 * moving, and the drum visibly jumps the last value or two instead of easing
 * onto it. At this distance the spring peaks around 0.02 items per frame,
 * well under a pixel on a normal row.
 */
export const FlingHandoffDistance = 0.08;

/** Window (ms) of pointer samples used to compute release velocity. */
export const VelocitySampleWindow = 90;

/** Pointer travel (px) before a gesture counts as a drag rather than a tap. */
export const TapSlop = 6;

/** A wheel gesture is considered finished after this long with no wheel event. */
export const WheelIdleTimeout = 90;

/**
 * Trackpads emit many small deltas; mouse wheels emit few large ones. Anything
 * at or above this magnitude is treated as a notched mouse wheel and mapped to
 * exactly one item per notch, which is what users expect from a wheel.
 */
export const WheelNotchThreshold = 45;

export interface Sample {
  time: number;
  position: number;
}

/**
 * Applies progressive resistance to movement past an edge. The further out you
 * drag the less each pixel moves the drum, which is what makes an iOS list feel
 * attached to a rubber band rather than simply stopping.
 *
 * @param overflow How far past the edge we are, in items.
 * @param limit    Maximum travel past the edge, in items.
 */
export function rubberBand(overflow: number, limit: number): number {
  const sign = Math.sign(overflow);
  const distance = Math.abs(overflow);

  return sign * (1 - 1 / (distance * RubberBandStiffness / limit + 1)) * limit;
}

/**
 * Where a fling would come to rest given a starting velocity, using the same
 * exponential decay the animation loop applies. Used to choose a snap target up
 * front so the drum decelerates straight into a detent instead of drifting past
 * it and being yanked back.
 */
export function projectFling(velocity: number): number {
  return velocity * (1 / (1 - Deceleration)) / 1000;
}

/**
 * Per-millisecond decay that brings `velocity` to rest after exactly
 * `distance` items.
 *
 * An exponential coast travels `velocity * tau`, so asking it to cover a
 * particular distance fixes tau, and tau fixes the decay. Rounding the landing
 * point to a detent always shifts the distance a little, and rescaling the
 * decay to match is what lets the fling curve end on the detent under its own
 * deceleration rather than being pulled the last stretch by the spring.
 *
 * Falls back to the default when the numbers cannot describe a coast - no
 * distance, no speed, or a target behind the direction of travel.
 */
export function decayFor(distance: number, velocity: number): number {
  if (!distance || !velocity || Math.sign(distance) !== Math.sign(velocity)) {
    return Deceleration;
  }

  const tau = Math.abs(distance / velocity) * 1000;

  if (!Number.isFinite(tau) || tau <= 0) {
    return Deceleration;
  }

  return Math.exp(-1 / tau);
}

/** Velocity in items/sec from recent pointer samples, or 0 if there aren't enough. */
export function velocityFrom(samples: Sample[]): number {
  if (samples.length < 2) {
    return 0;
  }

  const last = samples[samples.length - 1];
  const first = samples[0];
  const elapsed = last.time - first.time;

  if (elapsed <= 0) {
    return 0;
  }

  const velocity = ((last.position - first.position) / elapsed) * 1000;

  return Math.max(-MaxVelocity, Math.min(MaxVelocity, velocity));
}

/** Trims samples older than the velocity window, keeping the newest at the end. */
export function pruneSamples(samples: Sample[], now: number): Sample[] {
  const cutoff = now - VelocitySampleWindow;
  const index = samples.findIndex((sample) => sample.time >= cutoff);

  return index <= 0 ? samples : samples.slice(index);
}

/**
 * Consecutive non-growing wheel deltas that mark the start of a momentum phase.
 *
 * macOS keeps synthesizing wheel events after the fingers leave the trackpad,
 * with deltas that decay smoothly towards zero. The decay per event is gentle -
 * a long flick loses only a fraction of a percent per event - so what
 * distinguishes it is not the size of each drop but how many drops arrive in a
 * row without a single increase. A finger on glass never manages that: hand
 * tremor puts a larger delta in the run every few events.
 *
 * Twelve events is roughly 200ms at the ~60Hz macOS emits, long enough that a
 * steadily-slowing finger has not yet produced an unbroken run of that length.
 */
export const WheelMomentumRun = 12;

/**
 * A delta counts as non-growing when it is at most this fraction of the largest
 * delta seen so far in the run. Slightly above 1 to absorb the small ripples in
 * the OS curve without breaking the run, while any real re-acceleration - a
 * finger pushing again - is well clear of it and resets.
 */
export const WheelMomentumDecay = 1.02;

/**
 * Longest mean gap (ms) between events that can still be OS momentum.
 *
 * macOS drives the momentum tail off the display refresh, so its events arrive
 * about every 16ms and never pause. A hand moving on the glass produces a
 * sparser, less regular stream. Requiring the decaying run to also be this
 * dense is what separates real momentum from a steady deliberate scroll, which
 * can otherwise look monotonic for a long stretch without ever being momentum.
 */
export const WheelMomentumMaxGap = 24;

/**
 * Hard ceiling (ms) on how long a wheel gesture may stay in `drag`.
 *
 * The backstop for the case momentum detection misses: a device or browser
 * whose deltas do not decay in the shape we look for, or a genuine drag held
 * for an implausibly long time. Without it a stream of wheel events that never
 * goes idle keeps resetting the idle timer and the drum drifts with no snap
 * and no settle for as long as the events keep coming.
 */
export const WheelGestureMaxDuration = 1200;
