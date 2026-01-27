/**
 * Glyft Helper Functions - Separate entry point for tree-shaking.
 *
 * @example
 * ```typescript
 * import { lerp, clamp, easing } from 'glyft/helpers';
 * ```
 *
 * @packageDocumentation
 */

export {
  // Math
  lerp,
  clamp,
  distance,
  distanceSquared,
  normalize,
  angleTo,
  toRadians,
  toDegrees,

  // Random
  randomBetween,
  randomInt,
  randomPick,
  shuffle,

  // Easing
  easing,

  // Game utilities
  getDirection4,
  getDirection8,
  moveToward,
  pointInRect,
  rectsOverlap,
  wrap,
  smoothDamp,
} from '../helpers';
