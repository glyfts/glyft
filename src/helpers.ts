/**
 * Glyft Helper Functions
 *
 * Common utility functions for game development.
 * Import from 'glyft/helpers' for tree-shaking support.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { lerp, clamp, distance, easing } from 'glyft/helpers';
 *
 * // Smooth movement
 * x = lerp(x, targetX, 0.1);
 *
 * // Keep value in bounds
 * health = clamp(health, 0, 100);
 *
 * // Check proximity
 * if (distance(player.x, player.y, enemy.x, enemy.y) < 50) { ... }
 *
 * // Smooth animation
 * const t = easing.easeOutQuad(progress);
 * ```
 */

// -----------------------------------------------------------------------------
// Math Utilities
// -----------------------------------------------------------------------------

/**
 * Linear interpolation between two values.
 *
 * @param a - Start value
 * @param b - End value
 * @param t - Interpolation factor (0 = a, 1 = b)
 * @returns Interpolated value
 *
 * @example
 * ```typescript
 * // Smooth camera follow
 * camera.x = lerp(camera.x, target.x, 0.1);
 *
 * // Animation progress
 * const y = lerp(startY, endY, progress);
 * ```
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max.
 *
 * @param value - Value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Clamped value
 *
 * @example
 * ```typescript
 * health = clamp(health - damage, 0, maxHealth);
 * volume = clamp(volume, 0, 1);
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate Euclidean distance between two points.
 *
 * @param x1 - First point X
 * @param y1 - First point Y
 * @param x2 - Second point X
 * @param y2 - Second point Y
 * @returns Distance between the points
 *
 * @example
 * ```typescript
 * const dist = distance(player.x, player.y, enemy.x, enemy.y);
 * if (dist < attackRange) { attack(); }
 * ```
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate squared distance (faster than distance, good for comparisons).
 *
 * @param x1 - First point X
 * @param y1 - First point Y
 * @param x2 - Second point X
 * @param y2 - Second point Y
 * @returns Squared distance between the points
 *
 * @example
 * ```typescript
 * // Faster than: distance(x1, y1, x2, y2) < range
 * if (distanceSquared(x1, y1, x2, y2) < range * range) { ... }
 * ```
 */
export function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Normalize a 2D vector (make it unit length).
 *
 * @param x - Vector X component
 * @param y - Vector Y component
 * @returns Normalized vector as [x, y] tuple, or [0, 0] if zero-length
 *
 * @example
 * ```typescript
 * const [nx, ny] = normalize(vx, vy);
 * sprite.vx = nx * speed;
 * sprite.vy = ny * speed;
 * ```
 */
export function normalize(x: number, y: number): [number, number] {
  const len = Math.sqrt(x * x + y * y);
  if (len === 0) return [0, 0];
  return [x / len, y / len];
}

/**
 * Get the angle from one point to another (in radians).
 *
 * @param x1 - From point X
 * @param y1 - From point Y
 * @param x2 - To point X
 * @param y2 - To point Y
 * @returns Angle in radians (-PI to PI, 0 = right, PI/2 = down)
 *
 * @example
 * ```typescript
 * const angle = angleTo(shooter.x, shooter.y, target.x, target.y);
 * bullet.rotation = angle;
 * ```
 */
export function angleTo(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * Convert degrees to radians.
 *
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
export function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees.
 *
 * @param radians - Angle in radians
 * @returns Angle in degrees
 */
export function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

// -----------------------------------------------------------------------------
// Random Utilities
// -----------------------------------------------------------------------------

/**
 * Generate a random number between min and max (inclusive).
 *
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Random number in range [min, max]
 *
 * @example
 * ```typescript
 * const damage = randomBetween(10, 20);
 * const spawnX = randomBetween(0, mapWidth);
 * ```
 */
export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generate a random integer between min and max (inclusive).
 *
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Random integer in range [min, max]
 *
 * @example
 * ```typescript
 * const tileX = randomInt(0, mapWidth - 1);
 * const enemyCount = randomInt(3, 7);
 * ```
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

/**
 * Pick a random element from an array.
 *
 * @param array - Array to pick from
 * @returns Random element, or undefined if array is empty
 *
 * @example
 * ```typescript
 * const enemy = randomPick(['goblin', 'orc', 'troll']);
 * const direction = randomPick(['up', 'down', 'left', 'right']);
 * ```
 */
export function randomPick<T>(array: T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Shuffle an array in place (Fisher-Yates algorithm).
 *
 * @param array - Array to shuffle
 * @returns The same array, shuffled
 *
 * @example
 * ```typescript
 * const deck = shuffle([1, 2, 3, 4, 5]);
 * ```
 */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// -----------------------------------------------------------------------------
// Easing Functions
// -----------------------------------------------------------------------------

/**
 * Easing functions for smooth animations.
 *
 * All functions take t in range [0, 1] and return value in range [0, 1].
 *
 * @example
 * ```typescript
 * // Smooth start
 * const y = lerp(startY, endY, easing.easeInQuad(progress));
 *
 * // Smooth end
 * const scale = lerp(0, 1, easing.easeOutQuad(progress));
 *
 * // Smooth both
 * const alpha = easing.easeInOutCubic(progress);
 * ```
 */
export const easing = {
  /** Linear (no easing) */
  linear: (t: number): number => t,

  // Quadratic
  /** Slow start */
  easeInQuad: (t: number): number => t * t,
  /** Slow end */
  easeOutQuad: (t: number): number => t * (2 - t),
  /** Slow start and end */
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  // Cubic
  /** Slow start (stronger) */
  easeInCubic: (t: number): number => t * t * t,
  /** Slow end (stronger) */
  easeOutCubic: (t: number): number => (--t) * t * t + 1,
  /** Slow start and end (stronger) */
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // Quartic
  /** Very slow start */
  easeInQuart: (t: number): number => t * t * t * t,
  /** Very slow end */
  easeOutQuart: (t: number): number => 1 - (--t) * t * t * t,
  /** Very slow start and end */
  easeInOutQuart: (t: number): number =>
    t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,

  // Exponential
  /** Exponential slow start */
  easeInExpo: (t: number): number =>
    t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
  /** Exponential slow end */
  easeOutExpo: (t: number): number =>
    t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  /** Exponential slow start and end */
  easeInOutExpo: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
    return (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  // Back (overshoot)
  /** Overshoot at start */
  easeInBack: (t: number): number => {
    const s = 1.70158;
    return t * t * ((s + 1) * t - s);
  },
  /** Overshoot at end */
  easeOutBack: (t: number): number => {
    const s = 1.70158;
    return (--t) * t * ((s + 1) * t + s) + 1;
  },
  /** Overshoot at start and end */
  easeInOutBack: (t: number): number => {
    const s = 1.70158 * 1.525;
    if (t < 0.5) return (t * t * ((s + 1) * 2 * t - s)) * 2;
    return ((t - 1) * (t - 1) * ((s + 1) * (t * 2 - 2) + s) + 1) * 2 - 1;
  },

  // Elastic (spring)
  /** Spring at start */
  easeInElastic: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
  },
  /** Spring at end */
  easeOutElastic: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
  },
  /** Spring at start and end */
  easeInOutElastic: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    t *= 2;
    if (t < 1) return -0.5 * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
    return 0.5 * Math.pow(2, -10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI) + 1;
  },

  // Bounce
  /** Bounce at end */
  easeOutBounce: (t: number): number => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    } else if (t < 2.5 / 2.75) {
      return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    } else {
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    }
  },
  /** Bounce at start */
  easeInBounce: (t: number): number => {
    return 1 - easing.easeOutBounce(1 - t);
  },
  /** Bounce at start and end */
  easeInOutBounce: (t: number): number => {
    if (t < 0.5) return easing.easeInBounce(t * 2) * 0.5;
    return easing.easeOutBounce(t * 2 - 1) * 0.5 + 0.5;
  },
};

// -----------------------------------------------------------------------------
// Game-Specific Utilities
// -----------------------------------------------------------------------------

/**
 * Calculate direction index from velocity (for 4-direction sprites).
 *
 * @param vx - X velocity
 * @param vy - Y velocity
 * @returns Direction index: 0=down, 1=right, 2=up, 3=left, or -1 if stationary
 *
 * @example
 * ```typescript
 * const dir = getDirection4(sprite.vx, sprite.vy);
 * if (dir >= 0) sprite.data.lastDirection = dir;
 * ```
 */
export function getDirection4(vx: number, vy: number): number {
  if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) return -1;

  if (Math.abs(vx) > Math.abs(vy)) {
    return vx > 0 ? 1 : 3; // Right or Left
  } else {
    return vy > 0 ? 0 : 2; // Down or Up
  }
}

/**
 * Calculate direction index from velocity (for 8-direction sprites).
 *
 * @param vx - X velocity
 * @param vy - Y velocity
 * @returns Direction index: 0-7 (clockwise from down), or -1 if stationary
 */
export function getDirection8(vx: number, vy: number): number {
  if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) return -1;

  const angle = Math.atan2(vy, vx);
  // Convert to 0-8 range (8 directions, offset by half sector)
  const sector = Math.round((angle + Math.PI) / (Math.PI / 4)) % 8;
  // Remap to our direction order: 0=down, 1=down-right, 2=right, etc.
  const remap = [3, 4, 5, 6, 7, 0, 1, 2];
  return remap[sector];
}

/**
 * Move a value toward a target at a constant speed.
 *
 * @param current - Current value
 * @param target - Target value
 * @param maxDelta - Maximum change per call
 * @returns New value, moved toward target
 *
 * @example
 * ```typescript
 * // Move toward target at 100 pixels per second
 * sprite.x = moveToward(sprite.x, targetX, 100 * dt);
 * ```
 */
export function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maxDelta;
}

/**
 * Check if a point is inside a rectangle.
 *
 * @param px - Point X
 * @param py - Point Y
 * @param rx - Rectangle left
 * @param ry - Rectangle top
 * @param rw - Rectangle width
 * @param rh - Rectangle height
 * @returns True if point is inside rectangle
 */
export function pointInRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
}

/**
 * Check if two rectangles overlap.
 *
 * @param ax - First rectangle left
 * @param ay - First rectangle top
 * @param aw - First rectangle width
 * @param ah - First rectangle height
 * @param bx - Second rectangle left
 * @param by - Second rectangle top
 * @param bw - Second rectangle width
 * @param bh - Second rectangle height
 * @returns True if rectangles overlap
 */
export function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Wrap a value around a range (useful for seamless map scrolling).
 *
 * @param value - Value to wrap
 * @param min - Minimum (inclusive)
 * @param max - Maximum (exclusive)
 * @returns Wrapped value in range [min, max)
 *
 * @example
 * ```typescript
 * x = wrap(x, 0, mapWidth);  // Wraps at map edges
 * angle = wrap(angle, -PI, PI);  // Keep angle normalized
 * ```
 */
export function wrap(value: number, min: number, max: number): number {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
}

/**
 * Smoothly damp a value toward a target (spring-like smoothing).
 *
 * @param current - Current value
 * @param target - Target value
 * @param velocity - Current velocity (modified by reference via return)
 * @param smoothTime - Approximate time to reach target (seconds)
 * @param dt - Delta time
 * @param maxSpeed - Maximum speed (optional)
 * @returns [newValue, newVelocity] tuple
 *
 * @example
 * ```typescript
 * let vel = 0;
 * game.onUpdate((dt) => {
 *   [camera.x, vel] = smoothDamp(camera.x, target.x, vel, 0.3, dt);
 * });
 * ```
 */
export function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  dt: number,
  maxSpeed: number = Infinity
): [number, number] {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let change = current - target;
  const maxChange = maxSpeed * smoothTime;
  change = clamp(change, -maxChange, maxChange);

  const temp = (velocity + omega * change) * dt;
  velocity = (velocity - omega * temp) * exp;
  let result = target + (change + temp) * exp;

  // Prevent overshooting
  if ((target - current > 0) === (result > target)) {
    result = target;
    velocity = 0;
  }

  return [result, velocity];
}
