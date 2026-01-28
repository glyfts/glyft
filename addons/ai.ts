/**
 * AI Behavior Addon
 *
 * Assign named behaviors (chase, wander, patrol, flee, idle) to sprites.
 * The addon manages velocity, map collision, and state per sprite.
 *
 * @example
 * ```typescript
 * import { ai } from 'glyft/addons/ai';
 *
 * game.use(ai({
 *   behaviors: {
 *     chaser: { type: 'chase', speed: 30, range: 150, target: 'player' },
 *     wanderer: { type: 'wander', speed: 20, chance: 0.02 },
 *   },
 * }));
 *
 * const aiSys = game.addon<AIAddon>('ai')!;
 * aiSys.assign(enemy, 'chaser');
 * ```
 *
 * @packageDocumentation
 */

import type { GlyftAddon, Glyft, Sprite } from '../src/types';

/** AI behavior definition */
export interface AIBehavior {
  /** Behavior type */
  type: 'chase' | 'wander' | 'patrol' | 'flee' | 'idle';
  /** Movement speed in pixels/second */
  speed: number;
  /** Detection range in pixels for chase/flee (default: 150) */
  range?: number;
  /** Tag of sprites to target (default: 'player') */
  target?: string;
  /** Velocity damping factor 0-1 per frame when not chasing (default: 0.1) */
  damping?: number;
  /** Probability of random direction change per frame for wander (default: 0.02) */
  chance?: number;
  /** Respect tilemap collision (default: true) */
  mapCollision?: boolean;
  /** Patrol waypoints as [tileX, tileY] */
  waypoints?: [number, number][];
  /** Pause at each patrol waypoint in seconds (default: 1.0) */
  waypointPause?: number;
}

/** AI addon configuration */
export interface AIConfig {
  /** Named behavior presets */
  behaviors: Record<string, AIBehavior>;
}

interface TrackedSprite {
  sprite: Sprite;
  behavior: string;
  paused: boolean;
  // Patrol state
  waypointIndex: number;
  waypointTimer: number;
}

/** AI addon public API */
export interface AIAddon extends GlyftAddon {
  /** Assign an AI behavior to a sprite */
  assign(sprite: Sprite, behavior: string): void;
  /** Remove AI from a sprite */
  remove(sprite: Sprite): void;
  /** Pause AI for a specific sprite */
  pause(sprite: Sprite): void;
  /** Resume AI for a specific sprite */
  resume(sprite: Sprite): void;
  /** Pause all AI processing */
  pauseAll(): void;
  /** Resume all AI processing */
  resumeAll(): void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Create the AI addon.
 */
export function ai(config: AIConfig): AIAddon {
  let game: Glyft;
  const behaviors = new Map<string, AIBehavior>();
  const tracked: TrackedSprite[] = [];
  let globalPaused = false;

  return {
    name: 'ai',

    init(g: Glyft) {
      game = g;
      for (const [name, def] of Object.entries(config.behaviors)) {
        behaviors.set(name, def);
      }
    },

    postUpdate(dt: number) {
      if (globalPaused) return;

      for (let i = tracked.length - 1; i >= 0; i--) {
        const t = tracked[i];
        if (!t.sprite.exists) {
          tracked.splice(i, 1);
          continue;
        }
        if (t.paused) continue;

        const def = behaviors.get(t.behavior);
        if (!def) continue;

        switch (def.type) {
          case 'chase':
            _chase(t, def, dt);
            break;
          case 'wander':
            _wander(t, def);
            break;
          case 'patrol':
            _patrol(t, def, dt);
            break;
          case 'flee':
            _flee(t, def, dt);
            break;
          case 'idle':
            _idle(t, def);
            break;
        }

        // Apply map collision
        if (def.mapCollision !== false) {
          _applyMapCollision(t.sprite, dt);
        }

        // Update HP bar if sprite has HP
        if (t.sprite.hp !== undefined && t.sprite.data.maxHp) {
          t.sprite.hpBarValue = Math.max(0, t.sprite.hp / (t.sprite.data.maxHp as number));
        }
      }
    },

    assign(sprite: Sprite, behavior: string) {
      if (!behaviors.has(behavior)) {
        console.warn(`[Glyft:ai] Unknown behavior '${behavior}'`);
        return;
      }
      // Remove existing assignment if any
      const idx = tracked.findIndex(t => t.sprite.id === sprite.id);
      if (idx !== -1) tracked.splice(idx, 1);

      tracked.push({
        sprite,
        behavior,
        paused: false,
        waypointIndex: 0,
        waypointTimer: 0,
      });
    },

    remove(sprite: Sprite) {
      const idx = tracked.findIndex(t => t.sprite.id === sprite.id);
      if (idx !== -1) tracked.splice(idx, 1);
    },

    pause(sprite: Sprite) {
      const t = tracked.find(t => t.sprite.id === sprite.id);
      if (t) t.paused = true;
    },

    resume(sprite: Sprite) {
      const t = tracked.find(t => t.sprite.id === sprite.id);
      if (t) t.paused = false;
    },

    pauseAll() {
      globalPaused = true;
    },

    resumeAll() {
      globalPaused = false;
    },

    destroy() {
      tracked.length = 0;
    },
  };

  function _findNearestTarget(sprite: Sprite, tag: string): Sprite | null {
    const targets = game.getTagged(tag);
    let nearest: Sprite | null = null;
    let nearestDist = Infinity;

    for (const target of targets) {
      if (target.id === sprite.id) continue;
      const dx = target.x - sprite.x;
      const dy = target.y - sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = target;
      }
    }

    return nearest;
  }

  function _chase(t: TrackedSprite, def: AIBehavior, _dt: number) {
    const range = def.range ?? 150;
    const target = _findNearestTarget(t.sprite, def.target ?? 'player');
    if (!target) {
      _wander(t, def);
      return;
    }

    const dx = target.x - t.sprite.x;
    const dy = target.y - t.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < range && dist > 0) {
      t.sprite.vx = (dx / dist) * def.speed;
      t.sprite.vy = (dy / dist) * def.speed;
    } else {
      // Out of range — wander
      _wanderStep(t, def);
    }
  }

  function _flee(t: TrackedSprite, def: AIBehavior, _dt: number) {
    const range = def.range ?? 150;
    const target = _findNearestTarget(t.sprite, def.target ?? 'player');
    if (!target) {
      _idle(t, def);
      return;
    }

    const dx = t.sprite.x - target.x;
    const dy = t.sprite.y - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < range && dist > 0) {
      t.sprite.vx = (dx / dist) * def.speed;
      t.sprite.vy = (dy / dist) * def.speed;
    } else {
      _idle(t, def);
    }
  }

  function _wander(t: TrackedSprite, def: AIBehavior) {
    _wanderStep(t, def);
  }

  function _wanderStep(t: TrackedSprite, def: AIBehavior) {
    const chance = def.chance ?? 0.02;
    const damping = def.damping ?? 0.1;

    if (Math.random() < chance) {
      t.sprite.vx = (Math.random() - 0.5) * def.speed;
      t.sprite.vy = (Math.random() - 0.5) * def.speed;
    }

    t.sprite.vx = lerp(t.sprite.vx, 0, damping);
    t.sprite.vy = lerp(t.sprite.vy, 0, damping);
  }

  function _patrol(t: TrackedSprite, def: AIBehavior, dt: number) {
    const waypoints = def.waypoints;
    if (!waypoints || waypoints.length === 0) {
      _idle(t, def);
      return;
    }

    const tileSize = game.config.settings.tileSize;
    const wp = waypoints[t.waypointIndex];
    const targetX = wp[0] * tileSize;
    const targetY = wp[1] * tileSize;

    const dx = targetX - t.sprite.x;
    const dy = targetY - t.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 4) {
      // At waypoint — pause then advance
      t.waypointTimer += dt;
      t.sprite.vx = 0;
      t.sprite.vy = 0;

      if (t.waypointTimer >= (def.waypointPause ?? 1.0)) {
        t.waypointTimer = 0;
        t.waypointIndex = (t.waypointIndex + 1) % waypoints.length;
      }
    } else {
      t.waypointTimer = 0;
      t.sprite.vx = (dx / dist) * def.speed;
      t.sprite.vy = (dy / dist) * def.speed;
    }
  }

  function _idle(t: TrackedSprite, def: AIBehavior) {
    const damping = def.damping ?? 0.1;
    t.sprite.vx = lerp(t.sprite.vx, 0, damping);
    t.sprite.vy = lerp(t.sprite.vy, 0, damping);
  }

  function _applyMapCollision(sprite: Sprite, dt: number) {
    const nx = sprite.x + sprite.vx * dt;
    const ny = sprite.y + sprite.vy * dt;

    if (!game.spriteCollidesWithMap(sprite, nx, sprite.y)) {
      sprite.x = nx;
    }
    if (!game.spriteCollidesWithMap(sprite, sprite.x, ny)) {
      sprite.y = ny;
    }
  }
}
