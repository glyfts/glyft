/**
 * Glyft Addon System
 *
 * Addons extend the engine without modifying the core. They hook into the game loop
 * at well-defined points and access the engine through the public Glyft API.
 *
 * @example
 * ```typescript
 * import { projectiles } from 'glyft/addons/projectiles';
 * game.use(projectiles({ types: { bolt: { speed: 200, cooldown: 0.3 } } }));
 * ```
 *
 * @packageDocumentation
 */

import type { Glyft } from './types';

/**
 * A Glyft addon extends the engine with new capabilities.
 *
 * Lifecycle:
 * 1. Factory function creates addon config → GlyftAddon object
 * 2. `game.use(addon)` calls `init()` with the game instance
 * 3. Each frame, hooks are called in order:
 *    - `preUpdate(dt)` → before user `onUpdate` callbacks
 *    - `postUpdate(dt)` → after user callbacks, before collision detection
 *    - `postPhysics(dt)` → after collisions + reactive sounds
 * 4. `destroy()` called on addon removal
 */
export interface GlyftAddon {
  /** Unique addon name (used for `game.addon('name')` lookup and duplicate detection) */
  readonly name: string;

  /**
   * Called once when `game.use()` is invoked.
   * Store the game reference, set up initial state.
   */
  init(game: Glyft): void;

  /** Called every frame BEFORE user `onUpdate` callbacks. */
  preUpdate?(dt: number): void;

  /** Called every frame AFTER user callbacks, BEFORE collision detection. */
  postUpdate?(dt: number): void;

  /** Called every frame AFTER collisions + reactive sounds, BEFORE render. */
  postPhysics?(dt: number): void;

  /** Called when the addon is removed or the game is destroyed. */
  destroy?(): void;
}
