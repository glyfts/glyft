/**
 * Tween System
 *
 * Smooth interpolation for sprite properties (position, alpha, scale, etc.).
 * Uses object pooling to avoid GC pressure.
 *
 * @example
 * ```typescript
 * // Smooth movement
 * game.tween(sprite, { x: 200, y: 100 }, 500);
 *
 * // Fade out with callback
 * game.tween(sprite, { alpha: 0 }, 300, {
 *   ease: 'easeOutQuad',
 *   onComplete: () => sprite.destroy()
 * });
 * ```
 */

import { easing } from './helpers';

/** Easing function type */
export type EaseFn = (t: number) => number;

/** Easing name (matches helpers.ts) */
export type EaseName = keyof typeof easing;

/** Properties that can be tweened */
export interface TweenProps {
  x?: number;
  y?: number;
  alpha?: number;
  scale?: number;
  rotation?: number;
}

/** Tween configuration options */
export interface TweenOptions {
  ease?: EaseName | EaseFn;
  onUpdate?: (target: TweenTarget) => void;
  onComplete?: (target: TweenTarget) => void;
  delay?: number;
}

/** Any object with numeric properties that can be tweened */
export interface TweenTarget {
  [key: string]: unknown;
}

/** Internal tween state */
interface ActiveTween {
  target: TweenTarget;
  startValues: Record<string, number>;
  endValues: Record<string, number>;
  duration: number;
  elapsed: number;
  delay: number;
  easeFn: EaseFn;
  onUpdate: ((target: TweenTarget) => void) | null;
  onComplete: ((target: TweenTarget) => void) | null;
  active: boolean;
}

/** Tween handle for cancellation */
export interface TweenHandle {
  /** Cancel this tween */
  cancel(): void;
  /** Whether the tween is still running */
  readonly active: boolean;
}

/**
 * Tween manager with object pooling.
 */
export class TweenManager {
  private _tweens: ActiveTween[] = [];
  private _pool: ActiveTween[] = [];

  /** Number of active tweens */
  get count(): number {
    let n = 0;
    for (const t of this._tweens) {
      if (t.active) n++;
    }
    return n;
  }

  /**
   * Create a new tween.
   *
   * @param target - Object to tween (sprite, camera, any object with numeric props)
   * @param props - Target values for each property
   * @param duration - Duration in milliseconds
   * @param options - Easing, callbacks, delay
   * @returns Handle for cancellation
   */
  add(
    target: TweenTarget,
    props: TweenProps,
    duration: number,
    options?: TweenOptions,
  ): TweenHandle {
    // Resolve easing function
    let easeFn: EaseFn;
    if (!options?.ease) {
      easeFn = easing.linear;
    } else if (typeof options.ease === 'function') {
      easeFn = options.ease;
    } else {
      easeFn = easing[options.ease] ?? easing.linear;
    }

    // Get or create tween from pool
    let tween = this._pool.pop();
    if (!tween) {
      tween = {
        target,
        startValues: {},
        endValues: {},
        duration,
        elapsed: 0,
        delay: 0,
        easeFn,
        onUpdate: null,
        onComplete: null,
        active: true,
      };
    }

    // Initialize
    tween.target = target;
    tween.duration = duration;
    tween.elapsed = 0;
    tween.delay = options?.delay ?? 0;
    tween.easeFn = easeFn;
    tween.onUpdate = options?.onUpdate ?? null;
    tween.onComplete = options?.onComplete ?? null;
    tween.active = true;

    // Capture start values and set end values
    tween.startValues = {};
    tween.endValues = {};
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined && typeof target[key] === 'number') {
        tween.startValues[key] = target[key] as number;
        tween.endValues[key] = value;
      }
    }

    this._tweens.push(tween);

    return {
      cancel: () => { tween!.active = false; },
      get active() { return tween!.active; },
    };
  }

  /**
   * Update all active tweens.
   * Called once per frame from the game loop.
   *
   * @param dtMs - Delta time in milliseconds
   */
  update(dtMs: number): void {
    let writeIdx = 0;

    for (let i = 0; i < this._tweens.length; i++) {
      const tween = this._tweens[i];

      if (!tween.active) {
        this._pool.push(tween);
        continue;
      }

      // Handle delay
      if (tween.delay > 0) {
        tween.delay -= dtMs;
        this._tweens[writeIdx++] = tween;
        continue;
      }

      tween.elapsed += dtMs;
      const progress = Math.min(tween.elapsed / tween.duration, 1);
      const eased = tween.easeFn(progress);

      // Interpolate properties
      for (const key of Object.keys(tween.endValues)) {
        const start = tween.startValues[key];
        const end = tween.endValues[key];
        (tween.target as Record<string, number>)[key] = start + (end - start) * eased;
      }

      if (tween.onUpdate) {
        tween.onUpdate(tween.target);
      }

      if (progress >= 1) {
        tween.active = false;
        if (tween.onComplete) {
          tween.onComplete(tween.target);
        }
        this._pool.push(tween);
      } else {
        this._tweens[writeIdx++] = tween;
      }
    }

    this._tweens.length = writeIdx;
  }

  /**
   * Cancel all tweens on a specific target.
   */
  cancelAll(target: TweenTarget): void {
    for (const tween of this._tweens) {
      if (tween.active && tween.target === target) {
        tween.active = false;
      }
    }
  }

  /**
   * Cancel all tweens.
   */
  clear(): void {
    for (const tween of this._tweens) {
      tween.active = false;
      this._pool.push(tween);
    }
    this._tweens.length = 0;
  }
}
