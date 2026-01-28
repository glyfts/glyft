/**
 * Projectile System Addon
 *
 * Fires projectiles from sprites in their facing direction with cooldown,
 * lifetime, and wall collision. Sprite-to-sprite collisions are handled
 * by the engine's existing collision system.
 *
 * @example
 * ```typescript
 * import { projectiles } from 'glyft/addons/projectiles';
 *
 * game.use(projectiles({
 *   types: {
 *     bolt: { speed: 200, cooldown: 0.3, tint: 0x44ccff, scale: 0.4 },
 *   },
 * }));
 *
 * const proj = game.addon<ProjectileAddon>('projectiles')!;
 * proj.fire('bolt', player, atlas);
 * ```
 *
 * @packageDocumentation
 */

import type { GlyftAddon } from '../addon';
import type { Glyft, Sprite, Atlas } from '../types';

/** Projectile type definition */
export interface ProjectileTypeDef {
  /** Sprite type name in atlas (e.g., 'projectile') */
  sprite?: string;
  /** Speed in pixels/second */
  speed: number;
  /** Minimum time between shots in seconds (default: 0.3) */
  cooldown?: number;
  /** Lifetime in seconds before auto-destroy (default: 1.0) */
  lifetime?: number;
  /** Tint color as 0xRRGGBB (default: 0xffffff) */
  tint?: number;
  /** Scale factor (default: 1.0) */
  scale?: number;
  /** Tags applied to the projectile sprite (default: ['projectile']) */
  tags?: string[];
  /** Whether projectile is destroyed on tilemap collision (default: true) */
  destroyOnWall?: boolean;
  /** Sound to play on fire (e.g. '$beep') */
  fireSound?: string;
  /** Sound to play when hitting a wall (e.g. '$hit') */
  wallSound?: string;
}

/** Projectile addon configuration */
export interface ProjectileConfig {
  /** Named projectile type definitions */
  types: Record<string, ProjectileTypeDef>;
}

/** Projectile addon public API */
export interface ProjectileAddon extends GlyftAddon {
  /** Fire a projectile from a sprite in its facing direction */
  fire(type: string, source: Sprite, atlas: Atlas): Sprite | null;
  /** Fire a projectile at a specific angle (radians, 0 = right) */
  fireAngle(type: string, source: Sprite, atlas: Atlas, angle: number): Sprite | null;
  /** Destroy all active projectiles */
  clear(): void;
  /** Number of active projectiles */
  readonly count: number;
}

interface ActiveProjectile {
  sprite: Sprite;
  birth: number;
  lifetime: number;
  destroyOnWall: boolean;
  wallSound?: string;
}

const DIR_MAP: Record<string, [number, number]> = {
  down: [0, 1],
  right: [1, 0],
  up: [0, -1],
  left: [-1, 0],
};

/**
 * Create the projectiles addon.
 */
export function projectiles(config: ProjectileConfig): ProjectileAddon {
  let game: Glyft;
  const types = new Map<string, ProjectileTypeDef>();
  const active: ActiveProjectile[] = [];
  const cooldowns = new Map<string, number>(); // type -> last fire time

  return {
    name: 'projectiles',

    init(g: Glyft) {
      game = g;
      for (const [name, def] of Object.entries(config.types)) {
        types.set(name, def);
      }
    },

    postUpdate(dt: number) {
      const now = performance.now() / 1000;

      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i];
        if (!p.sprite.exists) {
          active.splice(i, 1);
          continue;
        }

        // Lifetime expiry
        if (now - p.birth > p.lifetime) {
          p.sprite.destroy();
          active.splice(i, 1);
          continue;
        }

        // Move and check wall collision
        const nx = p.sprite.x + p.sprite.vx * dt;
        const ny = p.sprite.y + p.sprite.vy * dt;
        if (p.destroyOnWall && game.spriteCollidesWithMap(p.sprite, nx, ny)) {
          if (p.wallSound) game.sounds.play(p.wallSound, { volume: 0.4 });
          p.sprite.destroy();
          active.splice(i, 1);
        } else {
          p.sprite.x = nx;
          p.sprite.y = ny;
        }
      }
    },

    fire(type: string, source: Sprite, atlas: Atlas): Sprite | null {
      const def = types.get(type);
      if (!def) {
        console.warn(`[Glyft:projectiles] Unknown type '${type}'`);
        return null;
      }

      // Cooldown check
      const now = performance.now() / 1000;
      const cd = def.cooldown ?? 0.3;
      const lastFired = cooldowns.get(type) ?? 0;
      if (now - lastFired < cd) return null;
      cooldowns.set(type, now);

      // Direction from source facing
      const dir = DIR_MAP[source.facing] ?? [0, 1];

      return _spawn(def, type, source, atlas, dir[0], dir[1], now);
    },

    fireAngle(type: string, source: Sprite, atlas: Atlas, angle: number): Sprite | null {
      const def = types.get(type);
      if (!def) {
        console.warn(`[Glyft:projectiles] Unknown type '${type}'`);
        return null;
      }

      const now = performance.now() / 1000;
      const cd = def.cooldown ?? 0.3;
      const lastFired = cooldowns.get(type) ?? 0;
      if (now - lastFired < cd) return null;
      cooldowns.set(type, now);

      return _spawn(def, type, source, atlas, Math.cos(angle), Math.sin(angle), now);
    },

    clear() {
      for (const p of active) {
        if (p.sprite.exists) p.sprite.destroy();
      }
      active.length = 0;
    },

    get count() {
      return active.length;
    },

    destroy() {
      this.clear();
    },
  };

  function _spawn(
    def: ProjectileTypeDef,
    _type: string,
    source: Sprite,
    atlas: Atlas,
    dx: number,
    dy: number,
    now: number,
  ): Sprite {
    const spriteName = def.sprite ?? 'projectile';
    const proj = game.createSprite(atlas, spriteName);
    proj.x = source.x;
    proj.y = source.y;
    proj.vx = dx * def.speed;
    proj.vy = dy * def.speed;
    proj.tags = def.tags ?? ['projectile'];
    if (def.tint !== undefined) proj.tint = def.tint;
    if (def.scale !== undefined) proj.scale = def.scale;

    active.push({
      sprite: proj,
      birth: now,
      lifetime: def.lifetime ?? 1.0,
      destroyOnWall: def.destroyOnWall ?? true,
      wallSound: def.wallSound,
    });

    if (def.fireSound) game.sounds.play(def.fireSound, { volume: 0.5 });

    return proj;
  }
}
